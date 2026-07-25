/**
 * efficiency-map-stats.js — Pannello laterale energetico e bootstrap del dimostratore Asset Efficiency
 *
 * @module efficiency-map-stats
 * @requires efficiency-map-config.js  Costanti globali
 * @requires efficiency-map-core.js    allMarkers, selezionaAsset, caricaHUD
 * @requires efficiency-map-modal.js   apriModaleAsset, chiudiModaleAsset
 * @requires api.js                    Autenticazione, fetch helper
 */
/* global API, map, allMarkers, filtroAttivo, COLORE_MARKER, ICONE_TIPO,
          selezionaAsset, apriModaleAsset, chiudiModaleAsset, caricaHUD,
          caricaStats, i18n */

// =============================================
// TORNA ALLA PANORAMICA
// =============================================
function tornaOverview() {
  // chiudiModaleAsset era della vecchia modale — ora usa la modale condivisa
  if (typeof chiudiDettaglioAsset === 'function') chiudiDettaglioAsset();
}

// =============================================
// ECG LIVE INDICATOR
// =============================================
function ecgSvg() {
  return `<span class="ecg-container">
    <svg class="ecg-svg" viewBox="0 0 48 16" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="ecg-clip">
          <rect class="ecg-mask-rect" x="0" y="-4" width="48" height="24"/>
        </clipPath>
      </defs>
      <polyline class="ecg-line" clip-path="url(#ecg-clip)"
        points="0,8 6,8 9,8 11,2 13,14 15,8 18,8 24,8 27,8 29,2 31,14 33,8 36,8 42,8 45,8 47,2 48,14"/>
      <circle class="ecg-dot" cx="46" cy="8" r="2.5"/>
    </svg>
  </span>`;
}

// =============================================
// RENDER DETTAGLIO ASSET NEL PANNELLO LATERALE
// =============================================
function renderDettaglio(data, container) {
  const a = data.asset;
  const fa = ICONE_TIPO[a.tipo] || 'fa-map-pin';
  const tipoLabel = {
    stabilimento: 'Stabilimento',
    ufficio:      'Ufficio',
    magazzino:    'Magazzino',
    deposito:     'Deposito'
  }[a.tipo] || a.tipo;
  const statoClass = a.stato === 'attivo' ? 'stato-attivo' : a.stato === 'manutenzione' ? 'stato-manutenzione' : 'stato-inattivo';
  const statoLabel = a.stato === 'attivo' ? 'Attivo' : a.stato === 'manutenzione' ? 'In manutenzione' : 'Inattivo';

  let html = `
    <div class="back-link" onclick="tornaOverview()">
      <i class="fas fa-arrow-left"></i> Panoramica energetica
    </div>
    <div>
      <div class="asset-tipo-badge"><i class="fas ${fa}"></i> ${tipoLabel}</div>
      <div class="asset-nome">${a.nome} <span class="stato-badge ${statoClass}">${statoLabel}</span></div>
      <div class="asset-citta">${a.citta}${a.provincia ? ' (' + a.provincia + ')' : ''}</div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title"><i class="fas fa-bolt" style="color:var(--accent);margin-right:5px;"></i>KPI Energetici</div>
      <div id="eff-detail-kpi" style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
        <div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:11px;grid-column:span 2;"><i class="fas fa-spinner fa-spin"></i></div>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title"><i class="fas fa-map-marker-alt" style="color:var(--accent);margin-right:5px;"></i>Posizione</div>
      <div style="font-size:12px;color:var(--text-secondary);">${a.indirizzo || '–'}<br>${a.citta} ${a.cap || ''}</div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title"><i class="fas fa-cloud-sun" style="color:var(--accent);margin-right:5px;"></i>Meteo</div>
      <div id="meteo-loading-${a.id}" style="font-size:11px;color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Caricamento...</div>
    </div>
    <div style="margin-top:12px;">
      <button class="btn btn-primary btn-sm" style="width:100%;" onclick="apriModaleAsset(${a.id})">
        <i class="fas fa-bolt"></i> Dettaglio completo
      </button>
    </div>`;

  container.innerHTML = html;

  // Carica KPI energetici per questo asset
  fetch(`/api/energy/summary`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } })
    .then(r => r.json())
    .then(items => {
      const item = items.find(i => i.asset_id === a.id);
      const kpiEl = document.getElementById('eff-detail-kpi');
      if (!kpiEl) return;
      if (!item) {
        kpiEl.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);grid-column:span 2;text-align:center;">Nessun dato energetico</div>';
        return;
      }
      const ratingColor = { A:'#27AE60', B:'#4CAF50', C:'#F39C12', D:'#E74C3C', E:'#c0392b' };
      const rc = ratingColor[item.rating_esg] || 'var(--text-secondary)';
      kpiEl.innerHTML = `
        <div class="op-kpi-card">
          <div class="op-kpi-val">${(item.kwh_giorno||0).toFixed(0)}</div>
          <div class="op-kpi-label">kWh/giorno</div>
        </div>
        <div class="op-kpi-card">
          <div class="op-kpi-val" style="color:${rc};">${item.rating_esg || '–'}</div>
          <div class="op-kpi-label">Rating energetico</div>
        </div>
        <div class="op-kpi-card">
          <div class="op-kpi-val">${(item.co2_kg_giorno||0).toFixed(1)}</div>
          <div class="op-kpi-label">kg CO₂/g</div>
        </div>
        <div class="op-kpi-card">
          <div class="op-kpi-val">${(item.kwh_mq||0).toFixed(2)}</div>
          <div class="op-kpi-label">kWh/m²</div>
        </div>`;
    })
    .catch(() => {});

  // Meteo live
  if (typeof caricaMeteo === 'function') caricaMeteo(a.id, a.lat, a.lon);
}

