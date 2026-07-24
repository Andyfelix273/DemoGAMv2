/**
 * efficiency-detail-modal.js — Modale dettaglio asset condivisa
 *
 * Componente autonomo: inietta il markup HTML della modale nel <body>,
 * gestisce tutti i 7 tab (Anagrafica, Consumi, Occupancy, Allarmi, Efficienza energetica,
 * Impianti, Zone) e si apre con apriDettaglioAsset(id).
 *
 * Utilizzato da:
 *   - efficiency-map.html   (sostituisce efficiency-map-modal.js)
 *   - efficiency-assets.html (sostituisce la modale inline)
 *
 * Dipendenze: api.js (API.getToken, API.getAsset), Plotly (opzionale)
 */
/* global API, Plotly */

// ── Iniezione markup modale ────────────────────────────────────────────
(function injectModal() {
  if (document.getElementById('edm-overlay')) return; // già iniettata
  const el = document.createElement('div');
  el.innerHTML = `
<div id="edm-overlay" style="
  position:fixed;inset:0;background:rgba(0,0,0,0.65);
  display:none;align-items:center;justify-content:center;
  z-index:3000;">
  <div id="edm-modal" style="
    background:var(--bg-panel,#0D1B2A);
    border:1px solid var(--border,#1E3A5F);
    border-radius:12px;
    width:96%;max-width:1440px;height:92vh;
    display:flex;flex-direction:column;
    box-shadow:0 20px 60px rgba(0,0,0,0.5);
    overflow:hidden;font-family:Inter,sans-serif;">

    <!-- HEADER -->
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:16px 24px;border-bottom:1px solid var(--border,#1E3A5F);flex-shrink:0;">
      <div>
        <div id="edm-title" style="font-size:15px;font-weight:700;color:var(--text-primary,#E0F0FF);">Dettaglio asset</div>
        <div id="edm-subtitle" style="font-size:11px;color:var(--text-secondary,#7BAFC4);margin-top:2px;"></div>
      </div>
      <button id="edm-close" style="background:none;border:none;color:var(--text-secondary,#7BAFC4);
        font-size:22px;cursor:pointer;padding:4px 10px;border-radius:4px;line-height:1;">&times;</button>
    </div>

    <!-- TAB BAR -->
    <div id="edm-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--border,#1E3A5F);
                              padding:0 24px;flex-shrink:0;overflow-x:auto;">
      <button class="edm-tab active" data-tab="anagrafica"><i class="fa fa-info-circle"></i> Anagrafica</button>
      <button class="edm-tab" data-tab="consumi"><i class="fa fa-bolt"></i> Consumi</button>
      <button class="edm-tab" data-tab="occupancy"><i class="fa fa-users"></i> Occupancy</button>
      <button class="edm-tab" data-tab="allarmi"><i class="fa fa-bell"></i> Allarmi <span id="edm-alarm-badge"></span></button>
      <button class="edm-tab" data-tab="esg"><i class="fa fa-leaf"></i> Efficienza energetica</button>
      <button class="edm-tab" data-tab="impianti"><i class="fa fa-cogs"></i> Impianti</button>
      <button class="edm-tab" data-tab="zone"><i class="fa fa-th-large"></i> Zone</button>
    </div>

    <!-- BODY -->
    <div style="flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;min-height:0;">
      <div id="edm-panel-anagrafica" class="edm-panel active"></div>
      <div id="edm-panel-consumi"    class="edm-panel"></div>
      <div id="edm-panel-occupancy"  class="edm-panel"></div>
      <div id="edm-panel-allarmi"    class="edm-panel"></div>
      <div id="edm-panel-esg"        class="edm-panel"></div>
      <div id="edm-panel-impianti"   class="edm-panel"></div>
      <div id="edm-panel-zone"       class="edm-panel"></div>
    </div>

    <!-- FOOTER -->
    <div style="display:flex;justify-content:flex-end;gap:8px;
                padding:12px 24px;border-top:1px solid var(--border,#1E3A5F);flex-shrink:0;">
      <button id="edm-btn-chiudi" class="edm-btn edm-btn-secondary">Chiudi</button>
      <button id="edm-btn-floorplan" class="edm-btn edm-btn-green" style="display:none;">
        <i class="fa fa-building"></i> Floorplan BEMS
      </button>
    </div>
  </div>
</div>

<style>
.edm-tab {
  padding:10px 16px;font-size:12px;font-weight:500;cursor:pointer;
  border-bottom:2px solid transparent;color:var(--text-secondary,#7BAFC4);
  background:none;border-top:none;border-left:none;border-right:none;
  white-space:nowrap;flex-shrink:0;transition:all 0.15s;font-family:inherit;
}
.edm-tab:hover { color:var(--text-primary,#E0F0FF); }
.edm-tab.active { color:var(--accent,#00B4D8);border-bottom-color:var(--accent,#00B4D8); }
.edm-panel { display:none; }
.edm-panel.active { display:block;flex:1;min-height:0; }
.edm-btn {
  display:inline-flex;align-items:center;gap:6px;
  padding:7px 14px;border-radius:6px;font-size:13px;font-weight:500;
  cursor:pointer;border:none;line-height:1.4;font-family:inherit;
  text-decoration:none;transition:background 0.15s,opacity 0.15s;
}
.edm-btn-secondary {
  background:var(--bg-tertiary,#1A2E45);color:var(--text-primary,#E0F0FF);
  border:1px solid var(--border-color,#1E3A5F) !important;
}
.edm-btn-secondary:hover { background:var(--border-color,#1E3A5F); }
.edm-btn-green {
  background:rgba(39,174,96,0.15);color:#27AE60;
  border:1px solid #27AE60 !important;
}
.edm-btn-green:hover { background:rgba(39,174,96,0.3); }
.edm-detail-grid { display:grid;grid-template-columns:1fr 1fr;gap:8px 24px; }
.edm-detail-row { display:flex;flex-direction:column;gap:2px;padding:6px 0;
  border-bottom:1px solid var(--border,#1E3A5F); }
.edm-detail-row.full { grid-column:1/-1; }
.edm-detail-label { font-size:10px;color:var(--text-secondary,#7BAFC4);text-transform:uppercase;letter-spacing:0.5px; }
.edm-detail-value { font-size:13px;color:var(--text-primary,#E0F0FF); }
.edm-kpi-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:12px; }
.edm-kpi-card { background:var(--bg-secondary,#0A1628);border:1px solid var(--border,#1E3A5F);
  border-radius:8px;padding:10px 12px;text-align:center; }
.edm-kpi-val { font-size:20px;font-weight:700;color:var(--text-primary,#E0F0FF); }
.edm-kpi-lbl { font-size:10px;color:var(--text-secondary,#7BAFC4);margin-top:2px; }
.edm-alarm-row { display:flex;align-items:center;gap:10px;padding:8px 10px;
  background:var(--bg-secondary,#0A1628);border:1px solid var(--border,#1E3A5F);
  border-radius:6px;margin-bottom:6px; }
.edm-spinner { width:24px;height:24px;border:3px solid var(--border,#1E3A5F);
  border-top-color:var(--accent,#00B4D8);border-radius:50%;
  animation:edm-spin 0.8s linear infinite;margin:30px auto;display:block; }
@keyframes edm-spin { to { transform:rotate(360deg); } }
</style>`;
  document.body.appendChild(el.firstElementChild);
  document.body.appendChild(el.lastElementChild); // <style>

  // Chiudi al click overlay
  document.getElementById('edm-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('edm-overlay')) chiudiDettaglioAsset();
  });
  document.getElementById('edm-close').addEventListener('click', chiudiDettaglioAsset);
  document.getElementById('edm-btn-chiudi').addEventListener('click', chiudiDettaglioAsset);

  // Tab switching
  document.getElementById('edm-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.edm-tab');
    if (!btn) return;
    document.querySelectorAll('.edm-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.edm-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('edm-panel-' + btn.dataset.tab).classList.add('active');
  });
})();

