/**
 * map-stats.js — Pannello laterale, panoramica operativa, live polling
 *
 * @module map-stats
 * @requires map-config.js  Costanti globali (COLORE_MARKER, ICONE_TIPO)
 * @requires map-core.js    allMarkers, selezionaAsset, caricaHUD
 * @requires map-modal.js   apriModaleAsset, chiudiModaleAsset
 * @requires api.js         Autenticazione, fetch helper
 *
 * Funzioni principali:
 *   ecgSvg()                Genera l'HTML SVG dell'animazione ECG
 *   renderDettaglio(data, container)  Renderizza il pannello dettaglio asset
 *   caricaStats()           Carica e renderizza la panoramica operativa (tachimetri, ESG, allarmi)
 *   _aggiornaLive()         Aggiorna panoramica e dettaglio asset aperto (polling 60s)
 *
 * Variabili:
 *   _assetAperto   ID dell'asset con modale/dettaglio aperto (null se nessuno)
 */
/* global API, map, allMarkers, filtroAttivo, COLORE_MARKER, ICONE_TIPO, COLORI_STATO,
          selezionaAsset, apriModaleAsset, chiudiModaleAsset, caricaHUD,
          caricaStats, i18n, GAM_CONFIG */
// =============================================
// TORNA ALLA PANORAMICA (compatibilità)
// =============================================
/**
 * Chiude la modale dettaglio e torna alla panoramica operativa.
 *
 * Wrapper di compatibilità per chiudiModaleAsset(), usato dai link
 * "Torna alla panoramica" nel pannello dettaglio.
 *
 * @function tornaOverview
 * @returns {void}
 */
function tornaOverview() {
  chiudiModaleAsset();
}

// =============================================
// RENDER DETTAGLIO ASSET
// =============================================
/**
 * Genera l'HTML SVG dell'animazione ECG (elettrocardiogramma) per il live indicator.
 *
 * L'animazione è realizzata tramite CSS e viene usata nel panel-header
 * per indicare che i dati sono aggiornati in tempo reale.
 *
 * @function ecgSvg
 * @returns {string} Stringa HTML con l'elemento SVG dell'animazione ECG
 */
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

/**
 * Renderizza il pannello dettaglio asset nel contenitore specificato.
 *
 * Genera l'HTML completo del pannello con: anagrafica, monitoraggio operativo,
 * allarmi attivi, work order, link BIM viewer e widget meteo live.
 * Il contenuto varia in base al tipo di asset (stabilimento, ufficio, magazzino, deposito).
 *
 * @function renderDettaglio
 * @param {Object}      data      - Dati asset restituiti da API.getAsset(id)
 * @param {Object}      data.asset        - Dati anagrafici dell'asset
 * @param {Object}      data.monitoraggio - Dati di monitoraggio operativo
 * @param {Object[]}    [data.allarmi]    - Lista allarmi attivi
 * @param {HTMLElement} container - Elemento DOM in cui iniettare l'HTML
 * @returns {void}
 */