// =============================================
// PANORAMICA ENERGETICA (pannello laterale)
// =============================================
async function caricaStats() {
  const panel = document.getElementById('overview-panel');
  try {
    // Carica summary energetico
    const [summaryRes, anomalieRes] = await Promise.all([
      fetch('/api/energy/summary', { headers: { 'Authorization': 'Bearer ' + API.getToken() } }),
      fetch('/api/energy/anomalies', { headers: { 'Authorization': 'Bearer ' + API.getToken() } })
    ]);
    const summary  = summaryRes.ok  ? await summaryRes.json()  : [];
    const anomalie = anomalieRes.ok ? await anomalieRes.json() : [];

    const ora = new Date().toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
    const headerTs = document.getElementById('panel-header-ts');
    if (headerTs) headerTs.innerHTML = `${ecgSvg()} Live &mdash; ${ora} &nbsp;&bull;&nbsp; ${summary.length} asset`;

    // KPI flotta
    const totKwh    = summary.reduce((s, i) => s + (i.kwh_giorno||0), 0);
    const totCo2    = summary.reduce((s, i) => s + (i.co2_kg_giorno||0), 0);
    const totCosto  = summary.reduce((s, i) => s + (i.costo_euro_giorno||0), 0);
    const alta      = summary.filter(i => i.rating_esg === 'A' || i.rating_esg === 'B').length;
    const bassa     = summary.filter(i => i.rating_esg === 'D' || i.rating_esg === 'E').length;
    const nAnomal   = anomalie.length;

    let html = `
      <div class="kpi-group">
        <div class="kpi-group-header"><i class="fas fa-bolt" style="margin-right:5px;color:var(--accent);"></i>Flotta — Consumi oggi</div>
        <div class="op-kpi-grid" style="grid-template-columns:repeat(2,1fr);">
          <div class="op-kpi-card">
            <div class="op-kpi-val">${totKwh.toFixed(0)}</div>
            <div class="op-kpi-label">kWh totali</div>
            <div class="op-kpi-desc">Consumo giornaliero flotta</div>
          </div>
          <div class="op-kpi-card">
            <div class="op-kpi-val">${totCo2.toFixed(0)}</div>
            <div class="op-kpi-label">kg CO₂</div>
            <div class="op-kpi-desc">Emissioni giornaliere</div>
          </div>
          <div class="op-kpi-card">
            <div class="op-kpi-val">€ ${totCosto.toFixed(0)}</div>
            <div class="op-kpi-label">Costo/giorno</div>
            <div class="op-kpi-desc">Costo energetico stimato</div>
          </div>
          <div class="op-kpi-card" style="cursor:pointer;" onclick="window.location.href='/static/efficiency-alarms.html'">
            <div class="op-kpi-val" style="color:${nAnomal>0?'#E74C3C':'#27AE60'};">${nAnomal}</div>
            <div class="op-kpi-label">Anomalie</div>
            <div class="op-kpi-desc">Consumi fuori norma</div>
          </div>
        </div>
      </div>
      <div id="eff-kpi-summary" class="kpi-group">
        <div class="kpi-group-header"><i class="fas fa-tachometer-alt" style="margin-right:5px;color:var(--accent);"></i>Efficienza per asset</div>
        <div class="op-kpi-grid" style="grid-template-columns:repeat(3,1fr);">
          <div class="op-kpi-card">
            <div class="op-kpi-val" style="color:#27AE60;">${alta}</div>
            <div class="op-kpi-label">Alta</div>
            <div class="op-kpi-desc">Rating A/B</div>
          </div>
          <div class="op-kpi-card">
            <div class="op-kpi-val" style="color:#F39C12;">${summary.length - alta - bassa}</div>
            <div class="op-kpi-label">Media</div>
            <div class="op-kpi-desc">Rating C</div>
          </div>
          <div class="op-kpi-card">
            <div class="op-kpi-val" style="color:#E74C3C;">${bassa}</div>
            <div class="op-kpi-label">Bassa</div>
            <div class="op-kpi-desc">Rating D/E</div>
          </div>
        </div>
      </div>`;

    // Anomalie da monitorare (max 4)
    if (anomalie.length > 0) {
      html += `<div class="kpi-group-header" style="margin-top:14px;"><i class="fas fa-exclamation-triangle" style="margin-right:5px;color:#E74C3C;"></i>Anomalie da monitorare</div>`;
      anomalie.slice(0, 4).forEach(a => {
        const isAlarm = a.severita === 'alta';
        html += `
          <div class="alert-item ${isAlarm?'':'warning'}" style="cursor:pointer;" onclick="gestisciClickAnomalia('${a.nome}')">
            <i class="fas fa-bolt alert-icon" style="color:${isAlarm?'#E74C3C':'#F39C12'};"></i>
            <div>
              <div class="alert-nome">${a.nome}</div>
              <div class="alert-msg">${a.tipo || 'Anomalia consumo'} &mdash; +${(a.delta_pct||0).toFixed(0)}%</div>
            </div>
          </div>`;
      });
      if (anomalie.length > 4) {
        html += `<div style="font-size:10px;color:var(--text-secondary);text-align:center;padding:4px 0;">+ altri ${anomalie.length - 4} anomalie</div>`;
      }
    } else {
      html += `<div style="margin-top:16px;padding:10px;background:var(--bg-card);border:1px solid var(--border);font-size:11px;color:var(--text-secondary);">
        <i class="fas fa-check-circle" style="color:var(--stato-attivo);margin-right:6px;"></i>
        Nessuna anomalia energetica rilevata
      </div>`;
    }

    // Top 3 asset per consumo
    const top3 = [...summary].sort((a, b) => (b.kwh_giorno||0) - (a.kwh_giorno||0)).slice(0, 3);
    if (top3.length > 0) {
      html += `<div class="kpi-group-header" style="margin-top:14px;"><i class="fas fa-list-ol" style="margin-right:5px;color:var(--accent);"></i>Top consumi oggi</div>`;
      top3.forEach((item, idx) => {
        const ratingColor = { A:'#27AE60', B:'#4CAF50', C:'#F39C12', D:'#E74C3C', E:'#c0392b' };
        const rc = ratingColor[item.rating_esg] || 'var(--text-secondary)';
        html += `
          <div class="alert-item" style="cursor:pointer;" onclick="gestisciClickAsset(${item.asset_id})">
            <div style="width:20px;height:20px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--accent);flex-shrink:0;">${idx+1}</div>
            <div style="flex:1;">
              <div class="alert-nome">${item.nome}</div>
              <div class="alert-msg">${(item.kwh_giorno||0).toFixed(0)} kWh/g &mdash; ${(item.kwh_mq||0).toFixed(2)} kWh/m²</div>
            </div>
            <span style="font-size:13px;font-weight:700;color:${rc};">${item.rating_esg||'–'}</span>
          </div>`;
      });
    }

    panel.innerHTML = html;

    // Click su anomalia: cerca asset per nome e apre modale
    window.gestisciClickAnomalia = function(nome) {
      const found = allMarkers.find(m =>
        m.feature.properties.nome.toLowerCase().includes(nome.toLowerCase().split(' ')[0])
      );
      if (found) {
        map.setView(found.marker.getLatLng(), 12, { animate: true });
        selezionaAsset(found.feature, found.marker);
      }
    };

    // Click su asset: apre modale
    window.gestisciClickAsset = function(assetId) {
      const found = allMarkers.find(m => m.feature.properties.id === assetId);
      if (found) {
        map.setView(found.marker.getLatLng(), 12, { animate: true });
        selezionaAsset(found.feature, found.marker);
      }
    };

    // Aggiorna marker con colori efficienza
    caricaHUD();

  } catch(e) {
    console.error('[caricaStats] Errore:', e.message, e.stack);
    panel.innerHTML =
      `<div style="text-align:center;padding:20px;color:var(--stato-inattivo)">
         <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
         <div style="font-size:13px">Impossibile caricare la panoramica energetica.</div>
         <div style="font-size:11px;margin-top:4px;color:var(--text-secondary)">Verificare la connessione e ricaricare la pagina.</div>
       </div>`;
  }
}

