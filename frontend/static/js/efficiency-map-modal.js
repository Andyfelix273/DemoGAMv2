/**
 * efficiency-map-modal.js — Modale dettaglio asset del dimostratore Asset Efficiency
 *
 * @module efficiency-map-modal
 * @requires efficiency-map-config.js  Costanti globali
 * @requires efficiency-map-core.js    allMarkers, map
 * @requires api.js                    Autenticazione, fetch helper
 *
 * Tab della modale:
 *   anagrafica      Dati anagrafici asset (identico al GIS Asset Manager)
 *   consumi         Grafici kWh per vettore energetico (/api/energy/readings/{id})
 *   occupancy       Dati di occupancy (/api/occupancy/summary)
 *   allarmi_energy  Anomalie di consumo (/api/energy/anomalies)
 *   esg_energy      CO2 e costi energetici (/api/energy/summary)
 */
/* global API, map, allMarkers, ICONE_TIPO, COLORI_EFFICIENZA, i18n */

// =============================================
// SELEZIONE ASSET: apre la modale dettaglio
// =============================================
function selezionaAsset(feature, marker) {
  map.panTo(marker.getLatLng());
  apriModaleAsset(feature.properties.id);
}

// =============================================
// MODALE DETTAGLIO ASSET
// =============================================
let _assetAperto = null;