// ── Spinner helper ─────────────────────────────────────────────────────
function _edmSpinner() { return '<div class="edm-spinner"></div>'; }

// ── Apri modale ────────────────────────────────────────────────────────
async function apriDettaglioAsset(id) {
  const overlay = document.getElementById('edm-overlay');
  overlay.style.display = 'flex';

  // ResizeObserver: forza Plotly a ricalcolare le dimensioni quando la modale si apre/ridimensiona
  const modalBox = document.getElementById('edm-modal');
  if (modalBox && !modalBox._edmResizeObserver) {
    modalBox._edmResizeObserver = new ResizeObserver(() => {
      const chartEl = document.getElementById('edm-chart-consumi');
      if (chartEl && chartEl._fullLayout && typeof Plotly !== 'undefined') {
        Plotly.relayout(chartEl, {});
      }
    });
    modalBox._edmResizeObserver.observe(modalBox);
  }

  // Reset tab → Anagrafica
  document.querySelectorAll('.edm-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.edm-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.edm-tab[data-tab="anagrafica"]').classList.add('active');
  document.getElementById('edm-panel-anagrafica').classList.add('active');
  document.getElementById('edm-panel-anagrafica').innerHTML = _edmSpinner();
  document.getElementById('edm-alarm-badge').innerHTML = '';
  document.getElementById('edm-title').textContent = 'Caricamento…';
  document.getElementById('edm-subtitle').textContent = '';
  document.getElementById('edm-btn-floorplan').style.display = 'none';

  // Pre-popola gli altri panel con spinner
  ['consumi','occupancy','allarmi','esg','impianti','zone'].forEach(t => {
    document.getElementById('edm-panel-' + t).innerHTML = _edmSpinner();
  });

  try {
    const d = await API.getAsset(id);
    const a = d.asset;

    document.getElementById('edm-title').textContent = a.codice + ' — ' + a.nome;
    document.getElementById('edm-subtitle').textContent =
      a.tipo + ' · ' + a.citta + (a.provincia ? ' (' + a.provincia + ')' : '');

    // ── Anagrafica ─────────────────────────────────────────────
    const statoLabel = { attivo:'Attivo', manutenzione:'In manutenzione', inattivo:'Inattivo' }[a.stato] || a.stato;
    const statoColor = { attivo:'#27AE60', manutenzione:'#F39C12', inattivo:'#E74C3C' }[a.stato] || '';
    const campi = [
      ['Codice', a.codice], ['Tipo', a.tipo],
      ['Stato', `<span style="color:${statoColor};font-weight:600">${statoLabel}</span>`],
      ['Indirizzo', a.indirizzo],
      ['Città', a.citta + (a.provincia ? ' (' + a.provincia + ')' : '')],
      ['CAP', a.cap],
      ['Superficie', a.superficie_mq ? a.superficie_mq.toLocaleString('it-IT') + ' m²' : '–'],
      ['Anno costruzione', a.anno_costruzione || '–'],
      ['Referente', a.referente || '–'],
      ['Telefono', a.telefono || '–'],
      ['Email', a.email || '–'],
      ['Coordinate', (a.lat||0).toFixed(5) + ', ' + (a.lon||0).toFixed(5)],
      ['Note', a.note || '–', true]
    ];
    document.getElementById('edm-panel-anagrafica').innerHTML =
      `<div class="edm-detail-grid">${campi.map(([lbl, val, full]) =>
        `<div class="edm-detail-row${full ? ' full' : ''}">
           <span class="edm-detail-label">${lbl}</span>
           <span class="edm-detail-value">${val || '–'}</span>
         </div>`).join('')}</div>`;

    // ── Consumi ────────────────────────────────────────────────
    document.getElementById('edm-panel-consumi').innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <select id="edm-consumi-ore" style="background:var(--bg-secondary,#0A1628);border:1px solid var(--border,#1E3A5F);
          color:var(--text-primary,#E0F0FF);padding:4px 8px;border-radius:6px;font-size:12px;">
          <option value="24">Ultime 24 ore</option>
          <option value="168" selected>Ultima settimana</option>
          <option value="720">Ultimo mese</option>
        </select>
        <span id="edm-consumi-status" style="font-size:11px;color:var(--text-secondary,#7BAFC4);">Caricamento…</span>
      </div>
      <div id="edm-consumi-chart" style="width:100%;height:220px;"></div>
      <div id="edm-consumi-kpi" class="edm-kpi-grid" style="margin-top:12px;"></div>`;
    _edmCaricaConsumi(id, 168);
    document.getElementById('edm-consumi-ore').addEventListener('change', (e) => {
      _edmCaricaConsumi(id, parseInt(e.target.value));
    });

    // ── Occupancy ──────────────────────────────────────────────
    _edmCaricaOccupancy(id);

    // ── Allarmi ────────────────────────────────────────────────
    _edmCaricaAllarmi(id, a.nome);

    // ── ESG ────────────────────────────────────────────────────
    _edmCaricaEsg(id);

    // ── Impianti ───────────────────────────────────────────────
    _edmCaricaImpianti(id);

    // ── Zone ───────────────────────────────────────────────────
    _edmCaricaZone(id);

    // ── Bottone Floorplan (solo per edifici con BEMS) ──────────
    // Mostra se l'asset ha zone BEMS (verificato in _edmCaricaZone)
    // Per ora mostra solo per asset_id=6 (Sede Centrale Roma)
    if (id === 6) {
      const btn = document.getElementById('edm-btn-floorplan');
      btn.style.display = 'inline-flex';
      btn.onclick = () => window.open('/static/bems-floorplan.html', '_blank');
    }

  } catch(e) {
    document.getElementById('edm-panel-anagrafica').innerHTML =
      `<div style="text-align:center;padding:30px;color:#E74C3C;">
         <i class="fa fa-exclamation-triangle" style="font-size:28px;margin-bottom:10px;display:block;"></i>
         <div style="font-size:13px;">Impossibile caricare i dati dell'asset.</div>
         <div style="font-size:11px;margin-top:6px;color:var(--text-secondary,#7BAFC4);">${e.message}</div>
       </div>`;
  }
}

// ── Chiudi modale ──────────────────────────────────────────────────────
function chiudiDettaglioAsset() {
  document.getElementById('edm-overlay').style.display = 'none';
}

// ══════════════════════════════════════════════════════════════════════
// FUNZIONI INTERNE DI CARICAMENTO TAB
// ══════════════════════════════════════════════════════════════════════

async function _edmCaricaConsumi(assetId, ore) {
  const statusEl = document.getElementById('edm-consumi-status');
  const chartEl  = document.getElementById('edm-consumi-chart');
  const kpiEl    = document.getElementById('edm-consumi-kpi');
  if (!chartEl) return;
  if (statusEl) statusEl.textContent = 'Caricamento…';
  try {
    const [readRes, telRes] = await Promise.all([
      fetch(`/api/energy/readings/${assetId}?ore=${ore}`, {
        headers: { 'Authorization': 'Bearer ' + API.getToken() }
      }),
      fetch(`/api/bems/buildings/${assetId}/telemetry/latest`, {
        headers: { 'Authorization': 'Bearer ' + API.getToken() }
      }).catch(() => null)
    ]);
    if (!readRes.ok) throw new Error('HTTP ' + readRes.status);
    const readings = await readRes.json();
    const telData  = telRes && telRes.ok ? await telRes.json() : {};

    const telValues    = Object.values(telData);
    const kwIstantaneo = telValues.reduce((s, z) => s + (z.power_kw || 0), 0);
    const tempMedia    = telValues.filter(z => z.temp_c != null).reduce((s, z, _, a) => s + z.temp_c / a.length, 0);
    const co2Media     = telValues.filter(z => z.co2_ppm != null).reduce((s, z, _, a) => s + z.co2_ppm / a.length, 0);

    if (!readings || readings.length === 0) {
      if (kpiEl && kwIstantaneo > 0) kpiEl.innerHTML = `
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="color:#F39C12">${kwIstantaneo.toFixed(1)}</div><div class="edm-kpi-lbl">kW istantaneo</div></div>
        ${tempMedia > 0 ? `<div class="edm-kpi-card"><div class="edm-kpi-val">${tempMedia.toFixed(1)}°C</div><div class="edm-kpi-lbl">Temp. media</div></div>` : ''}
        ${co2Media  > 0 ? `<div class="edm-kpi-card"><div class="edm-kpi-val">${co2Media.toFixed(0)}</div><div class="edm-kpi-lbl">CO₂ media (ppm)</div></div>` : ''}`;
      chartEl.innerHTML = '<p style="color:var(--text-secondary,#7BAFC4);font-size:13px;padding:20px;text-align:center;">Nessuna lettura storica disponibile.</p>';
      if (statusEl) statusEl.textContent = '';
      return;
    }

    const totale = readings.reduce((s, r) => s + (r.valore || 0), 0);
    const media  = totale / readings.length;
    const max    = Math.max(...readings.map(r => r.valore || 0));

    if (kpiEl) kpiEl.innerHTML = `
      ${kwIstantaneo > 0 ? `<div class="edm-kpi-card" style="border-color:#F39C12"><div class="edm-kpi-val" style="color:#F39C12">${kwIstantaneo.toFixed(1)}</div><div class="edm-kpi-lbl"><i class="fa fa-bolt"></i> kW ora</div></div>` : ''}
      <div class="edm-kpi-card"><div class="edm-kpi-val">${totale.toFixed(0)}</div><div class="edm-kpi-lbl">Totale ${readings[0]?.unita || 'kWh'}</div></div>
      <div class="edm-kpi-card"><div class="edm-kpi-val">${media.toFixed(1)}</div><div class="edm-kpi-lbl">Media lettura</div></div>
      <div class="edm-kpi-card"><div class="edm-kpi-val">${max.toFixed(1)}</div><div class="edm-kpi-lbl">Picco max</div></div>
      ${tempMedia > 0 ? `<div class="edm-kpi-card"><div class="edm-kpi-val">${tempMedia.toFixed(1)}°C</div><div class="edm-kpi-lbl">Temp. media</div></div>` : ''}
      ${co2Media  > 0 ? `<div class="edm-kpi-card"><div class="edm-kpi-val">${co2Media.toFixed(0)}</div><div class="edm-kpi-lbl">CO₂ media (ppm)</div></div>` : ''}`;

    if (statusEl) statusEl.textContent = `${readings.length} letture`;

    if (typeof Plotly !== 'undefined') {
      const tipi   = [...new Set(readings.map(r => r.tipo || r.label || 'Energia'))];
      const colori = ['#3498DB','#27AE60','#F39C12','#9B59B6','#E74C3C'];
      const traces = tipi.map((tipo, idx) => {
        const dati = readings.filter(r => (r.tipo || r.label || 'Energia') === tipo);
        return { x: dati.map(r => r.ts), y: dati.map(r => r.valore), name: tipo,
                 type:'scatter', mode:'lines', line:{ color: colori[idx % colori.length], width:2 } };
      });
      const isDark = (localStorage.getItem('gam_tema') || 'dark') !== 'light';
      const layout = {
        paper_bgcolor:'transparent', plot_bgcolor:'transparent',
        font:{ color: isDark ? '#7BAFC4' : '#57606a', size:10, family:'Inter,sans-serif' },
        xaxis:{ gridcolor: isDark ? '#1E3A5F' : '#d0d7de' },
        yaxis:{ gridcolor: isDark ? '#1E3A5F' : '#d0d7de', title:{ text: readings[0]?.unita || 'kWh', font:{size:10} } },
        margin:{ t:10, r:10, b:40, l:50 },
        legend:{ orientation:'h', y:-0.25, font:{size:10} },
        showlegend: tipi.length > 1
      };
      // Ritardo per attendere che la modale sia completamente visibile prima di misurare la larghezza
      setTimeout(() => {
        Plotly.newPlot(chartEl, traces, layout, { responsive:true, displayModeBar:false });
        // Forza un resize dopo il render per occupare tutta la larghezza disponibile
        setTimeout(() => { if (chartEl._fullLayout) Plotly.relayout(chartEl, {}); }, 50);
      }, 80);
    } else {
      chartEl.innerHTML = `<p style="color:var(--text-secondary,#7BAFC4);font-size:12px;padding:8px;">
        Totale: <strong>${totale.toFixed(1)} ${readings[0]?.unita || 'kWh'}</strong> (${readings.length} letture)</p>`;
    }
  } catch(e) {
    if (chartEl) chartEl.innerHTML = `<p style="color:#E74C3C;font-size:13px;padding:20px;text-align:center;">Dati consumi non disponibili</p>`;
    if (statusEl) statusEl.textContent = '';
  }
}

async function _edmCaricaOccupancy(assetId) {
  const el = document.getElementById('edm-panel-occupancy');
  if (!el) return;
  try {
    const [summaryRes, telRes, zonesRes] = await Promise.all([
      fetch('/api/occupancy/summary', { headers: { 'Authorization': 'Bearer ' + API.getToken() } }),
      fetch(`/api/bems/buildings/${assetId}/telemetry/latest`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } }).catch(() => null),
      fetch(`/api/bems/buildings/${assetId}/zones`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } }).catch(() => null)
    ]);
    const items   = summaryRes.ok ? await summaryRes.json() : [];
    const telData = telRes && telRes.ok ? await telRes.json() : {};
    const zones   = zonesRes && zonesRes.ok ? await zonesRes.json() : [];
    const occ     = items.find(i => i.asset_id === assetId);

    const telValues   = Object.values(telData);
    const zoneOccupate = telValues.filter(z => z.occupancy === true).length;
    const zoneTotali   = telValues.length;

    const pct        = occ ? (occ.pct_occupancy || 0) : (zoneTotali > 0 ? (zoneOccupate / zoneTotali * 100) : 0);
    const presenti   = occ ? occ.presenti : zoneOccupate;
    const capMax     = occ ? occ.capacita_max : zones.reduce((s, z) => s + (z.capacita_persone || 0), 0);
    const statoColor = pct >= 90 ? '#E74C3C' : pct >= 70 ? '#F39C12' : pct > 0 ? '#27AE60' : '#95A5A6';

    let html = `
      <div class="edm-kpi-grid" style="margin-bottom:12px;">
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="color:${statoColor}">${presenti}</div><div class="edm-kpi-lbl">Presenti</div></div>
        <div class="edm-kpi-card"><div class="edm-kpi-val">${capMax || '–'}</div><div class="edm-kpi-lbl">Capienza max</div></div>
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="color:${statoColor}">${pct.toFixed(0)}%</div><div class="edm-kpi-lbl">Occupancy</div></div>
        ${zoneTotali > 0 ? `<div class="edm-kpi-card"><div class="edm-kpi-val">${zoneOccupate}/${zoneTotali}</div><div class="edm-kpi-lbl">Zone attive</div></div>` : ''}
      </div>
      <div style="background:var(--bg-secondary,#0A1628);border-radius:4px;height:6px;overflow:hidden;margin-bottom:14px;">
        <div style="background:${statoColor};height:100%;width:${Math.min(pct,100)}%;border-radius:4px;transition:width 0.5s;"></div>
      </div>`;

    if (zones.length > 0 && Object.keys(telData).length > 0) {
      const piani = {};
      zones.forEach(z => {
        const k = z.floor_nome || z.floor_id || 'Piano';
        if (!piani[k]) piani[k] = [];
        piani[k].push(z);
      });
      html += `<div style="font-size:11px;font-weight:700;color:var(--text-secondary,#7BAFC4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Dettaglio per zona</div>`;
      for (const [pianoNome, zoneList] of Object.entries(piani)) {
        const zoneConTel = zoneList.filter(z => telData[z.zone_id]);
        if (zoneConTel.length === 0) continue;
        html += `<div style="font-size:10px;font-weight:600;color:var(--accent,#00B4D8);margin-bottom:5px;">${pianoNome}</div>`;
        html += `<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">`;
        zoneConTel.forEach(z => {
          const tel    = telData[z.zone_id] || {};
          const isOcc  = tel.occupancy === true;
          const oc     = isOcc ? '#27AE60' : '#95A5A6';
          const tempStr = tel.temp_c  != null ? `${tel.temp_c.toFixed(1)}°C` : '';
          const co2Str  = tel.co2_ppm != null ? `${tel.co2_ppm.toFixed(0)} ppm` : '';
          html += `
            <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;
                        background:var(--bg-secondary,#0A1628);border-radius:6px;border-left:3px solid ${oc};">
              <i class="fa fa-circle" style="font-size:8px;color:${oc};"></i>
              <span style="flex:1;font-size:11px;">${z.nome}</span>
              ${tempStr ? `<span style="font-size:10px;color:var(--text-secondary,#7BAFC4);"><i class="fa fa-thermometer-half" style="margin-right:2px;"></i>${tempStr}</span>` : ''}
              ${co2Str  ? `<span style="font-size:10px;color:var(--text-secondary,#7BAFC4);"><i class="fa fa-leaf" style="margin-right:2px;"></i>${co2Str}</span>` : ''}
              <span style="font-size:10px;font-weight:600;color:${oc};">${isOcc ? 'Occupata' : 'Libera'}</span>
            </div>`;
        });
        html += `</div>`;
      }
    }
    el.innerHTML = html;
  } catch(e) {
    if (el) el.innerHTML = `<p style="color:#E74C3C;font-size:13px;padding:20px;text-align:center;">Dati occupancy non disponibili</p>`;
  }
}

