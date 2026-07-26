/**
 * efficiency-detail-modal.js — Modale dettaglio asset condivisa
 *
 * Componente autonomo: inietta il markup HTML della modale nel <body>,
 * gestisce tutti i 6 tab (Anagrafica, Consumi, Allarmi, Efficienza energetica,
 * Impianti, Zone & Occupancy) e si apre con apriDettaglioAsset(id).
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
      <button class="edm-tab" data-tab="allarmi"><i class="fa fa-bell"></i> Allarmi <span id="edm-alarm-badge"></span></button>
      <button class="edm-tab" data-tab="esg"><i class="fa fa-leaf"></i> Efficienza energetica</button>
      <button class="edm-tab" data-tab="impianti"><i class="fa fa-cogs"></i> Impianti</button>
      <button class="edm-tab" data-tab="zone"><i class="fa fa-th-large"></i> Zone &amp; Occupancy</button>
      <button class="edm-tab" data-tab="bollette"><i class="fa fa-file-invoice-dollar"></i> Tariffe &amp; Bollette</button>
    </div>

    <!-- BODY -->
    <div style="flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;min-height:0;">
      <div id="edm-panel-anagrafica" class="edm-panel active"></div>
      <div id="edm-panel-consumi"    class="edm-panel"></div>
      <div id="edm-panel-allarmi"    class="edm-panel"></div>
      <div id="edm-panel-esg"        class="edm-panel"></div>
      <div id="edm-panel-impianti"   class="edm-panel"></div>
      <div id="edm-panel-zone"       class="edm-panel"></div>
      <div id="edm-panel-bollette"   class="edm-panel"></div>
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
/* ── Tariffe & Bollette ─────────────────────────────────────────────── */
.edm-inv-section-title {
  font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;
  color:var(--text-secondary,#7BAFC4);margin:16px 0 8px;padding-bottom:6px;
  border-bottom:1px solid var(--border,#1E3A5F);
}
.edm-inv-section-title:first-child { margin-top:0; }
.edm-inv-commodity-strip {
  display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:4px;
}
.edm-inv-commodity-card {
  background:var(--bg-secondary,#0A1628);border:1px solid var(--border,#1E3A5F);
  border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;
}
.edm-inv-commodity-card.electricity  { border-left:3px solid var(--accent-blue,#00A3E0); }
.edm-inv-commodity-card.gas-methane { border-left:3px solid var(--accent-orange,#F39C12); }
.edm-inv-commodity-card.gas-gpl     { border-left:3px solid #E67E22; }
.edm-inv-commodity-card.water       { border-left:3px solid #3498DB; }
.edm-inv-commodity-card.heating-oil { border-left:3px solid #8E44AD; }
.edm-inv-commodity-card.diesel      { border-left:3px solid #7F8C8D; }
.edm-inv-commodity-card.petrol      { border-left:3px solid #27AE60; }
.edm-inv-commodity-label { font-size:10px;color:var(--text-secondary,#7BAFC4);text-transform:uppercase;letter-spacing:0.5px; }
.edm-inv-commodity-cost  { font-size:20px;font-weight:700;color:var(--text-primary,#E0F0FF); }
.edm-inv-commodity-unit  { font-size:10px;color:var(--text-muted,#4A7A9B); }
.edm-inv-commodity-date  { font-size:10px;color:var(--text-muted,#4A7A9B);margin-top:2px; }
.edm-inv-table-wrap { overflow-x:auto;margin-bottom:4px; }
.edm-inv-table { width:100%;border-collapse:collapse;font-size:12px; }
.edm-inv-table th {
  text-align:left;padding:6px 8px;font-size:10px;font-weight:600;
  text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary,#7BAFC4);
  border-bottom:1px solid var(--border,#1E3A5F);white-space:nowrap;
}
.edm-inv-table td {
  padding:7px 8px;border-bottom:1px solid var(--border,#1E3A5F);
  color:var(--text-primary,#E0F0FF);vertical-align:middle;
}
.edm-inv-table tr:last-child td { border-bottom:none; }
.edm-inv-table tr:hover td { background:rgba(255,255,255,0.02); }
.edm-inv-actions { display:flex;gap:4px;justify-content:flex-end; }
.edm-inv-upload-area {
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px;
}
.edm-inv-processing-row {
  display:flex;align-items:center;gap:8px;padding:8px 10px;
  background:rgba(0,163,224,0.08);border:1px solid rgba(0,163,224,0.25);
  border-radius:6px;font-size:12px;color:var(--text-secondary,#7BAFC4);
  margin-bottom:6px;
}
.edm-inv-processing-spinner {
  width:14px;height:14px;border:2px solid var(--border,#1E3A5F);
  border-top-color:var(--accent-blue,#00A3E0);border-radius:50%;
  animation:edm-spin 0.8s linear infinite;flex-shrink:0;
}
  .edm-inv-wrong-asset {
    border-left: 3px solid var(--accent-red, #E74C3C);
    background: rgba(248,81,73,0.06);
  }
  .edm-inv-disambig-row {
  background:rgba(243,156,18,0.08);border:1px solid rgba(243,156,18,0.3);
  border-radius:6px;padding:10px 12px;margin-bottom:6px;font-size:12px;
}
.edm-inv-empty {
  text-align:center;padding:24px;color:var(--text-secondary,#7BAFC4);font-size:12px;
}
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
  ['consumi','allarmi','esg','impianti','zone'].forEach(t => {
    document.getElementById('edm-panel-' + t).innerHTML = _edmSpinner();
  });

  try {
    const [d, referenti] = await Promise.all([
      API.getAsset(id),
      fetch('/api/assets/' + id + '/referenti', { headers: { 'Authorization': 'Bearer ' + API.getToken() } })
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    ]);
    const a = d.asset;

    document.getElementById('edm-title').textContent = a.codice + ' — ' + a.nome;
    document.getElementById('edm-subtitle').textContent =
      a.tipo + ' · ' + a.citta + (a.provincia ? ' (' + a.provincia + ')' : '');

    // ── Anagrafica ───────────────────────────────────────────────────────────
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
      ['Coordinate', (a.lat||0).toFixed(5) + ', ' + (a.lon||0).toFixed(5)],
      ['Note', a.note || '–', true]
    ];

    // ── Sezione Referenti ────────────────────────────────────────────────────
    const canEdit = API.can('assets.update');
    const refHtml = _edmRenderReferenti(referenti, id, canEdit);

    document.getElementById('edm-panel-anagrafica').innerHTML =
      `<div class="edm-detail-grid">${campi.map(([lbl, val, full]) =>
        `<div class="edm-detail-row${full ? ' full' : ''}">
           <span class="edm-detail-label">${lbl}</span>
           <span class="edm-detail-value">${val || '–'}</span>
         </div>`).join('')}</div>
      <div class="mm-referenti-section">
        <div class="mm-section-header">
          <span><i class="fas fa-users" style="margin-right:6px;color:var(--accent);"></i>Referenti</span>
          ${canEdit ? `<button class="mm-btn-add-ref" onclick="_edmApriModaleNuovoReferente(${id})" title="Aggiungi referente"><i class="fas fa-plus"></i></button>` : ''}
        </div>
        ${refHtml}
      </div>`;

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

    // ── Allarmi ────────────────────────────────────────────────
    _edmCaricaAllarmi(id, a.nome);

    // ── ESG ────────────────────────────────────────────────────
    _edmCaricaEfficienza(id);

    // ── Impianti ───────────────────────────────────────────────
    _edmCaricaImpianti(id);

    // ── Zone ───────────────────────────────────────────────────
    _edmCaricaZone(id);

    // ── Tariffe & Bollette ─────────────────────────────────────
    _edmCaricaBollette(id);

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
        <i class="fa fa-circle-check" style="margin-right:5px;"></i>Nessuna anomalia energetica rilevata.</p>`;
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
             <i class="fa fa-circle-check" style="margin-right:5px;"></i>Consumi nella norma — nessuna anomalia rilevata</div>`}`;
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
    const tipoIcon   = { hvac:'fa-snowflake', illuminazione:'fa-lightbulb', contatore:'fa-tachometer',
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
    const [zonesRes, telRes, summaryRes] = await Promise.all([
      fetch(`/api/bems/buildings/${assetId}/zones`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } }),
      fetch(`/api/bems/buildings/${assetId}/telemetry/latest`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } }).catch(() => null),
      fetch('/api/occupancy/summary', { headers: { 'Authorization': 'Bearer ' + API.getToken() } }).catch(() => null)
    ]);
    if (!zonesRes.ok) throw new Error('HTTP ' + zonesRes.status);
    const zones      = await zonesRes.json();
    const telData    = telRes && telRes.ok ? await telRes.json() : {};
    const occItems   = summaryRes && summaryRes.ok ? await summaryRes.json() : [];
    const occ        = occItems.find(i => i.asset_id === assetId);

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

    // ── KPI Occupancy aggregati ──────────────────────────────────────────
    const telValues    = Object.values(telData);
    const zoneOccupate = telValues.filter(z => z.occupancy === true).length;
    const zoneTotali   = telValues.length;
    const pct          = occ ? (occ.pct_occupancy || 0) : (zoneTotali > 0 ? (zoneOccupate / zoneTotali * 100) : 0);
    const presenti     = occ ? occ.presenti : zoneOccupate;
    const capMax       = occ ? occ.capacita_max : zones.reduce((s, z) => s + (z.capacita_persone || 0), 0);
    const statoColor   = pct >= 90 ? '#E74C3C' : pct >= 70 ? '#F39C12' : pct > 0 ? '#27AE60' : '#95A5A6';

    let html = `
      <div class="edm-kpi-grid" style="margin-bottom:12px;">
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="color:${statoColor}">${presenti}</div><div class="edm-kpi-lbl">Presenti</div></div>
        <div class="edm-kpi-card"><div class="edm-kpi-val">${capMax || '–'}</div><div class="edm-kpi-lbl">Capienza max</div></div>
        <div class="edm-kpi-card"><div class="edm-kpi-val" style="color:${statoColor}">${pct.toFixed(0)}%</div><div class="edm-kpi-lbl">Occupancy</div></div>
        ${zoneTotali > 0 ? `<div class="edm-kpi-card"><div class="edm-kpi-val">${zoneOccupate}/${zoneTotali}</div><div class="edm-kpi-lbl">Zone attive</div></div>` : ''}
      </div>
      <div style="background:var(--bg-secondary,#0A1628);border-radius:4px;height:6px;overflow:hidden;margin-bottom:16px;">
        <div style="background:${statoColor};height:100%;width:${Math.min(pct,100)}%;border-radius:4px;transition:width 0.5s;"></div>
      </div>
      <div style="margin-bottom:8px;font-size:11px;color:var(--text-secondary,#7BAFC4);">${zones.length} zone BEMS registrate</div>`;

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
    if (el) el.innerHTML = `<p style="color:#E74C3C;font-size:13px;padding:20px;text-align:center;">Zone & Occupancy non disponibili: ${e.message}</p>`;
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


// ── Referenti: funzioni helper (condivise con GIS tramite stessi CSS) ──────

/**
 * Renderizza la griglia dei referenti per la tab Anagrafica del dimostratore.
 * Riusa le stesse classi CSS mm-ref-* del modulo GIS (map.css).
 */
function _edmRenderReferenti(referenti, assetId, canEdit) {
  if (!referenti || referenti.length === 0) {
    return '<p style="color:var(--text-secondary,#7BAFC4);font-size:12px;padding:8px 0;">Nessun referente associato.</p>';
  }

  const iconeRuolo = {
    responsabile_asset:        'fa-user-tie',
    responsabile_manutenzione: 'fa-wrench',
    responsabile_sicurezza:    'fa-shield-alt',
    facility_manager:          'fa-building',
    responsabile_it:           'fa-server',
    responsabile_energia:      'fa-bolt',
    proprietario:              'fa-landmark',
    locatore:                  'fa-key',
    fornitore_manutenzione:    'fa-tools',
    referente_legale:          'fa-balance-scale',
    referente_emergenze:       'fa-fire-extinguisher',
  };

  const obbligatori = referenti.filter(r => r.obbligatorio);
  const facoltativi = referenti.filter(r => !r.obbligatorio);

  function renderCard(r) {
    const icona  = iconeRuolo[r.ruolo] || 'fa-user';
    const hasRef = r.referente_id !== null;
    const editBtn = canEdit
      ? `<button class="mm-ref-edit-btn" onclick="_edmApriModaleEditReferente(${assetId}, '${r.ruolo}', ${r.referente_id || 'null'})" title="${hasRef ? 'Modifica' : 'Assegna'}">
           <i class="fas ${hasRef ? 'fa-pen' : 'fa-plus'}"></i>
         </button>`
      : '';
    const removeBtn = (canEdit && hasRef)
      ? `<button class="mm-ref-remove-btn" onclick="_edmRimuoviReferente(${assetId}, '${r.ruolo}')" title="Rimuovi"><i class="fas fa-xmark"></i></button>`
      : '';

    if (!hasRef) {
      return `
        <div class="mm-ref-card mm-ref-empty">
          <div class="mm-ref-icon"><i class="fas ${icona}"></i></div>
          <div class="mm-ref-body">
            <div class="mm-ref-ruolo">${r.label}</div>
            <div class="mm-ref-nome" style="color:var(--text-secondary,#7BAFC4);font-style:italic;">Non assegnato</div>
          </div>
          <div class="mm-ref-actions">${editBtn}</div>
        </div>`;
    }

    return `
      <div class="mm-ref-card">
        <div class="mm-ref-icon"><i class="fas ${icona}"></i></div>
        <div class="mm-ref-body">
          <div class="mm-ref-ruolo">${r.label}</div>
          <div class="mm-ref-nome">${r.nome} ${r.cognome}</div>
          <div class="mm-ref-contatti">
            ${r.telefono ? `<a href="tel:${r.telefono}" class="mm-ref-link"><i class="fas fa-phone"></i> ${r.telefono}</a>` : ''}
            ${r.email    ? `<a href="mailto:${r.email}" class="mm-ref-link"><i class="fas fa-envelope"></i> ${r.email}</a>` : ''}
          </div>
        </div>
        <div class="mm-ref-actions">${editBtn}${removeBtn}</div>
      </div>`;
  }

  let html = '';
  if (obbligatori.length > 0) {
    html += `<div class="mm-ref-group-label">Obbligatori</div>`;
    html += `<div class="mm-ref-grid">${obbligatori.map(renderCard).join('')}</div>`;
  }
  const facoltativiAssegnati = facoltativi.filter(r => r.referente_id !== null);
  const facoltativiVuoti     = facoltativi.filter(r => r.referente_id === null);
  if (facoltativiAssegnati.length > 0 || canEdit) {
    html += `<div class="mm-ref-group-label" style="margin-top:10px;">Facoltativi</div>`;
    html += `<div class="mm-ref-grid">`;
    html += facoltativiAssegnati.map(renderCard).join('');
    if (canEdit) html += facoltativiVuoti.map(renderCard).join('');
    html += `</div>`;
  }
  return html;
}

async function _edmApriModaleEditReferente(assetId, ruolo, referenteIdCorrente) {
  let tutti = [];
  try {
    const res = await fetch('/api/referenti', { headers: { 'Authorization': 'Bearer ' + API.getToken() } });
    tutti = res.ok ? await res.json() : [];
  } catch(e) { tutti = []; }

  const ruoliLabel = {
    responsabile_asset:'Responsabile asset', responsabile_manutenzione:'Responsabile manutenzione',
    responsabile_sicurezza:'Responsabile sicurezza', facility_manager:'Facility Manager',
    responsabile_it:'Responsabile IT', responsabile_energia:'Responsabile energia',
    proprietario:'Proprietario', locatore:'Locatore',
    fornitore_manutenzione:'Fornitore manutenzione', referente_legale:'Referente legale',
    referente_emergenze:'Referente emergenze',
  };

  let m = document.getElementById('edm-ref-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'edm-ref-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:4000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(m);
  }

  const opzioni = tutti.map(r =>
    `<option value="${r.id}" ${r.id === referenteIdCorrente ? 'selected' : ''}>${r.cognome} ${r.nome}${r.ruolo_default ? ' — ' + r.ruolo_default.replace(/_/g,' ') : ''}</option>`
  ).join('');

  m.innerHTML = `
    <div style="background:var(--bg-panel,#0D1B2A);border:1px solid var(--border,#1E3A5F);border-radius:12px;
                padding:24px;width:420px;max-width:95vw;font-family:Inter,sans-serif;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;color:var(--text-primary,#E0F0FF);">
          Assegna referente — ${ruoliLabel[ruolo] || ruolo}
        </div>
        <button onclick="document.getElementById('edm-ref-modal').style.display='none'"
                style="background:none;border:none;color:var(--text-secondary,#7BAFC4);font-size:20px;cursor:pointer;">&times;</button>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:var(--text-secondary,#7BAFC4);display:block;margin-bottom:4px;">Seleziona referente dall'elenco</label>
        <select id="edm-ref-select" style="width:100%;padding:8px;background:var(--bg-card,#0A1628);
                border:1px solid var(--border,#1E3A5F);border-radius:6px;color:var(--text-primary,#E0F0FF);font-size:13px;">
          <option value="">— Seleziona —</option>
          ${opzioni}
        </select>
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:11px;color:var(--text-secondary,#7BAFC4);display:block;margin-bottom:4px;">Note (opzionale)</label>
        <input id="edm-ref-note" type="text" placeholder="Note sull'associazione..."
               style="width:100%;padding:8px;background:var(--bg-card,#0A1628);
               border:1px solid var(--border,#1E3A5F);border-radius:6px;color:var(--text-primary,#E0F0FF);font-size:13px;box-sizing:border-box;">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('edm-ref-modal').style.display='none'"
                style="padding:7px 16px;background:var(--bg-card);border:1px solid var(--border);
                       border-radius:6px;color:var(--text-secondary,#7BAFC4);cursor:pointer;font-size:13px;">Annulla</button>
        <button id="edm-ref-save-btn"
                style="padding:7px 16px;background:var(--accent,#2196F3);border:none;
                       border-radius:6px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Salva</button>
      </div>
      <div id="edm-ref-modal-err" style="margin-top:8px;font-size:12px;color:#E74C3C;display:none;"></div>
    </div>`;

  m.style.display = 'flex';

  document.getElementById('edm-ref-save-btn').onclick = async () => {
    const selId = parseInt(document.getElementById('edm-ref-select').value);
    const nota  = document.getElementById('edm-ref-note').value.trim();
    const errEl = document.getElementById('edm-ref-modal-err');
    if (!selId) { errEl.textContent = 'Seleziona un referente.'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    try {
      const res = await fetch(`/api/assets/${assetId}/referenti`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ referente_id: selId, ruolo: ruolo, note: nota || null })
      });
      if (!res.ok) throw new Error(await res.text());
      m.style.display = 'none';
      apriDettaglioAsset(assetId);
    } catch(e) {
      errEl.textContent = 'Errore: ' + e.message;
      errEl.style.display = 'block';
    }
  };
}

async function _edmRimuoviReferente(assetId, ruolo) {
  if (!confirm('Rimuovere il referente per questo ruolo?')) return;
  try {
    const res = await fetch(`/api/assets/${assetId}/referenti/${ruolo}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) throw new Error(await res.text());
    apriDettaglioAsset(assetId);
  } catch(e) {
    alert('Errore nella rimozione: ' + e.message);
  }
}

async function _edmApriModaleNuovoReferente(assetId) {
  let m = document.getElementById('edm-ref-new-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'edm-ref-new-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:4000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(m);
  }

  const ruoliOpts = [
    ['responsabile_asset','Responsabile asset'], ['responsabile_manutenzione','Responsabile manutenzione'],
    ['responsabile_sicurezza','Responsabile sicurezza'], ['facility_manager','Facility Manager'],
    ['responsabile_it','Responsabile IT'], ['responsabile_energia','Responsabile energia'],
    ['proprietario','Proprietario'], ['locatore','Locatore'],
    ['fornitore_manutenzione','Fornitore manutenzione'], ['referente_legale','Referente legale'],
    ['referente_emergenze','Referente emergenze'],
  ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  m.innerHTML = `
    <div style="background:var(--bg-panel,#0D1B2A);border:1px solid var(--border,#1E3A5F);border-radius:12px;
                padding:24px;width:460px;max-width:95vw;font-family:Inter,sans-serif;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;color:var(--text-primary,#E0F0FF);">Nuovo referente</div>
        <button onclick="document.getElementById('edm-ref-new-modal').style.display='none'"
                style="background:none;border:none;color:var(--text-secondary,#7BAFC4);font-size:20px;cursor:pointer;">&times;</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:var(--text-secondary,#7BAFC4);display:block;margin-bottom:3px;">Nome *</label>
          <input id="edm-rn-nome" type="text" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary,#E0F0FF);font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-secondary,#7BAFC4);display:block;margin-bottom:3px;">Cognome *</label>
          <input id="edm-rn-cognome" type="text" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary,#E0F0FF);font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-secondary,#7BAFC4);display:block;margin-bottom:3px;">Email</label>
          <input id="edm-rn-email" type="email" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary,#E0F0FF);font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-secondary,#7BAFC4);display:block;margin-bottom:3px;">Telefono</label>
          <input id="edm-rn-tel" type="text" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary,#E0F0FF);font-size:13px;box-sizing:border-box;">
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:var(--text-secondary,#7BAFC4);display:block;margin-bottom:3px;">Ruolo per questo asset *</label>
        <select id="edm-rn-ruolo" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary,#E0F0FF);font-size:13px;">
          ${ruoliOpts}
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('edm-ref-new-modal').style.display='none'"
                style="padding:7px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-secondary,#7BAFC4);cursor:pointer;font-size:13px;">Annulla</button>
        <button id="edm-rn-save"
                style="padding:7px 16px;background:var(--accent,#2196F3);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Crea e associa</button>
      </div>
      <div id="edm-rn-err" style="margin-top:8px;font-size:12px;color:#E74C3C;display:none;"></div>
    </div>`;

  m.style.display = 'flex';

  document.getElementById('edm-rn-save').onclick = async () => {
    const nome    = document.getElementById('edm-rn-nome').value.trim();
    const cognome = document.getElementById('edm-rn-cognome').value.trim();
    const email   = document.getElementById('edm-rn-email').value.trim();
    const tel     = document.getElementById('edm-rn-tel').value.trim();
    const ruolo   = document.getElementById('edm-rn-ruolo').value;
    const errEl   = document.getElementById('edm-rn-err');
    if (!nome || !cognome) { errEl.textContent = 'Nome e cognome sono obbligatori.'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    try {
      const r1 = await fetch('/api/referenti', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, cognome, email: email || null, telefono: tel || null, ruolo_default: ruolo })
      });
      if (!r1.ok) throw new Error(await r1.text());
      const { id: newId } = await r1.json();
      const r2 = await fetch(`/api/assets/${assetId}/referenti`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ referente_id: newId, ruolo: ruolo })
      });
      if (!r2.ok) throw new Error(await r2.text());
      m.style.display = 'none';
      apriDettaglioAsset(assetId);
    } catch(e) {
      errEl.textContent = 'Errore: ' + e.message;
      errEl.style.display = 'block';
    }
  };
}


// ══════════════════════════════════════════════════════════════════════
// TAB TARIFFE & BOLLETTE
// ══════════════════════════════════════════════════════════════════════

/**
 * _edmCaricaBollette(assetId)
 * Carica e renderizza il pannello Tariffe & Bollette per l'asset specificato.
 *
 * Struttura del pannello:
 *   1. Strip KPI costi unitari per commodity (Elettricità, Gas, Acqua)
 *   2. Sezione Forniture attive (supply_points) con azioni CRUD
 *   3. Sezione Storico bollette con upload e azioni per singola bolletta
 *   4. Modali inline: upload bolletta, form manuale, disambiguazione
 */
async function _edmCaricaBollette(assetId) {
  const el = document.getElementById('edm-panel-bollette');
  if (!el) return;

  const AUTH = { headers: { 'Authorization': 'Bearer ' + API.getToken() } };
  const canManage = API.can('documents.upload'); // riusa permesso documenti

  // ── Costanti commodity ──────────────────────────────────────────────
  const COMMODITY_META = {
    ELECTRICITY:  { label: 'Elettricità',          unit: 'kWh',   icon: 'fa-bolt',        cls: 'electricity',  color: 'var(--accent-blue,#00A3E0)' },
    GAS_METHANE:  { label: 'Gas Metano',            unit: 'Smc',   icon: 'fa-fire',        cls: 'gas-methane',  color: 'var(--accent-orange,#F39C12)' },
    GAS_GPL:      { label: 'GPL',                   unit: 'kg',    icon: 'fa-fire-flame-curved', cls: 'gas-gpl', color: '#E67E22' },
    WATER:        { label: 'Acqua',                 unit: 'm³',    icon: 'fa-droplet',     cls: 'water',        color: '#3498DB' },
    HEATING_OIL:  { label: 'Gasolio riscaldamento', unit: 'litri', icon: 'fa-oil-can',     cls: 'heating-oil',  color: '#8E44AD' },
    DIESEL:       { label: 'Gasolio autotrazione',  unit: 'litri', icon: 'fa-gas-pump',    cls: 'diesel',       color: '#7F8C8D' },
    PETROL:       { label: 'Benzina',               unit: 'litri', icon: 'fa-gas-pump',    cls: 'petrol',       color: '#27AE60' },
  };

  // ── Utility ─────────────────────────────────────────────────────────
  function fmtEur(v) {
    if (v == null) return '–';
    return '€ ' + parseFloat(v).toFixed(4).replace('.', ',');
  }
  function fmtData(s) {
    if (!s) return '–';
    return new Date(s).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' });
  }
  function fmtNum(v, dec = 2) {
    if (v == null) return '–';
    return parseFloat(v).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function statusBadge(status) {
    const map = {
      ready:                '<span class="badge badge-completato">Pronto</span>',
      processing:           '<span class="badge badge-in_corso">Elaborazione…</span>',
      needs_disambiguation: '<span class="badge badge-manutenzione">Da abbinare</span>',
      wrong_asset:          '<span class="badge badge-scaduta">Asset errato</span>',
      error:                '<span class="badge badge-scaduta">Errore</span>',
    };
    return map[status] || `<span class="badge">${status}</span>`;
  }
  function methodBadge(method) {
    if (method === 'LLM_EXTRACTED')  return '<span class="badge badge-attivo" title="Estratto da AI">AI</span>';
    if (method === 'LLM_CORRECTED')  return '<span class="badge badge-in_corso" title="Corretto manualmente">AI+M</span>';
    if (method === 'MANUAL')         return '<span class="badge badge-inattivo" title="Inserito manualmente">Man.</span>';
    return '';
  }

  // ── Fetch dati ───────────────────────────────────────────────────────
  let costs = [], supplyPoints = [], invoices = [];
  try {
    const [rCosts, rSp, rInv] = await Promise.all([
      fetch(`/api/bems/buildings/${assetId}/energy-costs`, AUTH),
      fetch(`/api/bems/buildings/${assetId}/supply-points`, AUTH),
      fetch(`/api/bems/buildings/${assetId}/invoices`, AUTH),
    ]);
    if (rCosts.ok)  costs        = (await rCosts.json()).energy_costs   || [];
    if (rSp.ok)     supplyPoints = (await rSp.json()).supply_points     || [];
    if (rInv.ok)    invoices     = (await rInv.json()).invoices         || [];
  } catch (e) {
    el.innerHTML = `<div class="edm-inv-empty"><i class="fa fa-exclamation-triangle"></i><br>Errore caricamento dati: ${e.message}</div>`;
    return;
  }

  // ── Polling bollette in elaborazione ────────────────────────────────
  const processing = invoices.filter(i => i.extraction_status === 'processing');
  if (processing.length > 0) {
    setTimeout(() => _edmCaricaBollette(assetId), 4000);
  }

  // ── 1. KPI costi unitari ─────────────────────────────────────────────
  const costsMap = {};
  costs.forEach(c => { costsMap[c.commodity] = c; });

  const kpiHtml = Object.entries(COMMODITY_META).map(([key, meta]) => {
    const c = costsMap[key];
    const costStr = c ? fmtEur(c.unit_cost_eur) : '–';
    const dateStr = c ? fmtData(c.last_updated) : '';
    return `
      <div class="edm-inv-commodity-card ${meta.cls}">
        <div class="edm-inv-commodity-label"><i class="fa ${meta.icon}" style="margin-right:4px;color:${meta.color}"></i>${meta.label}</div>
        <div class="edm-inv-commodity-cost">${costStr}</div>
        <div class="edm-inv-commodity-unit">€ / ${meta.unit}</div>
        ${dateStr ? `<div class="edm-inv-commodity-date">Agg. ${dateStr}</div>` : ''}
      </div>`;
  }).join('');

  // ── 2. Forniture attive ──────────────────────────────────────────────
  // Le forniture vengono create automaticamente al caricamento della prima bolletta.
  // Questa sezione mostra le forniture rilevate e permette di gestirle.
  let spHtml = '';
  if (supplyPoints.length === 0) {
    spHtml = `<div class="edm-inv-empty"><i class="fa fa-plug"></i><br>
      Nessuna fornitura configurata.<br>
      <small style="color:var(--text-muted)">Le forniture vengono create automaticamente al caricamento della prima bolletta.<br>
      In alternativa è possibile aggiungerle manualmente.</small><br>
      ${canManage ? `<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="_edmApriModaleNuovaFornitura(${assetId})"><i class="fa fa-plus"></i> Aggiungi fornitura</button>` : ''}</div>`;
  } else {
    spHtml = `
      <div class="edm-inv-table-wrap">
        <table class="edm-inv-table">
          <thead><tr>
            <th>Commodity</th><th>Fornitore</th><th>Codice POD/PDR</th>
            <th>Descrizione</th><th>Costo unitario</th><th>Stato</th>
            ${canManage ? '<th></th>' : ''}
          </tr></thead>
          <tbody>
            ${supplyPoints.map(sp => {
              const meta = COMMODITY_META[sp.commodity] || {};
              const activeLabel = sp.is_active
                ? '<span class="badge badge-attivo">Attiva</span>'
                : '<span class="badge badge-inattivo">Disattiva</span>';
              const costVal = sp.last_unit_cost_eur ? fmtEur(sp.last_unit_cost_eur) + ' / ' + (meta.unit || '') : '–';
              return `<tr>
                <td><i class="fa ${meta.icon || 'fa-bolt'}" style="color:${meta.color || ''};margin-right:4px"></i>${meta.label || sp.commodity}</td>
                <td>${sp.supplier_name || '–'}</td>
                <td><code style="font-size:11px">${sp.point_code || '–'}</code></td>
                <td>${sp.description || '–'}</td>
                <td>${costVal}</td>
                <td>${activeLabel}</td>
                ${canManage ? `<td><div class="edm-inv-actions">
                  <button class="btn-icon" title="Disattiva" onclick="_edmDisattivaSP(${assetId},'${sp.supply_point_id}')"><i class="fa fa-ban"></i></button>
                </div></td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ── 3. Bollette in elaborazione ──────────────────────────────────────
  const processingHtml = processing.map(i => `
    <div class="edm-inv-processing-row">
      <div class="edm-inv-processing-spinner"></div>
      <span>Estrazione AI in corso: <strong>${i.original_filename || 'bolletta.pdf'}</strong></span>
    </div>`).join('');

  // ── 4. Bollette con avvisi (wrong_asset + needs_disambiguation) ──────
  const wrongAsset = invoices.filter(i => i.extraction_status === 'wrong_asset');
  const wrongAssetHtml = wrongAsset.map(i => `
    <div class="edm-inv-disambig-row edm-inv-wrong-asset">
      <div style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <i class="fa fa-triangle-exclamation" style="color:var(--accent-red,#E74C3C);margin-top:2px"></i>
        <div>
          <strong>Bolletta caricata sull'asset sbagliato</strong><br>
          <span style="font-size:12px;color:var(--text-muted)">${i.original_filename || 'bolletta.pdf'} — ${i.llm_notes || ''}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        ${canManage ? `<button class="btn btn-secondary btn-sm" onclick="_edmEliminaBolletta(${assetId},'${i.invoice_id}')"><i class="fa fa-trash"></i> Scarta</button>` : ''}
      </div>
    </div>`).join('');

  const disambig = invoices.filter(i => i.extraction_status === 'needs_disambiguation');
  const disambigHtml = disambig.map(i => {
    const spOptions = supplyPoints
      .filter(sp => sp.commodity === i.commodity)
      .map(sp => `<option value="${sp.supply_point_id}">${sp.supplier_name} — ${sp.point_code || sp.description || sp.commodity}</option>`)
      .join('');
    return `
      <div class="edm-inv-disambig-row">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <i class="fa fa-exclamation-triangle" style="color:var(--accent-orange,#F39C12)"></i>
          <span><strong>${i.original_filename || 'bolletta.pdf'}</strong> — commodity <strong>${i.commodity}</strong>: fornitura non identificata automaticamente.</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;">
          <select id="disambig-sp-${i.invoice_id}" style="flex:1;min-width:180px;background:var(--bg-secondary,#0A1628);border:1px solid var(--border,#1E3A5F);color:var(--text-primary,#E0F0FF);padding:4px 8px;border-radius:6px;font-size:12px;">
            <option value="">— Seleziona fornitura —</option>
            ${spOptions}
          </select>
          <button class="btn btn-primary btn-sm" onclick="_edmConfermaDisambig(${assetId},'${i.invoice_id}')">Conferma</button>
          <button class="btn btn-secondary btn-sm" onclick="_edmEliminaBolletta(${assetId},'${i.invoice_id}')">Scarta</button>
        </div>
      </div>`;
  }).join('');

  // ── 5. Storico bollette ──────────────────────────────────────────────
  const ready = invoices.filter(i => i.extraction_status === 'ready' || i.extraction_status === 'error');
  let storicoHtml = '';
  if (ready.length === 0) {
    storicoHtml = `<div class="edm-inv-empty"><i class="fa fa-file-invoice"></i><br>Nessuna bolletta caricata.</div>`;
  } else {
    storicoHtml = `
      <div class="edm-inv-table-wrap">
        <table class="edm-inv-table">
          <thead><tr>
            <th>Commodity</th><th>Periodo</th>
            <th title="Importo totale della bolletta (IVA inclusa)">Importo totale</th>
            <th title="Costi diversi dalla quota materia prima: trasporto, distribuzione, oneri generali, accise, imposte">Quota oneri</th>
            <th>Consumo</th><th>€/Unità</th><th>Fornitore</th>
            <th>Metodo</th><th>Stato</th>
            ${canManage ? '<th></th>' : ''}
          </tr></thead>
          <tbody>
            ${ready.map(i => {
              const meta = COMMODITY_META[i.commodity] || {};
              const periodo = (i.period_from && i.period_to)
                ? fmtData(i.period_from) + ' – ' + fmtData(i.period_to)
                : fmtData(i.issue_date);
              return `<tr>
                <td><i class="fa ${meta.icon || 'fa-bolt'}" style="color:${meta.color || ''};margin-right:4px"></i>${meta.label || i.commodity}</td>
                <td style="white-space:nowrap">${periodo}</td>
                <td style="white-space:nowrap" title="Importo totale bolletta IVA inclusa">${i.total_amount_eur ? '€ ' + fmtNum(i.total_amount_eur) : '–'}</td>
                <td style="white-space:nowrap" title="Costi diversi dalla quota materia prima">${i.quota_oneri_eur != null ? '€ ' + fmtNum(i.quota_oneri_eur) : '–'}</td>
                <td style="white-space:nowrap">${i.consumption_quantity ? fmtNum(i.consumption_quantity, 0) + ' ' + (i.consumption_unit || '') : '–'}</td>
                <td style="white-space:nowrap">${fmtEur(i.unit_cost_eur)}</td>
                <td>${i.supplier_name || '–'}</td>
                <td>${methodBadge(i.extraction_method)}</td>
                <td>${statusBadge(i.extraction_status)}</td>
                ${canManage ? `<td><div class="edm-inv-actions">
                  ${i.file_path ? `<a class="btn-icon" href="/api/bems/buildings/${assetId}/invoices/${i.invoice_id}/file" target="_blank" title="Scarica PDF"><i class="fa fa-download"></i></a>` : ''}
                  <button class="btn-icon danger" title="Elimina" onclick="_edmEliminaBolletta(${assetId},'${i.invoice_id}')"><i class="fa fa-trash"></i></button>
                </div></td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ── Render finale ────────────────────────────────────────────────────
  el.innerHTML = `
    <div class="edm-inv-section-title"><i class="fa fa-euro-sign" style="margin-right:6px"></i>Costi unitari correnti</div>
    <div class="edm-inv-commodity-strip">${kpiHtml}</div>

    <div class="edm-inv-section-title" style="margin-top:20px">
      <i class="fa fa-plug" style="margin-right:6px"></i>Forniture
      ${canManage ? `<button class="btn btn-primary btn-sm" style="margin-left:auto;display:inline-flex;align-items:center;gap:4px" onclick="_edmApriModaleNuovaFornitura(${assetId})"><i class="fa fa-plus"></i> Aggiungi</button>` : ''}
    </div>
    ${spHtml}

    <div class="edm-inv-section-title" style="margin-top:20px">
      <i class="fa fa-file-invoice-dollar" style="margin-right:6px"></i>Bollette
      ${canManage ? `<div class="edm-inv-upload-area" style="display:inline-flex;margin-left:auto">
        <button class="btn btn-primary btn-sm" onclick="_edmApriUploadBolletta(${assetId})"><i class="fa fa-upload"></i> Carica PDF</button>
        <button class="btn btn-secondary btn-sm" onclick="_edmApriFormManualeBolletta(${assetId})"><i class="fa fa-pen"></i> Inserimento manuale</button>
      </div>` : ''}
    </div>
    ${processingHtml}
    ${wrongAssetHtml}
    ${disambigHtml}
    ${storicoHtml}`;
}

// ── Azioni Bollette ────────────────────────────────────────────────────────

async function _edmEliminaBolletta(assetId, invoiceId) {
  if (!confirm('Eliminare questa bolletta?')) return;
  const r = await fetch(`/api/bems/buildings/${assetId}/invoices/${invoiceId}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + API.getToken() }
  });
  if (r.ok) _edmCaricaBollette(assetId);
  else alert('Errore eliminazione bolletta');
}

async function _edmConfermaDisambig(assetId, invoiceId) {
  const sel = document.getElementById('disambig-sp-' + invoiceId);
  if (!sel || !sel.value) { alert('Selezionare una fornitura'); return; }
  const r = await fetch(`/api/bems/buildings/${assetId}/invoices/${invoiceId}/confirm-disambiguation`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: [{ invoice_id: invoiceId, supply_point_id: sel.value }] })
  });
  if (r.ok) _edmCaricaBollette(assetId);
  else alert('Errore conferma abbinamento');
}

async function _edmDisattivaSP(assetId, spId) {
  if (!confirm('Disattivare questa fornitura?')) return;
  const r = await fetch(`/api/bems/buildings/${assetId}/supply-points/${spId}/deactivate`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + API.getToken() }
  });
  if (r.ok) _edmCaricaBollette(assetId);
  else alert('Errore disattivazione fornitura');
}

// ── Upload bolletta PDF ────────────────────────────────────────────────────

function _edmApriUploadBolletta(assetId) {
  const MODAL_ID = 'edm-inv-upload-modal';
  let m = document.getElementById(MODAL_ID);
  if (!m) {
    m = document.createElement('div');
    m.id = MODAL_ID;
    m.className = 'modal-overlay';
    m.style.zIndex = '4000';
    m.innerHTML = `
      <div class="modal-box modal-sm">
        <div class="modal-header">
          <h3 class="modal-title"><i class="fa fa-upload" style="margin-right:6px"></i>Carica bolletta PDF</h3>
          <button class="btn-icon" onclick="document.getElementById('${MODAL_ID}').classList.remove('open')"><i class="fa fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>File PDF *</label>
            <div class="upload-zone" id="edm-inv-drop-zone"
                 onclick="document.getElementById('edm-inv-file-input').click()"
                 ondragover="event.preventDefault();this.classList.add('drag-over')"
                 ondragleave="this.classList.remove('drag-over')"
                 ondrop="_edmInvOnDrop(event)">
              <i class="fa fa-file-pdf upload-zone-icon" style="font-size:24px;display:block;margin-bottom:8px"></i>
              <div class="upload-zone-text">Trascina il PDF o <span class="upload-zone-link">clicca per selezionare</span></div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Solo PDF — max 10 MB</div>
            </div>
            <input type="file" id="edm-inv-file-input" style="display:none" accept=".pdf"
                   onchange="_edmInvOnFileSelected(this.files[0])">
            <div id="edm-inv-file-preview" class="det-box" style="display:none;margin-top:8px;align-items:center;gap:8px">
              <i class="fa fa-file-pdf upload-zone-icon"></i>
              <span id="edm-inv-file-name"></span>
              <span id="edm-inv-file-size" class="upload-zone-size"></span>
            </div>
          </div>
          <div id="edm-inv-upload-error" class="form-error"></div>
          <div id="edm-inv-upload-progress" style="display:none;margin-top:8px">
            <div class="upload-progress-wrap"><div id="edm-inv-progress-bar" class="upload-progress-fill"></div></div>
            <div class="det-meta" style="margin-top:4px;text-align:center">Caricamento in corso…</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('${MODAL_ID}').classList.remove('open')">Annulla</button>
          <button class="btn btn-primary" id="edm-inv-upload-btn" onclick="_edmEseguiUploadBolletta()"><i class="fa fa-upload"></i> Carica e analizza</button>
        </div>
      </div>`;
    document.body.appendChild(m);
  }
  m._assetId = assetId;
  m._file = null;
  document.getElementById('edm-inv-file-preview').style.display = 'none';
  document.getElementById('edm-inv-upload-error').textContent = '';
  document.getElementById('edm-inv-upload-progress').style.display = 'none';
  document.getElementById('edm-inv-progress-bar').style.width = '0%';
  m.classList.add('open');
}

function _edmInvOnDrop(event) {
  event.preventDefault();
  document.getElementById('edm-inv-drop-zone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) _edmInvOnFileSelected(file);
}

function _edmInvOnFileSelected(file) {
  const m = document.getElementById('edm-inv-upload-modal');
  if (!file) return;
  m._file = file;
  document.getElementById('edm-inv-file-name').textContent = file.name;
  const kb = file.size / 1024;
  document.getElementById('edm-inv-file-size').textContent =
    kb < 1024 ? kb.toFixed(1) + ' KB' : (kb / 1024).toFixed(2) + ' MB';
  document.getElementById('edm-inv-file-preview').style.display = 'flex';
  document.getElementById('edm-inv-upload-error').textContent = '';
}

async function _edmEseguiUploadBolletta() {
  const m = document.getElementById('edm-inv-upload-modal');
  const errEl = document.getElementById('edm-inv-upload-error');
  if (!m._file) { errEl.textContent = 'Selezionare un file PDF.'; return; }
  if (!m._file.name.toLowerCase().endsWith('.pdf')) { errEl.textContent = 'Il file deve essere in formato PDF.'; return; }
  if (m._file.size > 10 * 1024 * 1024) { errEl.textContent = 'Il file supera i 10 MB.'; return; }

  const btn = document.getElementById('edm-inv-upload-btn');
  btn.disabled = true;
  document.getElementById('edm-inv-upload-progress').style.display = 'block';

  // Simula avanzamento progress bar
  let pct = 0;
  const bar = document.getElementById('edm-inv-progress-bar');
  const timer = setInterval(() => {
    pct = Math.min(pct + 10, 85);
    bar.style.width = pct + '%';
  }, 200);

  try {
    const fd = new FormData();
    fd.append('file', m._file);
    const r = await fetch(`/api/bems/buildings/${m._assetId}/invoices/upload`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API.getToken() },
      body: fd
    });
    clearInterval(timer);
    bar.style.width = '100%';
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || 'Errore upload');
    }
    m.classList.remove('open');
    _edmCaricaBollette(m._assetId);
  } catch (e) {
    clearInterval(timer);
    errEl.textContent = e.message;
    document.getElementById('edm-inv-upload-progress').style.display = 'none';
  } finally {
    btn.disabled = false;
  }
}

// ── Inserimento manuale bolletta ───────────────────────────────────────────

function _edmApriFormManualeBolletta(assetId) {
  const MODAL_ID = 'edm-inv-manual-modal';
  let m = document.getElementById(MODAL_ID);
  if (!m) {
    m = document.createElement('div');
    m.id = MODAL_ID;
    m.className = 'modal-overlay';
    m.style.zIndex = '4000';
    m.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3 class="modal-title"><i class="fa fa-pen" style="margin-right:6px"></i>Inserimento manuale bolletta</h3>
          <button class="btn-icon" onclick="document.getElementById('${MODAL_ID}').classList.remove('open')"><i class="fa fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label>Commodity *</label>
              <select id="edm-inv-m-commodity">
                <option value="ELECTRICITY">Elettricità</option>
                <option value="GAS_METHANE">Gas Metano</option>
                <option value="GAS_GPL">GPL</option>
                <option value="WATER">Acqua</option>
                <option value="HEATING_OIL">Gasolio riscaldamento</option>
                <option value="DIESEL">Gasolio autotrazione</option>
                <option value="PETROL">Benzina</option>
              </select>
            </div>
            <div class="form-group">
              <label>Numero fattura</label>
              <input type="text" id="edm-inv-m-number" placeholder="es. FAT-2026-001">
            </div>
            <div class="form-group">
              <label>Data emissione</label>
              <input type="date" id="edm-inv-m-issue-date">
            </div>
            <div class="form-group">
              <label>Periodo dal</label>
              <input type="date" id="edm-inv-m-period-from">
            </div>
            <div class="form-group">
              <label>Periodo al</label>
              <input type="date" id="edm-inv-m-period-to">
            </div>
            <div class="form-group">
              <label title="Importo totale della bolletta, IVA inclusa">Importo totale (€) *
                <i class="fa fa-circle-info" style="font-size:11px;color:var(--text-muted);margin-left:3px" title="Inserire il totale della bolletta comprensivo di IVA, trasporto, oneri e accise"></i>
              </label>
              <input type="number" id="edm-inv-m-amount" step="0.01" placeholder="es. 412.50">
            </div>
            <div class="form-group">
              <label title="Costi diversi dalla quota materia prima">Quota oneri (€)
                <i class="fa fa-circle-info" style="font-size:11px;color:var(--text-muted);margin-left:3px" title="Costi diversi dalla quota materia prima: trasporto, distribuzione, oneri generali, accise, imposte. Lasciare vuoto se non disponibile."></i>
              </label>
              <input type="number" id="edm-inv-m-oneri" step="0.01" placeholder="es. 85.20 (opzionale)">
            </div>
            <div class="form-group">
              <label>Consumo *</label>
              <input type="number" id="edm-inv-m-consumption" step="0.001" placeholder="es. 3200">
            </div>
            <div class="form-group">
              <label>Unità</label>
              <select id="edm-inv-m-unit">
                <option value="kWh">kWh</option>
                <option value="Smc">Smc</option>
                <option value="kg">kg</option>
                <option value="m³">m³</option>
                <option value="litri">litri</option>
              </select>
            </div>
          </div>
          <div id="edm-inv-m-error" class="form-error" style="margin-top:8px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('${MODAL_ID}').classList.remove('open')">Annulla</button>
          <button class="btn btn-primary" onclick="_edmSalvaManualeBolletta()"><i class="fa fa-save"></i> Salva</button>
        </div>
      </div>`;
    document.body.appendChild(m);
  }
  m._assetId = assetId;
  document.getElementById('edm-inv-m-error').textContent = '';
  m.classList.add('open');
}

async function _edmSalvaManualeBolletta() {
  const m = document.getElementById('edm-inv-manual-modal');
  const errEl = document.getElementById('edm-inv-m-error');
  const assetId = m._assetId;
  const commodity    = document.getElementById('edm-inv-m-commodity').value;
  const amount       = parseFloat(document.getElementById('edm-inv-m-amount').value);
  const oneriRaw     = document.getElementById('edm-inv-m-oneri').value;
  const oneri        = oneriRaw ? parseFloat(oneriRaw) : null;
  const consumption  = parseFloat(document.getElementById('edm-inv-m-consumption').value);
  const unit         = document.getElementById('edm-inv-m-unit').value;
  const issueDate    = document.getElementById('edm-inv-m-issue-date').value;
  const periodFrom   = document.getElementById('edm-inv-m-period-from').value;
  const periodTo     = document.getElementById('edm-inv-m-period-to').value;
  const invNumber    = document.getElementById('edm-inv-m-number').value;

  if (!amount || isNaN(amount) || amount <= 0) { errEl.textContent = 'Importo non valido.'; return; }
  if (!consumption || isNaN(consumption) || consumption <= 0) { errEl.textContent = 'Consumo non valido.'; return; }

  const unitCost = amount / consumption;

  try {
    // Prima crea un invoice in stato processing, poi aggiorna con i dati manuali
    const rUp = await fetch(`/api/bems/buildings/${assetId}/invoices/upload`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API.getToken() },
      body: (() => { const fd = new FormData(); fd.append('file', new File([''], 'manuale.pdf', { type: 'application/pdf' })); return fd; })()
    });
    if (!rUp.ok) throw new Error('Errore creazione bolletta');
    const { invoice_id } = await rUp.json();

    const rPut = await fetch(`/api/bems/buildings/${assetId}/invoices/${invoice_id}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commodity, invoice_number: invNumber || null,
        issue_date: issueDate || null, period_from: periodFrom || null, period_to: periodTo || null,
        total_amount_eur: amount, quota_oneri_eur: oneri,
        consumption_quantity: consumption,
        consumption_unit: unit, unit_cost_eur: unitCost
      })
    });
    if (!rPut.ok) throw new Error('Errore salvataggio dati');
    m.classList.remove('open');
    _edmCaricaBollette(assetId);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ── Nuova fornitura (supply point) ────────────────────────────────────────

async function _edmApriModaleNuovaFornitura(assetId) {
  const MODAL_ID = 'edm-inv-sp-modal';
  let m = document.getElementById(MODAL_ID);

  // Carica fornitori esistenti per il select
  const AUTH = { headers: { 'Authorization': 'Bearer ' + API.getToken() } };
  const rSup = await fetch(`/api/bems/buildings/${assetId}/suppliers`, AUTH);
  const suppliers = rSup.ok ? (await rSup.json()).suppliers || [] : [];

  const supplierOptions = suppliers.map(s =>
    `<option value="${s.supplier_id}">${s.name}</option>`
  ).join('');

  if (!m) {
    m = document.createElement('div');
    m.id = MODAL_ID;
    m.className = 'modal-overlay';
    m.style.zIndex = '4000';
    document.body.appendChild(m);
  }
  m._assetId = assetId;
  m.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3 class="modal-title"><i class="fa fa-plug" style="margin-right:6px"></i>Nuova fornitura</h3>
        <button class="btn-icon" onclick="document.getElementById('${MODAL_ID}').classList.remove('open')"><i class="fa fa-xmark"></i></button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group" style="grid-column:1/-1">
            <label>Fornitore *</label>
            <select id="edm-sp-supplier">
              <option value="">— Seleziona fornitore —</option>
              ${supplierOptions}
              <option value="__new__">+ Nuovo fornitore…</option>
            </select>
          </div>
          <div class="form-group" id="edm-sp-new-supplier-wrap" style="display:none;grid-column:1/-1">
            <label>Nome fornitore *</label>
            <input type="text" id="edm-sp-new-supplier-name" placeholder="es. Enel Energia S.p.A.">
          </div>
          <div class="form-group">
            <label>Commodity *</label>
            <select id="edm-sp-commodity">
              <option value="ELECTRICITY">Elettricità</option>
              <option value="GAS_METHANE">Gas Metano</option>
              <option value="GAS_GPL">GPL</option>
              <option value="WATER">Acqua</option>
              <option value="HEATING_OIL">Gasolio riscaldamento</option>
              <option value="DIESEL">Gasolio autotrazione</option>
              <option value="PETROL">Benzina</option>
            </select>
          </div>
          <div class="form-group">
            <label>Codice POD / PDR / Matricola</label>
            <input type="text" id="edm-sp-point-code" placeholder="es. IT001E12345678">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>Descrizione</label>
            <input type="text" id="edm-sp-description" placeholder="es. Quadro generale piano terra">
          </div>
          <div class="form-group">
            <label>Data attivazione</label>
            <input type="date" id="edm-sp-activated-on">
          </div>
        </div>
        <div id="edm-sp-error" class="form-error" style="margin-top:8px"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('${MODAL_ID}').classList.remove('open')">Annulla</button>
        <button class="btn btn-primary" onclick="_edmSalvaNuovaFornitura(${assetId})"><i class="fa fa-save"></i> Salva</button>
      </div>
    </div>`;

  // Toggle nuovo fornitore
  m.querySelector('#edm-sp-supplier').addEventListener('change', (e) => {
    document.getElementById('edm-sp-new-supplier-wrap').style.display =
      e.target.value === '__new__' ? 'block' : 'none';
  });

  m.classList.add('open');
}

async function _edmSalvaNuovaFornitura(assetId) {
  const m = document.getElementById('edm-inv-sp-modal');
  const errEl = document.getElementById('edm-sp-error');
  const AUTH = { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' };

  let supplierId = document.getElementById('edm-sp-supplier').value;
  const commodity    = document.getElementById('edm-sp-commodity').value;
  const pointCode    = document.getElementById('edm-sp-point-code').value.trim() || null;
  const description  = document.getElementById('edm-sp-description').value.trim() || null;
  const activatedOn  = document.getElementById('edm-sp-activated-on').value || null;

  if (!supplierId) { errEl.textContent = 'Selezionare un fornitore.'; return; }

  try {
    // Crea nuovo fornitore se richiesto
    if (supplierId === '__new__') {
      const name = document.getElementById('edm-sp-new-supplier-name').value.trim();
      if (!name) { errEl.textContent = 'Inserire il nome del fornitore.'; return; }
      const rSup = await fetch(`/api/bems/buildings/${assetId}/suppliers`, {
        method: 'POST', headers: AUTH,
        body: JSON.stringify({ name })
      });
      if (!rSup.ok) throw new Error('Errore creazione fornitore');
      supplierId = (await rSup.json()).supplier.supplier_id;
    }

    const rSp = await fetch(`/api/bems/buildings/${assetId}/supply-points`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ supplier_id: supplierId, commodity, point_code: pointCode, description, activated_on: activatedOn })
    });
    if (!rSp.ok) {
      const err = await rSp.json().catch(() => ({ detail: rSp.statusText }));
      throw new Error(err.detail || 'Errore creazione fornitura');
    }
    m.classList.remove('open');
    _edmCaricaBollette(assetId);
  } catch (e) {
    errEl.textContent = e.message;
  }
}


// ══════════════════════════════════════════════════════════════════════
// MODULO EFFICIENZA ENERGETICA — Tab "Efficienza energetica"
// ══════════════════════════════════════════════════════════════════════

async function _edmCaricaEfficienza(assetId) {
  const el = document.getElementById('edm-panel-esg');
  if (!el) return;
  el.innerHTML = _edmSpinner();

  try {
    const AUTH = { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' };

    // Carica KPI sintesi
    const kpiRes = await fetch(`/api/efficiency/${assetId}/kpi`, { headers: AUTH });
    if (!kpiRes.ok) throw new Error('HTTP ' + kpiRes.status);
    const kpi = await kpiRes.json();

    // Carica breakdown per donut
    const bkRes = await fetch(`/api/efficiency/${assetId}/breakdown?giorni=30`, { headers: AUTH });
    const bk = bkRes.ok ? await bkRes.json() : null;

    // Carica profilo 24h
    const p24Res = await fetch(`/api/efficiency/${assetId}/profile24h?giorni=7`, { headers: AUTH });
    const p24 = p24Res.ok ? await p24Res.json() : null;

    // Carica heatmap
    const hmRes = await fetch(`/api/efficiency/${assetId}/heatmap7d?giorni=28`, { headers: AUTH });
    const hm = hmRes.ok ? await hmRes.json() : null;

    // Carica trend mensile
    const trendRes = await fetch(`/api/efficiency/${assetId}/trend?mesi=12`, { headers: AUTH });
    const trend = trendRes.ok ? await trendRes.json() : null;

    // Carica baseline
    const blRes = await fetch(`/api/efficiency/${assetId}/baseline`, { headers: AUTH });
    const bl = blRes.ok ? await blRes.json() : null;

    // Carica occupancy vs costo
    const occRes = await fetch(`/api/efficiency/${assetId}/occupancy?giorni=14`, { headers: AUTH });
    const occ = occRes.ok ? await occRes.json() : null;

    // ── Costruisci HTML ──────────────────────────────────────────────────────
    const trendIcon  = (v) => v === null ? '' : v > 0 ? '<i class="fa fa-arrow-up"></i>' : '<i class="fa fa-arrow-down"></i>';
    const trendClass = (v) => v === null ? 'flat' : v > 0 ? 'up' : 'down';
    const fmt        = (v, d=1) => v === null || v === undefined ? '–' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
    const fmtInt     = (v) => v === null || v === undefined ? '–' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: 0 });

    // Gauge EUI SVG
    function gaugeEuiSvg(eui, classe) {
      const max = 400;
      const pct = Math.min(eui / max, 1);
      const angle = pct * 180; // 0–180 gradi
      const r = 60, cx = 80, cy = 75;
      const rad = (deg) => (deg - 90) * Math.PI / 180;
      const x1 = cx + r * Math.cos(rad(-90));
      const y1 = cy + r * Math.sin(rad(-90));
      const x2 = cx + r * Math.cos(rad(-90 + angle));
      const y2 = cy + r * Math.sin(rad(-90 + angle));
      const large = angle > 180 ? 1 : 0;
      // Colore in base alla classe
      const classColors = { A4:'#27AE60',A3:'#2ECC71',A2:'#52BE80',A1:'#82E0AA',A:'#A9DFBF',
                             B:'#F9E79F',C:'#F39C12',D:'#E67E22',E:'#E74C3C',F:'#C0392B',G:'#922B21' };
      const color = classColors[classe] || '#58A6FF';
      return `<svg width="160" height="90" viewBox="0 0 160 90">
        <path d="M${cx-r},${cy} A${r},${r} 0 0,1 ${cx+r},${cy}" fill="none" stroke="var(--border-color,#1E3A5F)" stroke-width="10"/>
        <path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
        <text x="${cx}" y="${cy-8}" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text-primary,#E0F0FF)">${fmtInt(eui)}</text>
        <text x="${cx}" y="${cy+6}" text-anchor="middle" font-size="9" fill="var(--text-muted,#7BAFC4)">kWh/m²/anno</text>
      </svg>`;
    }

    // ── Sezione 1: Info anagrafica energetica ─────────────────────────────
    const infoRow = `
      <div class="ee-info-row">
        <span><i class="fa fa-clock" style="margin-right:4px;color:var(--accent-blue);"></i>
          Orari: <strong>${kpi.working_hours_start?.slice(0,5) || '08:00'} – ${kpi.working_hours_end?.slice(0,5) || '19:00'}</strong>
          · ${(kpi.working_days || 'MON,TUE,WED,THU,FRI').split(',').length} giorni/sett.
        </span>
        <span><i class="fa fa-building" style="margin-right:4px;color:var(--accent-blue);"></i>
          Superficie: <strong>${fmtInt(kpi.superficie_mq)} m²</strong>
        </span>
        ${kpi.anno_costruzione ? `<span><i class="fa fa-calendar" style="margin-right:4px;color:var(--accent-blue);"></i>Anno: <strong>${kpi.anno_costruzione}</strong></span>` : ''}
        ${kpi.energy_class_certificata ? `<span><i class="fa fa-certificate" style="margin-right:4px;color:var(--accent-blue);"></i>Classe cert.: <strong>${kpi.energy_class_certificata}</strong></span>` : ''}
      </div>`;

    // ── Sezione 2: KPI Sintesi (E-1…E-6) ─────────────────────────────────
    const kpiCards = `
      <div class="ee-kpi-grid">
        <div class="ee-kpi-card">
          <div class="ee-kpi-card-label">Costo energetico mese</div>
          <div class="ee-kpi-card-value">€ ${fmtInt(kpi.costo_mese_eur)}</div>
          <div class="ee-kpi-card-unit">solo elettricità</div>
          ${kpi.trend_vs_mese_prec_pct !== null ? `<div class="ee-kpi-card-delta ${trendClass(kpi.trend_vs_mese_prec_pct)}">${trendIcon(kpi.trend_vs_mese_prec_pct)} ${fmt(Math.abs(kpi.trend_vs_mese_prec_pct))}% vs mese prec.</div>` : ''}
        </div>
        <div class="ee-kpi-card">
          <div class="ee-kpi-card-label">Costo per m²</div>
          <div class="ee-kpi-card-value">€ ${fmt(kpi.costo_mq_eur, 2)}</div>
          <div class="ee-kpi-card-unit">€/m² mese corrente</div>
        </div>
        <div class="ee-kpi-card">
          <div class="ee-kpi-card-label">Consumi mese</div>
          <div class="ee-kpi-card-value">${fmtInt(kpi.kwh_mese)}</div>
          <div class="ee-kpi-card-unit">kWh</div>
        </div>
        <div class="ee-kpi-card">
          <div class="ee-kpi-card-label">CO₂ equivalente</div>
          <div class="ee-kpi-card-value">${fmtInt(kpi.co2_kg_mese)}</div>
          <div class="ee-kpi-card-unit">kg CO₂ mese</div>
        </div>
        ${kpi.pct_fuori_orario !== null ? `
        <div class="ee-kpi-card">
          <div class="ee-kpi-card-label">Fuori orario</div>
          <div class="ee-kpi-card-value">${fmt(kpi.pct_fuori_orario)}%</div>
          <div class="ee-kpi-card-unit">dei consumi mensili</div>
        </div>` : ''}
        ${kpi.allarmi_energetici_attivi > 0 ? `
        <div class="ee-kpi-card" style="border-color:rgba(231,76,60,0.4);">
          <div class="ee-kpi-card-label">Allarmi energetici</div>
          <div class="ee-kpi-card-value" style="color:#E74C3C;">${kpi.allarmi_energetici_attivi}</div>
          <div class="ee-kpi-card-unit">attivi non risolti</div>
        </div>` : ''}
      </div>`;

    // ── Gauge EUI ─────────────────────────────────────────────────────────
    const gaugeHtml = `
      <div style="display:flex;align-items:flex-start;gap:20px;margin-bottom:14px;flex-wrap:wrap;">
        <div class="ee-gauge-wrap">
          ${gaugeEuiSvg(kpi.eui_kwh_mq_anno, kpi.energy_class_calcolata)}
          <span class="ee-gauge-label ${kpi.energy_class_calcolata}">Classe ${kpi.energy_class_calcolata}</span>
          <span class="ee-gauge-unit">EUI calcolato</span>
        </div>
        <div style="flex:1;min-width:200px;">
          <div class="ee-section-title">Indice di Efficienza Energetica (EUI)</div>
          <p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin:0 0 8px;">
            L'EUI (Energy Use Intensity) misura il consumo annuo per metro quadro.
            Valore calcolato: <strong>${fmt(kpi.eui_kwh_mq_anno)} kWh/m²/anno</strong>
            ${kpi.energy_class_certificata && kpi.energy_class_certificata !== kpi.energy_class_calcolata
              ? ` — Classe certificata: <strong>${kpi.energy_class_certificata}</strong>`
              : ''}.
          </p>
          ${!kpi.has_telemetry ? `<div style="font-size:11px;color:var(--text-muted);padding:6px 10px;background:rgba(88,166,255,0.05);border-radius:6px;border:1px solid var(--border-color);">
            <i class="fa fa-info-circle" style="margin-right:4px;"></i>Dati da contatori vettoriali (no telemetria impianti)
          </div>` : ''}
        </div>
      </div>`;

    // ── Sezione Analisi ───────────────────────────────────────────────────
    const analisiHtml = `
      <div class="ee-section-title">Analisi consumi</div>
      <div class="ee-chart-row">
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">PROFILO 24H PER TIPO IMPIANTO</div>
          <div class="ee-chart" id="ee-chart-profile24h-${assetId}"></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">RIPARTIZIONE CONSUMI (30 GG)</div>
          <div class="ee-chart" id="ee-chart-breakdown-${assetId}"></div>
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">HEATMAP ORA × GIORNO SETTIMANA (28 GG)</div>
        <div class="ee-chart" id="ee-chart-heatmap-${assetId}"></div>
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">CONFRONTO BASELINE PER IMPIANTO</div>
        <div class="ee-chart" id="ee-chart-baseline-${assetId}"></div>
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">CORRELAZIONE OCCUPANCY VS COSTO (14 GG)</div>
        <div class="ee-chart" id="ee-chart-occ-${assetId}"></div>
      </div>`;

    // ── Sezione Trend ─────────────────────────────────────────────────────
    const trendHtml = `
      <div class="ee-section-title">Trend storico</div>
      <div class="ee-chart-row">
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">CONSUMI MENSILI (kWh)</div>
          <div class="ee-chart" id="ee-chart-trend-kwh-${assetId}"></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">COSTI MENSILI (€)</div>
          <div class="ee-chart" id="ee-chart-trend-cost-${assetId}"></div>
        </div>
      </div>`;

    el.innerHTML = infoRow + kpiCards + gaugeHtml + analisiHtml + trendHtml;

    // ── Render grafici Plotly ─────────────────────────────────────────────
    if (typeof Plotly === 'undefined') return;

    const plotCfg = { responsive: true, displayModeBar: false };
    const plotLayout = (extra) => Object.assign({
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
      margin: { t: 10, r: 10, b: 30, l: 45 },
      font: { family: 'Inter,sans-serif', size: 11, color: 'var(--text-secondary,#7BAFC4)' },
      legend: { orientation: 'h', y: -0.25, font: { size: 10 } },
      xaxis: { gridcolor: 'rgba(30,58,95,0.5)', zerolinecolor: 'rgba(30,58,95,0.5)' },
      yaxis: { gridcolor: 'rgba(30,58,95,0.5)', zerolinecolor: 'rgba(30,58,95,0.5)' },
    }, extra || {});

    // Profilo 24h (area stacked)
    if (p24 && p24.length) {
      const tipi = [...new Set(p24.map(r => r.tipo))];
      const traces = tipi.map(tipo => {
        const rows = p24.filter(r => r.tipo === tipo).sort((a,b) => a.ora - b.ora);
        return {
          x: rows.map(r => r.ora), y: rows.map(r => r.kw_medio),
          name: rows[0]?.label || tipo, type: 'scatter', mode: 'lines',
          fill: 'tonexty', stackgroup: 'one',
          line: { color: rows[0]?.color || '#58A6FF', width: 1.5 },
          fillcolor: (rows[0]?.color || '#58A6FF') + '55',
        };
      });
      Plotly.newPlot(`ee-chart-profile24h-${assetId}`, traces,
        plotLayout({ xaxis: { title: 'Ora', tickvals: [0,4,8,12,16,20,23], gridcolor:'rgba(30,58,95,0.5)' },
                     yaxis: { title: 'kW medio', gridcolor:'rgba(30,58,95,0.5)' } }), plotCfg);
    } else {
      const el2 = document.getElementById(`ee-chart-profile24h-${assetId}`);
      if (el2) el2.innerHTML = '<div class="ee-no-data"><i class="fa fa-chart-area"></i>Dati non disponibili</div>';
    }

    // Breakdown donut
    if (bk && bk.breakdown && bk.breakdown.length) {
      Plotly.newPlot(`ee-chart-breakdown-${assetId}`,
        [{ type: 'pie', hole: 0.55,
           labels: bk.breakdown.map(r => r.label),
           values: bk.breakdown.map(r => r.kwh),
           marker: { colors: bk.breakdown.map(r => r.color) },
           textinfo: 'percent', textfont: { size: 11 },
           hovertemplate: '<b>%{label}</b><br>%{value:.0f} kWh<br>%{percent}<extra></extra>' }],
        plotLayout({ margin: { t: 10, r: 10, b: 10, l: 10 },
                     legend: { orientation: 'v', x: 1.02, y: 0.5 } }), plotCfg);
    } else {
      const el2 = document.getElementById(`ee-chart-breakdown-${assetId}`);
      if (el2) el2.innerHTML = '<div class="ee-no-data"><i class="fa fa-chart-pie"></i>Dati non disponibili</div>';
    }

    // Heatmap ora×giorno
    if (hm && hm.length) {
      const days = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
      const z = Array.from({length:7}, () => new Array(24).fill(null));
      hm.forEach(r => { if (r.dow >= 0 && r.dow < 7 && r.ora >= 0 && r.ora < 24) z[r.dow][r.ora] = r.kw_medio; });
      Plotly.newPlot(`ee-chart-heatmap-${assetId}`,
        [{ type: 'heatmap', z, x: Array.from({length:24},(_,i)=>i), y: days,
           colorscale: [[0,'#0A1628'],[0.3,'#1E3A5F'],[0.6,'#58A6FF'],[1,'#FF6B35']],
           showscale: true, hovertemplate: '%{y} ore %{x}: <b>%{z:.1f} kW</b><extra></extra>' }],
        plotLayout({ margin: { t: 10, r: 60, b: 30, l: 40 },
                     xaxis: { title: 'Ora', tickvals: [0,4,8,12,16,20,23] } }), plotCfg);
    } else {
      const el2 = document.getElementById(`ee-chart-heatmap-${assetId}`);
      if (el2) el2.innerHTML = '<div class="ee-no-data"><i class="fa fa-th"></i>Dati non disponibili</div>';
    }

    // Baseline bar chart
    if (bl && bl.length) {
      const filtered = bl.filter(r => r.kw_baseline > 0 || r.kw_attuale > 0);
      Plotly.newPlot(`ee-chart-baseline-${assetId}`,
        [{ name: 'Baseline', type: 'bar', x: filtered.map(r => r.nome),
           y: filtered.map(r => r.kw_baseline), marker: { color: 'rgba(88,166,255,0.4)' } },
         { name: 'Attuale (24h)', type: 'bar', x: filtered.map(r => r.nome),
           y: filtered.map(r => r.kw_attuale), marker: { color: filtered.map(r =>
             r.delta_pct === null ? '#58A6FF' : r.delta_pct > 15 ? '#E74C3C' : r.delta_pct < -15 ? '#27AE60' : '#F39C12'
           )} }],
        plotLayout({ barmode: 'group', yaxis: { title: 'kW medio' } }), plotCfg);
    } else {
      const el2 = document.getElementById(`ee-chart-baseline-${assetId}`);
      if (el2) el2.innerHTML = '<div class="ee-no-data"><i class="fa fa-chart-bar"></i>Dati non disponibili</div>';
    }

    // Occupancy vs costo scatter
    if (occ && occ.length) {
      Plotly.newPlot(`ee-chart-occ-${assetId}`,
        [{ type: 'scatter', mode: 'markers+lines',
           x: occ.map(r => r.occ_pct_media), y: occ.map(r => r.costo_eur),
           text: occ.map(r => r.data),
           marker: { color: '#58A6FF', size: 7 },
           line: { color: 'rgba(88,166,255,0.3)', width: 1 },
           hovertemplate: '<b>%{text}</b><br>Occupancy: %{x:.0f}%<br>Costo: € %{y:.2f}<extra></extra>' }],
        plotLayout({ xaxis: { title: 'Occupancy media (%)' }, yaxis: { title: 'Costo (€)' } }), plotCfg);
    } else {
      const el2 = document.getElementById(`ee-chart-occ-${assetId}`);
      if (el2) el2.innerHTML = '<div class="ee-no-data"><i class="fa fa-chart-scatter"></i>Dati non disponibili</div>';
    }

    // Trend kWh
    if (trend && trend.length) {
      Plotly.newPlot(`ee-chart-trend-kwh-${assetId}`,
        [{ type: 'bar', x: trend.map(r => r.mese), y: trend.map(r => r.kwh),
           marker: { color: '#58A6FF' },
           hovertemplate: '<b>%{x}</b><br>%{y:.0f} kWh<extra></extra>' }],
        plotLayout({ yaxis: { title: 'kWh' } }), plotCfg);
    } else {
      const el2 = document.getElementById(`ee-chart-trend-kwh-${assetId}`);
      if (el2) el2.innerHTML = '<div class="ee-no-data"><i class="fa fa-chart-bar"></i>Dati non disponibili</div>';
    }

    // Trend costi
    if (trend && trend.length) {
      Plotly.newPlot(`ee-chart-trend-cost-${assetId}`,
        [{ type: 'scatter', mode: 'lines+markers',
           x: trend.map(r => r.mese), y: trend.map(r => r.costo_eur),
           line: { color: '#F39C12', width: 2 },
           marker: { color: '#F39C12', size: 5 },
           fill: 'tozeroy', fillcolor: 'rgba(243,156,18,0.1)',
           hovertemplate: '<b>%{x}</b><br>€ %{y:.2f}<extra></extra>' }],
        plotLayout({ yaxis: { title: '€' } }), plotCfg);
    } else {
      const el2 = document.getElementById(`ee-chart-trend-cost-${assetId}`);
      if (el2) el2.innerHTML = '<div class="ee-no-data"><i class="fa fa-chart-line"></i>Dati non disponibili</div>';
    }

  } catch(e) {
    if (el) el.innerHTML = `<div class="ee-no-data" style="height:200px;">
      <i class="fa fa-exclamation-triangle" style="color:#E74C3C;"></i>
      <span style="color:#E74C3C;">Errore caricamento: ${e.message}</span>
    </div>`;
  }
}