async function apriModaleAsset(id) {
  const overlay = document.getElementById('map-modal-overlay');
  overlay.classList.add('open');

  // Reset tab: torna sempre ad Anagrafica
  document.querySelectorAll('.map-modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.map-modal-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.map-modal-tab[data-mmpanel="anagrafica"]').classList.add('active');
  document.getElementById('mm-panel-anagrafica').classList.add('active');
  document.getElementById('mm-panel-anagrafica').innerHTML = '<div class="spinner" style="margin:24px auto"></div>';

  // Reset badge
  document.getElementById('mm-alarm-badge').innerHTML = '';
  document.getElementById('mm-title').textContent = 'Caricamento...';
  document.getElementById('mm-subtitle').textContent = '';

  _assetAperto = id;
  window._assetApertoId = id;

  try {
    const d = await API.getAsset(id);
    const a = d.asset;

    document.getElementById('mm-title').textContent = a.codice + ' — ' + a.nome;
    document.getElementById('mm-subtitle').textContent = a.tipo + ' · ' + a.citta + (a.provincia ? ' (' + a.provincia + ')' : '');

    // Pulsante anagrafica
    document.getElementById('mm-btn-anagrafica').href = '/static/efficiency-assets.html?asset_id=' + id;

    // ── Tab Anagrafica (identica al GIS Asset Manager) ──────────────
    const statoLabel = { attivo: 'Attivo', manutenzione: 'In manutenzione', inattivo: 'Inattivo' }[a.stato] || a.stato;
    const statoColor = { attivo: 'var(--stato-ok)', manutenzione: 'var(--stato-man)', inattivo: 'var(--stato-inattivo)' }[a.stato] || '';
    const campi = [
      ['Codice', a.codice], ['Tipo', a.tipo], ['Stato', `<span style="color:${statoColor};font-weight:600">${statoLabel}</span>`],
      ['Indirizzo', a.indirizzo], ['Città', a.citta + (a.provincia ? ' (' + a.provincia + ')' : '')],
      ['CAP', a.cap], ['Superficie', a.superficie_mq ? a.superficie_mq.toLocaleString('it-IT') + ' m²' : '–'],
      ['Anno costruzione', a.anno_costruzione || '–'],
      ['Referente', a.referente || '–'], ['Telefono', a.telefono || '–'],
      ['Email', a.email || '–'], ['Coordinate', a.lat.toFixed(5) + ', ' + a.lon.toFixed(5)],
      ['Note', a.note || '–', true]
    ];
    document.getElementById('mm-panel-anagrafica').innerHTML = `<div class="mm-detail-grid">${
      campi.map(([lbl, val, full]) =>
        `<div class="mm-detail-row${full ? ' full' : ''}">
          <span class="mm-detail-label">${lbl}</span>
          <span class="mm-detail-value">${val || '–'}</span>
        </div>`
      ).join('')
    }</div>`;

    // ── Tab Consumi (grafici kWh per vettore) ──────────────────────
    document.getElementById('mm-panel-consumi').innerHTML = `
      <div style="padding:12px 0 6px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <select id="mm-consumi-ore" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text-primary);padding:4px 8px;border-radius:6px;font-size:12px;">
            <option value="24">Ultime 24 ore</option>
            <option value="168" selected>Ultima settimana</option>
            <option value="720">Ultimo mese</option>
          </select>
          <span style="font-size:11px;color:var(--text-secondary);" id="mm-consumi-status">Caricamento...</span>
        </div>
        <div id="mm-consumi-chart" style="width:100%;height:220px;"></div>
        <div id="mm-consumi-kpi" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;"></div>
      </div>`;
    caricaConsumi(id, 168);
    document.getElementById('mm-consumi-ore').addEventListener('change', (e) => {
      caricaConsumi(id, parseInt(e.target.value));
    });

    // ── Tab Occupancy ──────────────────────────────────────────────
    document.getElementById('mm-panel-occupancy').innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i></div>`;
    caricaOccupancy(id, a);

    // ── Tab Allarmi Energetici ─────────────────────────────────────
    document.getElementById('mm-panel-allarmi_energy').innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i></div>`;
    caricaAllarmiEnergy(id, a.nome);

    // ── Tab ESG Energia ────────────────────────────────────────────
    document.getElementById('mm-panel-esg_energy').innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i></div>`;
    caricaEsgEnergy(id);

  } catch(e) {
    console.error('[apriModaleAsset] Errore:', e.message, e.stack);
    document.getElementById('mm-panel-anagrafica').innerHTML =
      `<div style="text-align:center;padding:20px;color:var(--stato-inattivo)">
         <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
         <div style="font-size:13px">Impossibile caricare i dati dell'asset.</div>
         <div style="font-size:11px;margin-top:4px;color:var(--text-secondary)">${e.message}</div>
       </div>`;
  }
}

// ── Carica dati consumi energetici ──────────────────────────────────
async function caricaConsumi(assetId, ore) {
  const statusEl = document.getElementById('mm-consumi-status');
  const chartEl  = document.getElementById('mm-consumi-chart');
  const kpiEl    = document.getElementById('mm-consumi-kpi');
  if (!chartEl) return;
  if (statusEl) statusEl.textContent = 'Caricamento...';
  try {
    const res = await fetch(`/api/energy/readings/${assetId}?ore=${ore}`, {
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const readings = await res.json();

    if (!readings || readings.length === 0) {
      chartEl.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:20px;text-align:center;">Nessuna lettura disponibile per questo asset.</p>';
      if (statusEl) statusEl.textContent = '';
      return;
    }

    // Raggruppa per tipo/vettore
    const tipi = [...new Set(readings.map(r => r.tipo || r.label || 'Energia'))];
    const colori = ['#3498DB', '#27AE60', '#F39C12', '#9B59B6', '#E74C3C'];

    // Prepara dati per grafico a linee
    const traces = tipi.map((tipo, idx) => {
      const dati = readings.filter(r => (r.tipo || r.label || 'Energia') === tipo);
      return {
        x: dati.map(r => r.ts),
        y: dati.map(r => r.valore),
        name: tipo,
        type: 'scatter',
        mode: 'lines',
        line: { color: colori[idx % colori.length], width: 2 }
      };
    });

    const isDark = (localStorage.getItem('gam_tema') || 'dark') !== 'light';
    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: isDark ? '#7BAFC4' : '#57606a', size: 10, family: 'Inter, sans-serif' },
      xaxis: { gridcolor: isDark ? '#1E3A5F' : '#d0d7de', showgrid: true },
      yaxis: { gridcolor: isDark ? '#1E3A5F' : '#d0d7de', showgrid: true, title: { text: readings[0]?.unita || 'kWh', font: { size: 10 } } },
      margin: { t: 10, r: 10, b: 40, l: 50 },
      legend: { orientation: 'h', y: -0.2, font: { size: 10 } },
      showlegend: tipi.length > 1
    };

    if (typeof Plotly !== 'undefined') {
      Plotly.newPlot(chartEl, traces, layout, { responsive: true, displayModeBar: false });
    } else {
      // Fallback senza Plotly: mostra tabella semplice
      const totale = readings.reduce((s, r) => s + (r.valore || 0), 0);
      chartEl.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:8px;">Totale: <strong>${totale.toFixed(1)} ${readings[0]?.unita || 'kWh'}</strong> (${readings.length} letture)</p>`;
    }

    // KPI riassuntivi
    const totale = readings.reduce((s, r) => s + (r.valore || 0), 0);
    const media  = totale / readings.length;
    const max    = Math.max(...readings.map(r => r.valore || 0));
    if (kpiEl) kpiEl.innerHTML = `
      <div class="mm-kpi-card"><div class="mm-kpi-val">${totale.toFixed(0)}</div><div class="mm-kpi-lbl">Totale ${readings[0]?.unita || 'kWh'}</div></div>
      <div class="mm-kpi-card"><div class="mm-kpi-val">${media.toFixed(1)}</div><div class="mm-kpi-lbl">Media per lettura</div></div>
      <div class="mm-kpi-card"><div class="mm-kpi-val">${max.toFixed(1)}</div><div class="mm-kpi-lbl">Picco massimo</div></div>`;

    if (statusEl) statusEl.textContent = `${readings.length} letture`;
  } catch(e) {
    console.warn('[caricaConsumi]', e.message);
    if (chartEl) chartEl.innerHTML = `<p style="color:var(--stato-inattivo);font-size:13px;padding:20px;text-align:center;"><i class="fas fa-exclamation-circle" style="margin-right:5px;"></i>Dati consumi non disponibili</p>`;
    if (statusEl) statusEl.textContent = '';
  }
}