async function _edmCaricaAllarmi(assetId, nomeAsset) {
  const el = document.getElementById('edm-panel-allarmi');
  if (!el) return;
  try {
    const res = await fetch('/api/energy/anomalies', { headers: { 'Authorization': 'Bearer ' + API.getToken() } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const anomalie = await res.json();
    const lista = anomalie.filter(a => !a.nome || a.nome.toLowerCase().includes((nomeAsset || '').toLowerCase().split(' ')[0]));
    const badge = document.getElementById('edm-alarm-badge');
    if (badge && lista.length > 0) {
      badge.innerHTML = ` <span style="background:#E74C3C;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;">${lista.length}</span>`;
    }
    if (lista.length === 0) {
      el.innerHTML = `<p style="color:#27AE60;font-size:13px;padding:20px;text-align:center;">
        <i class="fa fa-check-circle" style="margin-right:5px;"></i>Nessuna anomalia energetica rilevata.</p>`;
      return;
    }
    const sevColor = { alta:'#E74C3C', media:'#F39C12', bassa:'#F39C12' };
    el.innerHTML = lista.map(a => `
      <div class="edm-alarm-row">
        <i class="fa fa-bolt" style="color:${sevColor[a.severita]||'#F39C12'}"></i>
        <span style="flex:1;font-size:13px;">${a.tipo || 'Anomalia consumo'}</span>
        <span style="font-weight:600;color:${sevColor[a.severita]||'#F39C12'}">+${(a.delta_pct||0).toFixed(0)}%</span>
        <span style="background:${sevColor[a.severita]||'#F39C12'}20;color:${sevColor[a.severita]||'#F39C12'};
          padding:2px 6px;border-radius:4px;font-size:10px;">${a.severita||'media'}</span>
      </div>`).join('');
  } catch(e) {
    if (el) el.innerHTML = `<p style="color:#E74C3C;font-size:13px;padding:20px;text-align:center;">Allarmi non disponibili</p>`;
  }
}

async function _edmCaricaEsg(assetId) {
  const el = document.getElementById('edm-panel-esg');
  if (!el) return;
  try {
    const res = await fetch('/api/energy/summary', { headers: { 'Authorization': 'Bearer ' + API.getToken() } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = await res.json();
    const item  = items.find(i => i.asset_id === assetId);
    if (!item) {
      el.innerHTML = `<p style="color:var(--text-secondary,#7BAFC4);font-size:13px;padding:20px;text-align:center;">Dati di efficienza energetica non disponibili.</p>`;
      return;
    }
    const ratingColor = { A:'#27AE60', B:'#4CAF50', C:'#F39C12', D:'#E74C3C', E:'#c0392b' };
    const rc = ratingColor[item.rating_esg] || 'var(--text-secondary,#7BAFC4)';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        <div style="width:56px;height:56px;border-radius:50%;background:${rc};
          display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;">${item.rating_esg||'–'}</div>
        <div>
          <div style="font-size:11px;color:var(--text-secondary,#7BAFC4);">Rating efficienza energetica</div>
          <div style="font-size:22px;font-weight:700;">${(item.kwh_giorno||0).toFixed(0)} kWh/giorno</div>
          <div style="font-size:11px;color:var(--text-secondary,#7BAFC4);">${(item.kwh_mq||0).toFixed(2)} kWh/m²</div>
        </div>
      </div>
      <div class="edm-kpi-grid">
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="font-size:16px;">${(item.co2_kg_giorno||0).toFixed(1)}</div><div class="edm-kpi-lbl">kg CO₂/giorno</div></div>
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="font-size:16px;">€ ${(item.costo_euro_giorno||0).toFixed(2)}</div><div class="edm-kpi-lbl">Costo/giorno</div></div>
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="font-size:16px;">${(item.kwh_mese||0).toFixed(0)}</div><div class="edm-kpi-lbl">kWh/mese</div></div>
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="font-size:16px;">${(item.efficienza_score||0).toFixed(0)}%</div><div class="edm-kpi-lbl">Score efficienza</div></div>
      </div>
      ${item.anomalia_rilevata
        ? `<div style="margin-top:12px;padding:8px 12px;background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);border-radius:6px;font-size:12px;color:#E74C3C;">
             <i class="fa fa-exclamation-triangle" style="margin-right:5px;"></i>Anomalia di consumo rilevata — verificare i vettori energetici</div>`
        : `<div style="margin-top:12px;padding:8px 12px;background:rgba(39,174,96,0.1);border:1px solid rgba(39,174,96,0.3);border-radius:6px;font-size:12px;color:#27AE60;">
             <i class="fa fa-check-circle" style="margin-right:5px;"></i>Consumi nella norma — nessuna anomalia rilevata</div>`}`;
  } catch(e) {
    if (el) el.innerHTML = `<p style="color:#E74C3C;font-size:13px;padding:20px;text-align:center;">Dati di efficienza energetica non disponibili</p>`;
  }
}

async function _edmCaricaImpianti(assetId) {
  const el = document.getElementById('edm-panel-impianti');
  if (!el) return;
  try {
    const res = await fetch(`/api/bems/buildings/${assetId}/plants`, {
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const plants = await res.json();
    if (!plants || plants.length === 0) {
      el.innerHTML = `<p style="color:var(--text-secondary,#7BAFC4);font-size:13px;text-align:center;padding:20px;">Nessun impianto registrato per questo asset.</p>`;
      return;
    }
    const statoColor = { attivo:'#27AE60', manutenzione:'#F39C12', fermo:'#E74C3C', inattivo:'#95A5A6' };
    const tipoIcon   = { hvac:'fa-snowflake-o', illuminazione:'fa-lightbulb-o', contatore:'fa-tachometer',
                         sub_meter:'fa-plug', ups:'fa-battery-full', generatore:'fa-bolt', altro:'fa-cog' };
    el.innerHTML = `
      <div style="margin-bottom:8px;font-size:11px;color:var(--text-secondary,#7BAFC4);">${plants.length} impianti registrati</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${plants.map(p => {
          const sc    = statoColor[p.stato] || '#95A5A6';
          const ic    = tipoIcon[p.tipo] || 'fa-cog';
          const piano = p.floor_nome ? ` — ${p.floor_nome}` : '';
          return `
          <div style="background:var(--bg-secondary,#0A1628);border:1px solid var(--border,#1E3A5F);
            border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px;">
            <i class="fa ${ic}" style="font-size:18px;color:${sc};width:24px;text-align:center;"></i>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;">${p.nome}</div>
              <div style="font-size:11px;color:var(--text-secondary,#7BAFC4);">${p.tipo}${piano}</div>
            </div>
            <div style="text-align:right;">
              ${p.potenza_kw ? `<div style="font-size:11px;color:var(--text-secondary,#7BAFC4);">${p.potenza_kw} kW</div>` : ''}
            </div>
            <span style="background:${sc}20;color:${sc};border:1px solid ${sc}40;
              border-radius:10px;padding:2px 8px;font-size:10px;font-weight:600;">${p.stato.toUpperCase()}</span>
          </div>`;
        }).join('')}
      </div>`;
  } catch(e) {
    if (el) el.innerHTML = `<p style="color:#E74C3C;font-size:13px;padding:20px;text-align:center;">Impianti non disponibili</p>`;
  }
}

async function _edmCaricaZone(assetId) {
  const el = document.getElementById('edm-panel-zone');
  if (!el) return;
  try {
    const [zonesRes, telRes] = await Promise.all([
      fetch(`/api/bems/buildings/${assetId}/zones`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } }),
      fetch(`/api/bems/buildings/${assetId}/telemetry/latest`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } }).catch(() => null)
    ]);
    if (!zonesRes.ok) throw new Error('HTTP ' + zonesRes.status);
    const zones   = await zonesRes.json();
    const telData = telRes && telRes.ok ? await telRes.json() : {};

    if (!zones || zones.length === 0) {
      el.innerHTML = `<p style="color:var(--text-secondary,#7BAFC4);font-size:13px;text-align:center;padding:20px;">Nessuna zona BEMS configurata per questo asset.</p>`;
      return;
    }

    const piani = {};
    zones.forEach(z => {
      const k = z.floor_nome || z.floor_id || 'Piano';
      if (!piani[k]) piani[k] = [];
      piani[k].push(z);
    });

    const tipoIcon = { ufficio:'fa-briefcase', sala_riunioni:'fa-users', corridoio:'fa-arrows-h',
                       bagno:'fa-male', reception:'fa-info-circle', server:'fa-server',
                       archivio:'fa-archive', altro:'fa-th-large' };

    let html = `<div style="margin-bottom:8px;font-size:11px;color:var(--text-secondary,#7BAFC4);">${zones.length} zone BEMS registrate</div>`;

    for (const [pianoNome, zoneList] of Object.entries(piani)) {
      html += `<div style="margin-bottom:12px;">`;
      html += `<div style="font-size:11px;font-weight:700;color:var(--accent,#00B4D8);text-transform:uppercase;
        letter-spacing:0.5px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border,#1E3A5F);">${pianoNome}</div>`;
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;">`;
      zoneList.forEach(z => {
        const tel    = telData[z.zone_id] || {};
        const isOcc  = tel.occupancy === true;
        const oc     = isOcc ? '#27AE60' : '#95A5A6';
        const ic     = tipoIcon[z.tipo] || 'fa-th-large';
        const capStr = z.capacita_persone ? ` · ${z.capacita_persone} pers.` : '';
        html += `
          <div style="background:var(--bg-secondary,#0A1628);border:1px solid var(--border,#1E3A5F);
            border-left:3px solid ${oc};border-radius:8px;padding:10px 12px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
              <i class="fa ${ic}" style="font-size:13px;color:${oc};"></i>
              <div style="font-size:12px;font-weight:600;flex:1;">${z.nome}</div>
              <span style="font-size:9px;color:var(--text-secondary,#7BAFC4);background:var(--bg-primary,#060E1A);
                padding:1px 5px;border-radius:8px;">${z.tipo}</span>
            </div>
            ${z.superficie_mq ? `<div style="font-size:10px;color:var(--text-secondary,#7BAFC4);margin-bottom:4px;">
              <i class="fa fa-expand" style="margin-right:3px;"></i>${z.superficie_mq} m²${capStr}</div>` : ''}
            ${tel.power_kw != null ? `<div style="font-size:10px;color:var(--text-secondary,#7BAFC4);">
              <i class="fa fa-bolt" style="margin-right:3px;color:#F39C12;"></i>${tel.power_kw.toFixed(2)} kW</div>` : ''}
            ${tel.temp_c   != null ? `<div style="font-size:10px;color:var(--text-secondary,#7BAFC4);">
              <i class="fa fa-thermometer-half" style="margin-right:3px;color:#3498DB;"></i>${tel.temp_c.toFixed(1)}°C</div>` : ''}
            ${tel.co2_ppm  != null ? `<div style="font-size:10px;color:var(--text-secondary,#7BAFC4);">
              <i class="fa fa-leaf" style="margin-right:3px;color:#27AE60;"></i>${tel.co2_ppm.toFixed(0)} ppm CO₂</div>` : ''}
            <div style="font-size:10px;font-weight:600;color:${oc};margin-top:4px;">${isOcc ? 'Occupata' : 'Libera'}</div>
          </div>`;
      });
      html += `</div></div>`;
    }
    el.innerHTML = html;
  } catch(e) {
    if (el) el.innerHTML = `<p style="color:#E74C3C;font-size:13px;padding:20px;text-align:center;">Zone non disponibili: ${e.message}</p>`;
  }
}

// ── Adapter compatibilità efficiency-map-core.js ───────────────────────
// efficiency-map-core.js chiama selezionaAsset(feature, marker)
// che a sua volta chiamava apriModaleAsset(id). Qui li redefiniamo
// come wrapper della nuova modale condivisa.
function selezionaAsset(feature, marker) {
  if (typeof map !== 'undefined' && map && marker) map.panTo(marker.getLatLng());
  apriDettaglioAsset(feature.properties.id);
}
// Alias per retrocompatibilità con eventuali altri riferimenti
function apriModaleAsset(id) { apriDettaglioAsset(id); }
function chiudiModaleAsset() { chiudiDettaglioAsset(); }