function renderDettaglio(data, container) {
  const a = data.asset;
  const m = data.monitoraggio;
  const allarmi = data.allarmi || [];
  const statoClass = a.stato === 'attivo' ? 'stato-attivo' : a.stato === 'manutenzione' ? 'stato-manutenzione' : 'stato-inattivo';
  const statoLabel = a.stato === 'attivo' ? i18n.t('stato.attivo') : a.stato === 'manutenzione' ? i18n.t('stato.manutenzione') : i18n.t('stato.inattivo');
  const fa = ICONE_TIPO[a.tipo] || 'fa-map-pin';
  const tipoLabel = {
    stabilimento: i18n.t('tipo.stabilimento'),
    ufficio:      i18n.t('tipo.ufficio'),
    magazzino:    i18n.t('tipo.magazzino'),
    deposito:     i18n.t('tipo.deposito')
  }[a.tipo] || a.tipo;

  let html = `
    <div class="back-link" onclick="tornaOverview()">
      <i class="fas fa-arrow-left"></i> ${i18n.t('mappa.panoramica')}
    </div>
    <div>
      <div class="asset-tipo-badge"><i class="fas ${fa}"></i> ${tipoLabel}</div>
      <div class="asset-nome">${a.nome} <span class="stato-badge ${statoClass}">${statoLabel}</span></div>
      <div class="asset-codice">${a.codice}</div>
    </div>
    <div class="section" style="margin-top:16px;">
      <div class="section-title">Anagrafica</div>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Città</span>
          <span class="info-value">${a.citta||'—'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Provincia</span>
          <span class="info-value">${a.provincia||'—'}</span>
        </div>
        <div class="info-item full">
          <span class="info-label">Indirizzo</span>
          <span class="info-value">${a.indirizzo||'—'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Referente</span>
          <span class="info-value">${a.referente||'—'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Telefono</span>
          <span class="info-value">${a.telefono||'—'}</span>
        </div>
        ${a.superficie_mq ? `<div class="info-item">
          <span class="info-label">Superficie</span>
          <span class="info-value">${a.superficie_mq.toLocaleString('it-IT')} mq</span>
        </div>` : ''}
        ${a.anno_costruzione ? `<div class="info-item">
          <span class="info-label">Anno</span>
          <span class="info-value">${a.anno_costruzione}</span>
        </div>` : ''}
      </div>
    </div>
    <div class="section">
      <div class="section-title">Georeferenziazione</div>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Latitudine</span>
          <span class="info-value" style="font-family:monospace;">${a.lat.toFixed(5)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Longitudine</span>
          <span class="info-value" style="font-family:monospace;">${a.lon.toFixed(5)}</span>
        </div>
      </div>
    </div>`;

  // Monitoraggio per tipo
  if (m && Object.keys(m).length > 0) {
    html += `<div class="section">
      <div class="section-title">Monitoraggio operativo</div>
      <div class="kpi-grid">`;

    if (a.tipo === 'ufficio') {
      const pct = m.capienza_massima > 0 ? Math.round((m.dipendenti_presenti/m.capienza_massima)*100) : 0;
      const bc  = pct > 90 ? 'alarm' : pct > 70 ? 'warn' : '';
      html += `
        <div class="kpi-card ${bc}">
          <div class="kpi-value">${m.dipendenti_presenti}</div>
          <div class="kpi-label">Dipendenti presenti</div>
          <div class="progress-bar-bg"><div class="progress-bar-fill ${pct>90?'danger':pct>70?'warn':''}" style="width:${pct}%"></div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.capienza_massima}</div>
          <div class="kpi-label">Capienza massima</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.sale_riunioni_occupate}/${m.sale_riunioni_totali}</div>
          <div class="kpi-label">Sale riunioni occupate</div>
        </div>
        <div class="kpi-card ${bc}">
          <div class="kpi-value">${pct}%</div>
          <div class="kpi-label">Occupancy</div>
        </div>`;
    } else if (a.tipo === 'stabilimento') {
      const pctL = m.linee_produzione_totali > 0 ? Math.round((m.linee_produzione_attive/m.linee_produzione_totali)*100) : 0;
      html += `
        <div class="kpi-card">
          <div class="kpi-value">${m.personale_attivo}</div>
          <div class="kpi-label">Personale attivo</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.linee_produzione_attive}/${m.linee_produzione_totali}</div>
          <div class="kpi-label">Linee produzione attive</div>
          <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pctL}%"></div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.media_produzione_giornaliera_pz ? m.media_produzione_giornaliera_pz.toLocaleString('it-IT') : '—'}</div>
          <div class="kpi-label">Media pezzi/giorno</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.capacita_personale||'—'}</div>
          <div class="kpi-label">Capacità personale</div>
        </div>`;
    } else if (a.tipo === 'magazzino') {
      const pctS = m.saturazione_stoccaggio_pct || 0;
      const bc   = pctS > 90 ? 'alarm' : pctS > 80 ? 'warn' : '';
      html += `
        <div class="kpi-card ${bc}">
          <div class="kpi-value">${pctS}%</div>
          <div class="kpi-label">Saturazione stoccaggio</div>
          <div class="progress-bar-bg"><div class="progress-bar-fill ${pctS>90?'danger':pctS>80?'warn':''}" style="width:${pctS}%"></div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.operatori_presenti||'—'}</div>
          <div class="kpi-label">Operatori presenti</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.mezzi_magazzino_presenti||'—'}/${m.mezzi_magazzino_totali||'—'}</div>
          <div class="kpi-label">Mezzi magazzino</div>
        </div>`;
    } else if (a.tipo === 'deposito') {
      const pctM = m.mezzi_totali > 0 ? Math.round((m.mezzi_disponibili/m.mezzi_totali)*100) : 0;
      html += `
        <div class="kpi-card">
          <div class="kpi-value">${m.mezzi_disponibili}/${m.mezzi_totali}</div>
          <div class="kpi-label">Mezzi disponibili</div>
          <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pctM}%"></div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.mezzi_in_manutenzione||0}</div>
          <div class="kpi-label">Mezzi in manutenzione</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.mezzi_in_missione||0}</div>
          <div class="kpi-label">Mezzi in missione</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${m.mezzi_presenti||'—'}/${m.mezzi_totali||'—'}</div>
          <div class="kpi-label">Mezzi presenti/totali</div>
        </div>`;
    }

    html += `</div>
      <div class="update-time"><i class="fas fa-clock"></i> ${m.aggiornato_il ? new Date(m.aggiornato_il).toLocaleString('it-IT') : 'Dati simulati'}</div>
    </div>`;
  }

  // Allarmi attivi
  if (allarmi.length > 0) {
    html += `<div class="section" style="border-top:1px solid var(--border);padding-top:16px;">
      <div class="section-title alarm-title">Allarmi attivi (${allarmi.length})</div>`;
    // Mappa campo -> label leggibile (usa la label dalla soglia se disponibile)
    const campoLabel = {
      dipendenti_presenti:       'Occupancy',
      sale_riunioni_occupate:    'Sale riunioni',
      linee_produzione_attive:   'Linee produzione',
      personale_attivo:          'Personale attivo',
      saturazione_stoccaggio_pct:'Saturazione stoccaggio',
      mezzi_operativi:           'Mezzi operativi',
      mezzi_disponibili:         'Mezzi disponibili',
      mezzi_in_manutenzione:     'Mezzi in manutenzione',
    };
    allarmi.forEach(al => {
      const bc = al.livello === 'warning' ? 'warning' : '';
      const label = campoLabel[al.campo] || al.campo.replace(/_/g,' ');
      // al.valore è già la % calcolata dal server
      const valPct = typeof al.valore === 'number' ? al.valore.toFixed(1) + '%' : al.valore;
      const icon = al.livello === 'alarm'
        ? `<i class="fas fa-exclamation-circle" style="color:var(--stato-inattivo);font-size:11px;"></i>`
        : `<i class="fas fa-exclamation-triangle" style="color:var(--stato-man);font-size:11px;"></i>`;
      html += `<div class="alarm-row ${bc}">
        ${icon}
        <span class="alarm-row-label">${label}</span>
        <span class="alarm-row-val">${valPct}</span>
      </div>`;
    });
    html += `</div>`;
  }

  // ── Sezione ESG ────────────────────────────────────────────
  const e = data.esg || {};
  if (e.consumo_kwh_giorno !== undefined) {
    // Calcolo percentuale vs benchmark per mini-barre
    const pctKwh = e.benchmark_kwh > 0 ? Math.min(Math.round((e.consumo_kwh_giorno / e.benchmark_kwh) * 100), 150) : 0;
    const pctM3  = e.benchmark_m3  > 0 ? Math.min(Math.round((e.consumo_m3_acqua_giorno / e.benchmark_m3) * 100), 150) : 0;
    const bcKwh  = pctKwh > 120 ? 'danger' : pctKwh > 100 ? 'warn' : '';
    const bcM3   = pctM3  > 120 ? 'danger' : pctM3  > 100 ? 'warn' : '';
    const rating = e.rating_esg || 'C';

    html += `<div class="section esg-section">
      <div class="section-title esg-title">${i18n.t('esg.titolo')}</div>

      <div class="esg-row">
        <span class="esg-row-icon"><i class="fas fa-bolt"></i></span>
        <span class="esg-row-label">${i18n.t('esg.energia')}</span>
        <span class="esg-row-val">${e.consumo_kwh_giorno.toLocaleString('it-IT')} ${i18n.t('esg.unita_kwh')}</span>
        <span class="esg-row-bench">/ ${e.benchmark_kwh}</span>
        <div class="esg-bar-wrap"><div class="esg-bar-fill ${bcKwh}" style="width:${Math.min(pctKwh,100)}%"></div></div>
      </div>

      <div class="esg-row">
        <span class="esg-row-icon"><i class="fas fa-tint"></i></span>
        <span class="esg-row-label">${i18n.t('esg.acqua')}</span>
        <span class="esg-row-val">${e.consumo_m3_acqua_giorno.toLocaleString('it-IT')} ${i18n.t('esg.unita_m3')}</span>
        <span class="esg-row-bench">/ ${e.benchmark_m3}</span>
        <div class="esg-bar-wrap"><div class="esg-bar-fill ${bcM3}" style="width:${Math.min(pctM3,100)}%"></div></div>
      </div>

      <div class="esg-row">
        <span class="esg-row-icon"><i class="fas fa-cloud"></i></span>
        <span class="esg-row-label">${i18n.t('esg.co2')} (S1+S2)</span>
        <span class="esg-row-val">${e.co2_totale_kg_giorno.toLocaleString('it-IT')} ${i18n.t('esg.unita_co2')}</span>
        <span class="esg-row-bench">S1: ${e.co2_scope1_kg_giorno} / S2: ${e.co2_scope2_kg_giorno}</span>
      </div>

      <div class="esg-row" style="border-bottom:none;padding-top:10px;">
        <span class="esg-row-label" style="font-size:11px;font-weight:600;">${i18n.t('esg.rating')}</span>
        <span class="esg-rating-badge esg-rating-${rating}">${rating}</span>
      </div>
    </div>`;
  }

  // ── Link BIM Viewer (solo se l'asset ha dati planimetrici) ──────────
  // Lista asset con BIM letta dalla configurazione centralizzata (config.js)
  if (GAM_CONFIG.BIM_ASSET_IDS.includes(a.id)) {
    html += `<div class="section">
      <div class="section-title" style="border-left-color:#00A3E0;background:rgba(0,163,224,0.06);">
        <i class="fas fa-building"></i> BIM Viewer
        <a href="/static/bim.html?asset_id=${a.id}" style="margin-left:auto;font-size:10px;color:var(--accent);text-decoration:none;font-weight:600;">Apri planimetria ›</a>
      </div>
      <div style="font-size:11px;color:var(--text-secondary);padding:6px 0;">
        Planimetria interattiva disponibile &mdash; visualizza locali e stato operativo per piano.
      </div>
    </div>`;
  }

  // ── Sezione Meteo (placeholder, popolato async) ─────────────
  html += `<div class="section" id="meteo-section-${a.id}">
    <div class="section-title meteo-title">${i18n.t('meteo.titolo')}</div>
    <div class="meteo-loading" id="meteo-loading-${a.id}">
      <i class="fas fa-spinner fa-spin"></i> ${i18n.t('meteo.caricamento')}
    </div>
  </div>`;

  // ── Sezione WO aperti sull'asset + prossima scadenza ─────────
  html += `<div class="section" id="wo-section-${a.id}">
    <div class="section-title" style="border-left-color:#F39C12;background:rgba(243,156,18,0.06);">
      <i class="fas fa-wrench"></i> Work Order aperti
      <a href="/static/workorders.html" style="margin-left:auto;font-size:10px;color:var(--accent);text-decoration:none;font-weight:600;">Tutti ›</a>
    </div>
    <div id="wo-list-${a.id}" style="font-size:11px;color:var(--text-secondary);padding:6px 0;">
      <i class="fas fa-spinner fa-spin"></i> Caricamento...
    </div>
  </div>
  <div class="section" id="scad-section-${a.id}">
    <div class="section-title" style="border-left-color:#9B59B6;background:rgba(155,89,182,0.06);">
      <i class="fas fa-calendar-times"></i> Prossima scadenza
      <a href="/static/deadlines.html" style="margin-left:auto;font-size:10px;color:var(--accent);text-decoration:none;font-weight:600;">Tutte ›</a>
    </div>
    <div id="scad-info-${a.id}" style="font-size:11px;color:var(--text-secondary);padding:6px 0;">
      <i class="fas fa-spinner fa-spin"></i> Caricamento...
    </div>
  </div>`;

  html += `<div class="sim-note"><i class="fas fa-info-circle"></i>${i18n.t('mappa.sim_note')}</div>`;
  container.innerHTML = html;

  // ── Fetch WO aperti sull'asset (API restituisce array semplice) ────
  (async () => {
    const woEl = document.getElementById(`wo-list-${a.id}`);
    try {
      const r = await fetch(`/api/work-orders?asset_id=${a.id}`, {
        headers: { 'Authorization': 'Bearer ' + API.getToken() }
      });
      const all = await r.json();
      const items = Array.isArray(all)
        ? all.filter(w => ['aperto','in_corso'].includes(w.stato)).slice(0, 4)
        : [];
      if (!woEl) return;
      if (items.length === 0) {
        woEl.innerHTML = '<span style="color:var(--stato-attivo);"><i class="fas fa-check-circle" style="margin-right:4px;"></i>Nessun WO aperto</span>';
      } else {
        woEl.innerHTML = items.map(w => {
          const priCol = w.priorita === 'critica' ? '#E74C3C' : w.priorita === 'alta' ? '#F39C12' : 'var(--text-secondary)';
          return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border);">
            <i class="fas fa-circle" style="font-size:7px;color:${priCol};"></i>
            <span style="flex:1;color:var(--text-primary);">${w.titolo}</span>
            <span style="font-size:10px;color:${priCol};font-weight:600;">${w.priorita}</span>
          </div>`;
        }).join('');
        const totAperti = Array.isArray(all) ? all.filter(w => ['aperto','in_corso'].includes(w.stato)).length : 0;
        if (totAperti > 4) woEl.innerHTML += `<div style="text-align:center;padding:4px 0;font-size:10px;">+ altri ${totAperti - 4}</div>`;
      }
    } catch(e) {
      console.warn('[renderDettaglio] Impossibile caricare i work order per asset', a.id, ':', e.message);
      if (woEl) woEl.innerHTML = '<span style="color:var(--text-secondary);font-size:12px;"><i class="fa fa-exclamation-circle" style="margin-right:4px;"></i>Dati non disponibili</span>';
    }
  })();

  // ── Fetch prossima scadenza sull'asset (API restituisce array semplice) ──
  (async () => {
    const scEl = document.getElementById(`scad-info-${a.id}`);
    try {
      const r = await fetch(`/api/deadlines?asset_id=${a.id}&stato=aperta`, {
        headers: { 'Authorization': 'Bearer ' + API.getToken() }
      });
      const all = await r.json();
      const items = Array.isArray(all)
        ? all.filter(dl => dl.stato === 'aperta').sort((x,y) => x.data_scadenza.localeCompare(y.data_scadenza))
        : [];
      if (!scEl) return;
      if (items.length === 0) {
        scEl.innerHTML = '<span style="color:var(--stato-attivo);"><i class="fas fa-check-circle" style="margin-right:4px;"></i>Nessuna scadenza aperta</span>';
      } else {
        const dl = items[0];
        const oggi = new Date().toISOString().split('T')[0];
        const gg = Math.ceil((new Date(dl.data_scadenza) - new Date(oggi)) / 86400000);
        const col = gg < 0 ? '#E74C3C' : gg <= 7 ? '#F39C12' : 'var(--text-primary)';
        const ggLabel = gg < 0 ? `${Math.abs(gg)} gg fa` : gg === 0 ? 'Oggi' : `tra ${gg} gg`;
        scEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">
          <i class="fas fa-calendar" style="color:${col};"></i>
          <div style="flex:1;">
            <div style="color:var(--text-primary);font-weight:600;">${dl.titolo}</div>
            <div style="color:${col};font-size:10px;">${dl.data_scadenza} &mdash; <strong>${ggLabel}</strong></div>
          </div>
        </div>
        ${items.length > 1 ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">+ altre ${items.length-1} scadenze aperte</div>` : ''}`;
      }
    } catch(e) {
      console.warn('[renderDettaglio] Impossibile caricare le scadenze per asset', a.id, ':', e.message);
      if (scEl) scEl.innerHTML = '<span style="color:var(--text-secondary);font-size:12px;"><i class="fa fa-exclamation-circle" style="margin-right:4px;"></i>Dati non disponibili</span>';
    }
  })();

  // ── Fetch meteo asincrono ────────────────────────────────────
  if (a.lat && a.lon) {
    caricaMeteo(a.id, a.lat, a.lon);
  } else {
    const el = document.getElementById(`meteo-loading-${a.id}`);
    if (el) el.textContent = i18n.t('meteo.errore');
  }
}

// =============================================
// PANORAMICA OPERATIVA (stats)
// =============================================
/**
 * Carica la panoramica operativa dal backend e aggiorna il pannello laterale.
 *
 * Chiama API.getStats() e renderizza: tachimetri per tipo asset (occupancy,
 * linee produzione, saturazione, mezzi), dati ESG aggregati, situazioni da
 * monitorare e il footer con conteggio allarmi.
 *
 * @async
 * @function caricaStats
 * @returns {Promise<void>}
 */
async function caricaStats() {
  const panel = document.getElementById('overview-panel');
  try {
    const data = await API.getStats();
    const ora  = new Date().toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
    const kpi  = data.kpi || {};
    const tipiKpi = [
      { key:'uffici',        fa:'fa-building',  label: i18n.t('tipo.uffici'),        tipo:'ufficio'      },
      { key:'stabilimenti',  fa:'fa-industry',  label: i18n.t('tipo.stabilimenti'),  tipo:'stabilimento' },
      { key:'magazzini',     fa:'fa-archive',   label: i18n.t('tipo.magazzini'),     tipo:'magazzino'    },
      { key:'depositi',      fa:'fa-truck',     label: i18n.t('tipo.depositi'),      tipo:'deposito'     },
    ];
    // Aggiorna il timestamp nel panel-header
    const headerTs = document.getElementById('panel-header-ts');
    if (headerTs) headerTs.innerHTML = `Live &mdash; ${ora} &nbsp;&bull;&nbsp; ${data.totale_asset} asset`;

    let html = `
      <div id="op-kpi-groups">
        <div class="kpi-group group-wo">
          <div class="kpi-group-header"><i class="fas fa-wrench"></i> Work Order</div>
          <div class="op-kpi-grid" id="op-kpi-wo">
            <div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:11px;grid-column:span 3;"><i class="fas fa-spinner fa-spin"></i></div>
          </div>
        </div>
        <div class="kpi-group group-scad">
          <div class="kpi-group-header"><i class="fas fa-calendar-alt"></i> Scadenze</div>
          <div class="op-kpi-grid" id="op-kpi-scad">
            <div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:11px;grid-column:span 2;"><i class="fas fa-spinner fa-spin"></i></div>
          </div>
        </div>
        <div class="kpi-group group-asset">
          <div class="kpi-group-header"><i class="fas fa-building"></i> Asset</div>
          <div class="op-kpi-grid" id="op-kpi-asset">
            <div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:11px;grid-column:span 2;"><i class="fas fa-spinner fa-spin"></i></div>
          </div>
        </div>
      </div>
      <div class="kpi-group-header" style="margin-top:14px;">${i18n.t('mappa.panoramica')}</div>`;

    // ── Tachimetri SVG a semicerchio ─────────────────────────────
    // Semicerchio: cx=50 cy=54 r=40, arco da 180° a 0° (senso antiorario)
    // circumference del semicerchio = π * r = 3.14159 * 40 ≈ 125.66
    const R = 40;
    const CIRC = Math.PI * R; // 125.66
    function buildGauge(tipo, fa, label, k, cnt) {
      // Usa la % già calcolata dal server se disponibile, altrimenti la calcola
      const pct = (k.pct !== undefined) ? k.pct
                : k.totale ? Math.round((k.valore / k.totale) * 100)
                : Math.min(k.valore, 100);
      // Semaforo: usa le soglie dal server (soglia_warning, soglia_alarm, inverso)
      // inverso=1: basso = brutto (es. mezzi disponibili)
      // inverso=0: alto = brutto (es. occupancy, saturazione)
      const sw = k.soglia_warning !== undefined ? k.soglia_warning : 70;
      const sa = k.soglia_alarm   !== undefined ? k.soglia_alarm   : 90;
      const inv = k.inverso || 0;
      let bc;
      if (inv) {
        bc = pct <= sa ? 'danger' : pct <= sw ? 'warn' : 'ok';
      } else {
        bc = pct >= sa ? 'danger' : pct >= sw ? 'warn' : 'ok';
      }
      const valTxt = k.totale ? k.valore+'/'+k.totale : k.valore+(k.unita||'');
      const offset = CIRC - (pct / 100) * CIRC;
      return `
        <div class="gauge-card ${bc}" data-tipo="${tipo}">
          <svg class="gauge-svg" viewBox="0 0 100 58">
            <!-- traccia grigia -->
            <path class="gauge-track"
              d="M 10,54 A 40,40 0 0,1 90,54"
              stroke-dasharray="${CIRC.toFixed(2)}"
              stroke-dashoffset="0"/>
            <!-- arco colorato -->
            <path class="gauge-fill ${bc}"
              d="M 10,54 A 40,40 0 0,1 90,54"
              stroke-dasharray="${CIRC.toFixed(2)}"
              stroke-dashoffset="${offset.toFixed(2)}"/>
            <!-- valore centrale -->
            <text class="gauge-value" x="50" y="46">${valTxt}</text>
          </svg>
          <div class="gauge-label"><i class="fas ${fa}" style="color:${COLORE_MARKER};margin-right:3px;"></i>${label} <span style="opacity:0.55;">(${cnt})</span></div>
          <div class="gauge-sub">${k.label}</div>
        </div>`;
    }
    html += '<div class="gauges-grid">';
    tipiKpi.forEach(t => {
      const k = kpi[t.key];
      if (!k) return;
      const cnt = data.per_tipo ? (data.per_tipo[t.tipo] || 0) : '';
      html += buildGauge(t.tipo, t.fa, t.label, k, cnt);
    });
    html += '</div>';

    // ── KPI ESG flotta (prima delle situazioni da monitorare) ─────
    let esgHtml = '';
    try {
      const esgData = await API.getStatsEsg();
      const ratingColor = {
        A: '#27AE60', B: 'var(--accent)', C: 'var(--stato-man)', D: 'var(--stato-inattivo)'
      };
      const rc = ratingColor[esgData.rating_flotta] || 'var(--text-secondary)';
      esgHtml = `
        <div style="margin-top:8px;margin-bottom:4px;">
          <div class="kpi-group-header">${i18n.t('esg.titolo')}</div>
          <div class="esg-fleet-bar">
            <div class="esg-fleet-kpi">
              <div class="esg-fleet-val">${(esgData.co2_anno_tonnellate||0).toLocaleString('it-IT')}</div>
              <div class="esg-fleet-label">${i18n.t('esg.flotta_co2')}<br>${i18n.t('esg.unita_tannno')}</div>
            </div>
            <div class="esg-fleet-sep"></div>
            <div class="esg-fleet-kpi">
              <div class="esg-fleet-val">${(esgData.kwh_medio_giorno||0).toLocaleString('it-IT')}</div>
              <div class="esg-fleet-label">${i18n.t('esg.flotta_kwh')}<br>${i18n.t('esg.unita_kwh_asset')}</div>
            </div>
            <div class="esg-fleet-sep"></div>
            <div class="esg-fleet-kpi">
              <div class="esg-fleet-val" style="color:${rc};font-size:20px;">${esgData.rating_flotta}</div>
              <div class="esg-fleet-label">${i18n.t('esg.flotta_rating')}</div>
            </div>
          </div>
        </div>`;
    } catch(esgErr) {
      console.warn('[caricaStats] Impossibile caricare i dati ESG:', esgErr.message);
      // ESG non critico: la panoramica viene comunque mostrata senza il blocco ESG
    }
    html += esgHtml;

    // Situazioni da monitorare (max 4)
    const da_mon = data.da_monitorare || [];
    if (da_mon.length > 0) {
      html += `<div class="kpi-group-header" style="margin-top:10px;">${i18n.t('mappa.da_monitorare')}</div>`;
      da_mon.slice(0, 4).forEach(a => {
        const isAlarm = a.livello_max === 'alarm';
        html += `
          <div class="alert-item ${isAlarm?'':'warning'}" data-id="${a.id}">
            <i class="fas fa-exclamation-triangle alert-icon"></i>
            <div>
              <div class="alert-nome">${a.nome}</div>
              <div class="alert-msg">${a.citta} &mdash; ${a.tipo}</div>
            </div>
          </div>`;
      });
      if (da_mon.length > 4) {
        html += `<div style="font-size:10px;color:var(--text-secondary);text-align:center;padding:4px 0;">+ altri ${da_mon.length - 4} asset da monitorare</div>`;
      }
    } else {
      html += `<div style="margin-top:16px;padding:10px;background:var(--bg-card);border:1px solid var(--border);font-size:11px;color:var(--text-secondary);">
        <i class="fas fa-check-circle" style="color:var(--stato-attivo);margin-right:6px;"></i>
        ${i18n.t('mappa.nessuna_critica')}
      </div>`;
    }

    // Allarmi totali
    if (data.allarmi) {
      html += `<div style="margin-top:14px;font-size:11px;color:var(--text-secondary);">
        <i class="fas fa-bell" style="margin-right:5px;color:${data.allarmi.totale_attivi>0?'var(--stato-inattivo)':'var(--stato-attivo)'};"></i>
        ${data.allarmi.totale_attivi} ${i18n.t('mappa.allarmi_attivi')} (${data.allarmi.livello_alarm} ${i18n.t('mappa.critici')})
        &nbsp;·&nbsp; <a href="/static/alarms.html" style="color:var(--accent);text-decoration:none;">${i18n.t('mappa.gestisci')}</a>
      </div>`;
    }

    panel.innerHTML = html;

    // Popola subito i KPI operativi (ora che il div op-kpi-grid è nel DOM)
    caricaHUD();

    // Click su KPI: filtra mappa
    panel.querySelectorAll('.gauge-card').forEach(card => {
      card.addEventListener('click', () => {
        const tipo = card.dataset.tipo;
        document.querySelectorAll('.filter-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.tipo === tipo);
        });
        filtroAttivo = tipo;
        allMarkers.forEach(({ marker, feature }) => {
          const mostra = feature.properties.tipo === tipo;
          if (mostra) { if (!map.hasLayer(marker)) map.addLayer(marker); }
          else         { if (map.hasLayer(marker))  map.removeLayer(marker); }
        });
      });
    });

    // Click su alert: apre dettaglio
    panel.querySelectorAll('.alert-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id);
        const found = allMarkers.find(m => m.feature.properties.id === id);
        if (found) {
          map.setView(found.marker.getLatLng(), 12, { animate: true });
          selezionaAsset(found.feature, found.marker);
        }
      });
    });

  } catch(e) {
    console.error('[caricaStats] Errore nel caricamento della panoramica:', e.message, e.stack);
    panel.innerHTML =
      `<div style="text-align:center;padding:20px;color:var(--stato-inattivo)">
         <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
         <div style="font-size:13px">Impossibile caricare la panoramica operativa.</div>
         <div style="font-size:11px;margin-top:4px;color:var(--text-secondary)">Verificare la connessione e ricaricare la pagina.</div>
       </div>`;
  }
}

// =============================================
// =============================================
// POLLING LIVE (ogni 60s)
// =============================================
// Aggiorna la panoramica operativa e, se un asset è aperto, ricarica il suo dettaglio.
// I marker non vengono ricaricati (sono statici), solo i dati cambiano.
let _assetAperto = null; // id dell'asset attualmente aperto nel pannello dettaglio

/**
 * Aggiorna la panoramica operativa e il dettaglio asset aperto (polling live).
 *
 * Chiamata periodicamente da setInterval ogni GAM_CONFIG.LIVE_REFRESH_INTERVAL ms.
 * Esegue tre operazioni:
 * 1. Aggiorna la panoramica (caricaStats + caricaHUD)
 * 2. Se un asset è aperto nel pannello dettaglio, ricarica i suoi dati
 * 3. Aggiorna il badge allarmi nella sidebar
 *
 * @function _aggiornaLive
 * @returns {void}
 */
function _aggiornaLive() {
  // 1. Aggiorna la panoramica operativa (tachimetri, ESG, allarmi, situazioni)
  caricaStats();
  caricaHUD(); // Aggiorna HUD e marker colorati

  // 2. Se un asset è aperto, ricarica il suo dettaglio
  if (_assetAperto !== null) {
    const container = document.getElementById('detail-panel');
    if (container && container.style.display !== 'none') {
      API.getAsset(_assetAperto)
        .then(data => renderDettaglio(data, container))
        .catch(() => {});
    }
  }

  // 3. Aggiorna il badge allarmi nella sidebar
  API.getStats().then(stats => {
    const dot = document.getElementById('sb-alarm-dot');
    if (dot) {
      if ((stats.allarmi?.livello_alarm || 0) > 0) dot.classList.add('visible');
      else dot.classList.remove('visible');
    }
  }).catch(() => {});
}

// Avvia il polling dopo il caricamento iniziale
setTimeout(() => {
  setInterval(_aggiornaLive, GAM_CONFIG.LIVE_REFRESH_INTERVAL); // intervallo da config.js
}, 5000); // prima esecuzione dopo 5s dall'avvio

// ── Tab switching modale ─────────────────────────────────────
/**
 * Restituisce l'elemento iframe del viewer 3D.
 * @returns {HTMLIFrameElement|null}
 */
function _getViewer3DIframe() {
  return document.getElementById('ifc-viewer-iframe');
}

/**
 * Avvia il viewer 3D impostando src dell'iframe su ifc-viewer.html.
 * Il caricamento del file IFC (90 MB) parte solo quando la tab è attiva.
 */
function _avviaViewer3D() {
  const iframe = _getViewer3DIframe();
  if (!iframe) return;
  if (!iframe.src || iframe.src === window.location.href || iframe.src === '') {
    console.log('[Viewer3D] Avvio iframe → /static/ifc-viewer.html');
    iframe.src = '/static/ifc-viewer.html';
  }
}

/**
 * Ferma il viewer 3D azzerando src dell'iframe.
 * Libera memoria e interrompe il download del file IFC se in corso.
 */
function _fermaViewer3D() {
  const iframe = _getViewer3DIframe();
  if (!iframe) return;
  // Azzera src solo se il viewer era stato avviato
  const src = iframe.getAttribute('src');
  if (src && src !== '') {
    console.log('[Viewer3D] Stop iframe (src azzerato)');
    iframe.src = '';
    iframe.removeAttribute('src');
  }
}

document.querySelectorAll('.map-modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const prevActive = document.querySelector('.map-modal-tab.active');
    const prevPanel = prevActive ? prevActive.dataset.mmpanel : null;

    document.querySelectorAll('.map-modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.map-modal-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('mm-panel-' + tab.dataset.mmpanel).classList.add('active');

    // Se si lascia la tab viewer3d, ferma il viewer per risparmiare risorse
    if (prevPanel === 'viewer3d' && tab.dataset.mmpanel !== 'viewer3d') {
      _fermaViewer3D();
    }

    // Se si entra nella tab viewer3d, avvia il viewer 3D via iframe
    if (tab.dataset.mmpanel === 'viewer3d') {
      _avviaViewer3D();
    }
  });
});

// ── Chiusura modale ──────────────────────────────────────────
/**
 * Chiude la modale e ferma il viewer 3D (azzera src iframe per liberare memoria).
 */
function _chiudiModaleConViewer() {
  // Ferma il viewer 3D prima di chiudere la modale
  _fermaViewer3D();
  chiudiModaleAsset();
}
document.getElementById('mm-close').addEventListener('click', _chiudiModaleConViewer);
document.getElementById('mm-btn-chiudi').addEventListener('click', _chiudiModaleConViewer);
document.getElementById('map-modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('map-modal-overlay')) _chiudiModaleConViewer();
});

// =============================================
// AVVIO
// =============================================
i18n.apply(); // Traduce tutti i data-i18n nel DOM statico (filtri topbar, titoli, ecc.)
caricaAssets();
caricaStats();
caricaHUD();
// Forza Leaflet a ricalcolare le dimensioni dopo il rendering iniziale
setTimeout(() => map.invalidateSize(), 300);

// ── Toggle pannello laterale ──────────────────────────────────
(function() {
  const panel = document.getElementById('side-panel');
  const toggle = document.getElementById('panel-toggle');
  const icon = document.getElementById('panel-toggle-icon');
  const hudBar = document.getElementById('hud-bar');
  let aperto = true;

  function aggiornaTasto() {
    if (aperto) {
      icon.className = 'fas fa-chevron-right';
      toggle.title = 'Chiudi pannello';
      // HUD si restringe per lasciare spazio al pannello
      if (hudBar) hudBar.style.right = '8px';
    } else {
      icon.className = 'fas fa-chevron-left';
      toggle.title = 'Apri pannello';
      if (hudBar) hudBar.style.right = '8px';
    }
  }

  toggle.addEventListener('click', () => {
    aperto = !aperto;
    panel.classList.toggle('collapsed', !aperto);
    aggiornaTasto();
    // Forza ridisegno mappa dopo transizione
    setTimeout(() => map.invalidateSize(), 320);
  });

  aggiornaTasto();
})();

  // ── Sidebar navigazione ──────────────────────────────────────
  (function() {
    const sb = document.getElementById('map-sidebar');
    if (!sb) return;
    sb.innerHTML = `
      <a href="/static/map.html" class="sb-btn active" title="Mappa">
        <i class="fa fa-map-marker"></i>
      </a>
      <a href="/static/assets.html" class="sb-btn" title="Anagrafica asset">
        <i class="fa fa-database"></i>
      </a>
      <a href="/static/alarms.html" class="sb-btn" title="Allarmi" id="sb-allarmi">
        <i class="fa fa-bell"></i>
        <span class="sb-dot" id="sb-alarm-dot"></span>
      </a>
      <a href="/static/workorders.html" class="sb-btn" title="Work Order">
        <i class="fa fa-wrench"></i>
      </a>
      <a href="/static/deadlines.html" class="sb-btn" title="Scadenze">
        <i class="fa fa-calendar"></i>
      </a>
      <a href="/static/settings.html" class="sb-btn" title="Impostazioni">
        <i class="fa fa-cog"></i>
      </a>
      <div class="sb-spacer"></div>
      <button class="sb-btn" onclick="API.logout()" title="Esci">
        <i class="fa fa-sign-out"></i>
      </button>
    `;
  })();