// ── Carica dati occupancy ────────────────────────────────────────────
async function caricaOccupancy(assetId, asset) {
  const panel = document.getElementById('mm-panel-occupancy');
  if (!panel) return;
  try {
    const res = await fetch('/api/occupancy/summary', {
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = await res.json();

    // Cerca l'asset corrente nella lista occupancy
    const occ = items.find(i => i.asset_id === assetId);

    if (!occ) {
      panel.innerHTML = `
        <div style="padding:16px;">
          <p style="color:var(--text-secondary);font-size:13px;text-align:center;">
            <i class="fas fa-info-circle" style="margin-right:5px;"></i>
            Dati di occupancy non disponibili per questo asset.
          </p>
          <p style="color:var(--text-secondary);font-size:11px;text-align:center;margin-top:8px;">
            I sensori di occupancy sono attivi per: uffici e stabilimenti con sistema di accesso.
          </p>
        </div>`;
      return;
    }

    const pct = occ.pct_occupancy || 0;
    const statoColor = pct >= 90 ? '#E74C3C' : pct >= 70 ? '#F39C12' : '#27AE60';
    const statoLabel = pct >= 90 ? 'Pieno' : pct >= 70 ? 'Affollato' : 'Normale';

    panel.innerHTML = `
      <div style="padding:12px 0;">
        <div class="mm-kpi-grid" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
          <div class="mm-kpi-card">
            <div class="mm-kpi-val" style="color:${statoColor};">${occ.presenti}</div>
            <div class="mm-kpi-lbl">Presenti</div>
          </div>
          <div class="mm-kpi-card">
            <div class="mm-kpi-val">${occ.capacita_max}</div>
            <div class="mm-kpi-lbl">Capienza max</div>
          </div>
          <div class="mm-kpi-card">
            <div class="mm-kpi-val" style="color:${statoColor};">${pct.toFixed(0)}%</div>
            <div class="mm-kpi-lbl">Occupancy</div>
          </div>
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:12px;color:var(--text-secondary);">Tasso di occupazione</span>
            <span style="font-size:12px;font-weight:600;color:${statoColor};">${statoLabel}</span>
          </div>
          <div style="background:var(--bg-secondary);border-radius:4px;height:8px;overflow:hidden;">
            <div style="background:${statoColor};height:100%;width:${Math.min(pct,100)}%;border-radius:4px;transition:width 0.5s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;">
            <span style="font-size:10px;color:var(--text-muted);">0</span>
            <span style="font-size:10px;color:var(--text-muted);">${occ.capacita_max}</span>
          </div>
        </div>
        <p style="font-size:11px;color:var(--text-secondary);margin-top:10px;">
          Stato sensori: <strong style="color:${occ.stato === 'attivo' ? '#27AE60' : '#E74C3C'}">${occ.stato || 'N/D'}</strong>
        </p>
      </div>`;
  } catch(e) {
    console.warn('[caricaOccupancy]', e.message);
    if (panel) panel.innerHTML = `<p style="color:var(--stato-inattivo);font-size:13px;padding:20px;text-align:center;"><i class="fas fa-exclamation-circle" style="margin-right:5px;"></i>Dati occupancy non disponibili</p>`;
  }
}

// ── Carica allarmi energetici ────────────────────────────────────────
async function caricaAllarmiEnergy(assetId, nomeAsset) {
  const panel = document.getElementById('mm-panel-allarmi_energy');
  if (!panel) return;
  try {
    const res = await fetch('/api/energy/anomalies', {
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const anomalie = await res.json();

    // Filtra per asset corrente (per nome o tutte se non filtrabile)
    const assetAnomalies = anomalie.filter(a =>
      !a.nome || a.nome.toLowerCase().includes(nomeAsset.toLowerCase().split(' ')[0])
    );

    const lista = assetAnomalies.length > 0 ? assetAnomalies : anomalie.slice(0, 3);

    // Aggiorna badge
    const badge = document.getElementById('mm-alarm-badge');
    if (badge && lista.length > 0) {
      badge.innerHTML = ` <span style="background:var(--stato-inattivo);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px">${lista.length}</span>`;
    }

    if (lista.length === 0) {
      panel.innerHTML = `<p style="color:var(--text-secondary);font-size:13px;padding:20px;text-align:center;"><i class="fas fa-check-circle" style="color:#27AE60;margin-right:5px;"></i>Nessuna anomalia energetica rilevata.</p>`;
      return;
    }

    const sevColor = { alta: '#E74C3C', media: '#F39C12', bassa: '#F39C12' };
    panel.innerHTML = lista.map(a => `
      <div class="mm-alarm-row">
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:500;">${a.nome || nomeAsset}</div>
          <div style="font-size:11px;color:var(--text-secondary);">${a.tipo || 'Anomalia consumo'}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;color:${sevColor[a.severita]||'#F39C12'};font-weight:600;">+${(a.delta_pct||0).toFixed(0)}%</div>
          <span style="background:${sevColor[a.severita]||'#F39C12'}20;color:${sevColor[a.severita]||'#F39C12'};padding:2px 6px;border-radius:4px;font-size:10px;">${a.severita || 'media'}</span>
        </div>
      </div>`).join('');
  } catch(e) {
    console.warn('[caricaAllarmiEnergy]', e.message);
    if (panel) panel.innerHTML = `<p style="color:var(--stato-inattivo);font-size:13px;padding:20px;text-align:center;"><i class="fas fa-exclamation-circle" style="margin-right:5px;"></i>Allarmi energetici non disponibili</p>`;
  }
}

// ── Carica ESG energia ───────────────────────────────────────────────
async function caricaEsgEnergy(assetId) {
  const panel = document.getElementById('mm-panel-esg_energy');
  if (!panel) return;
  try {
    const res = await fetch('/api/energy/summary', {
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = await res.json();

    const item = items.find(i => i.asset_id === assetId);
    if (!item) {
      panel.innerHTML = `<p style="color:var(--text-secondary);font-size:13px;padding:20px;text-align:center;">Dati ESG energetici non disponibili per questo asset.</p>`;
      return;
    }

    const ratingColor = { A:'#27AE60', B:'#4CAF50', C:'#F39C12', D:'#E74C3C', E:'#c0392b' };
    const rc = ratingColor[item.rating_esg] || 'var(--text-secondary)';

    panel.innerHTML = `
      <div style="padding:12px 0;">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
          <div style="width:56px;height:56px;border-radius:50%;background:${rc};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;">${item.rating_esg || '–'}</div>
          <div>
            <div style="font-size:11px;color:var(--text-secondary);">Rating efficienza energetica</div>
            <div style="font-size:20px;font-weight:700;">${(item.kwh_giorno||0).toFixed(0)} kWh/giorno</div>
            <div style="font-size:11px;color:var(--text-secondary);">${(item.kwh_mq||0).toFixed(2)} kWh/m²</div>
          </div>
        </div>
        <div class="mm-kpi-grid" style="grid-template-columns:repeat(2,1fr);gap:8px;">
          <div class="mm-kpi-card">
            <div class="mm-kpi-val">${(item.co2_kg_giorno||0).toFixed(1)}</div>
            <div class="mm-kpi-lbl">kg CO₂/giorno</div>
          </div>
          <div class="mm-kpi-card">
            <div class="mm-kpi-val">${(item.costo_euro_giorno||0).toFixed(2)}</div>
            <div class="mm-kpi-lbl">€/giorno</div>
          </div>
          <div class="mm-kpi-card">
            <div class="mm-kpi-val">${(item.kwh_mese||0).toFixed(0)}</div>
            <div class="mm-kpi-lbl">kWh/mese</div>
          </div>
          <div class="mm-kpi-card">
            <div class="mm-kpi-val">${(item.efficienza_score||0).toFixed(0)}%</div>
            <div class="mm-kpi-lbl">Score efficienza</div>
          </div>
        </div>
        ${item.anomalia_rilevata ? `
        <div style="margin-top:12px;padding:8px 12px;background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);border-radius:6px;font-size:12px;color:#E74C3C;">
          <i class="fas fa-exclamation-triangle" style="margin-right:5px;"></i>
          Anomalia di consumo rilevata — verificare i vettori energetici
        </div>` : `
        <div style="margin-top:12px;padding:8px 12px;background:rgba(39,174,96,0.1);border:1px solid rgba(39,174,96,0.3);border-radius:6px;font-size:12px;color:#27AE60;">
          <i class="fas fa-check-circle" style="margin-right:5px;"></i>
          Consumi nella norma — nessuna anomalia rilevata
        </div>`}
      </div>`;
  } catch(e) {
    console.warn('[caricaEsgEnergy]', e.message);
    if (panel) panel.innerHTML = `<p style="color:var(--stato-inattivo);font-size:13px;padding:20px;text-align:center;"><i class="fas fa-exclamation-circle" style="margin-right:5px;"></i>Dati ESG non disponibili</p>`;
  }
}

// =============================================
// CHIUDI MODALE
// =============================================
function chiudiModaleAsset() {
  document.getElementById('map-modal-overlay').classList.remove('open');
  _assetAperto = null;
  window._assetApertoId = null;
}