// =============================================
// POLLING LIVE (ogni 60s)
// =============================================
// _assetAperto è dichiarato in efficiency-map-modal.js

function _aggiornaLive() {
  caricaStats();
  caricaHUD();
}
setInterval(_aggiornaLive, 60000);

// =============================================
// TAB SWITCHING e CHIUSURA MODALE
// Gestiti da efficiency-detail-modal.js (modale condivisa)
// I vecchi listener mm-close / map-modal-overlay sono stati rimossi

// =============================================
// AVVIO
// =============================================
i18n.apply();
caricaAssets();
caricaStats();
caricaHUD();
setTimeout(() => map.invalidateSize(), 300);

// Toggle pannello laterale
(function() {
  const panel  = document.getElementById('side-panel');
  const toggle = document.getElementById('panel-toggle');
  const icon   = document.getElementById('panel-toggle-icon');
  let aperto   = true;

  function aggiornaTasto() {
    if (aperto) {
      icon.className = 'fas fa-chevron-right';
      toggle.title = 'Chiudi pannello';
    } else {
      icon.className = 'fas fa-chevron-left';
      toggle.title = 'Apri pannello';
    }
  }

  toggle.addEventListener('click', () => {
    aperto = !aperto;
    panel.classList.toggle('collapsed', !aperto);
    aggiornaTasto();
    setTimeout(() => map.invalidateSize(), 320);
  });

  aggiornaTasto();
})();

// Sidebar navigazione — centralizzata in utils.js renderSidebar()
renderSidebar('eff-mappa', 'efficiency', 'map-sidebar');

// Plotly (caricamento lazy)
(function() {
  if (typeof Plotly === 'undefined') {
    const s = document.createElement('script');
    s.src = 'https://cdn.plot.ly/plotly-2.27.0.min.js';
    document.head.appendChild(s);
  }
})();
