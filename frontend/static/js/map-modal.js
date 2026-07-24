/**
 * map-modal.js — Modale dettaglio asset del GIS Asset Manager
 *
 * @module map-modal
 * @requires map-config.js  Costanti globali
 * @requires map-core.js    allMarkers, allFeatures, map
 * @requires map-bim.js     mmCaricaPlanimetria, mmCaricaBIM
 * @requires api.js         Autenticazione, fetch helper
 *
 * Funzioni principali:
 *   selezionaAsset(feature, marker)  Centra la mappa e apre la modale
 *   apriModaleAsset(id)              Carica dati asset e popola la modale
 *   chiudiModaleAsset()              Chiude la modale e resetta _assetAperto
 *
 * Costanti:
 *   BIM_ASSET_IDS_MODAL   Array di asset_id con tab Planimetria/BIM abilitata
 */
/* global API, map, allMarkers, ICONE_TIPO, COLORI_STATO, i18n,
          mmCaricaPlanimetria, mmCaricaBIM, GAM_CONFIG */
// =============================================
// SELEZIONE ASSET: apre la modale dettaglio
// =============================================
/**
 * Centra la mappa sull'asset e apre la modale dettaglio.
 *
 * Questa funzione è il punto di ingresso principale per la selezione di un asset
 * sia tramite click su marker che tramite ricerca o deep link.
 *
 * @function selezionaAsset
 * @param {GeoJSON.Feature} feature - Feature GeoJSON dell'asset selezionato
 * @param {L.Marker}        marker  - Marker Leaflet corrispondente all'asset
 * @returns {void}
 */
function selezionaAsset(feature, marker) {
  // Centra la mappa sull'asset
  map.panTo(marker.getLatLng());
  // Apre la modale dettaglio
  apriModaleAsset(feature.properties.id);
}

// =============================================
// MODALE DETTAGLIO ASSET
// =============================================
// Asset ID con tab Planimetria/BIM abilitata — letto dalla configurazione centralizzata (config.js)
const BIM_ASSET_IDS_MODAL = GAM_CONFIG.BIM_ASSET_IDS;

/**
 * Carica i dati di un asset dal backend e popola la modale dettaglio.
 *
 * Gestisce tutte le tab della modale (Anagrafica, Monitoraggio, ESG, Allarmi,
 * Work Order, Documenti, Planimetria, BIM). Mostra le tab Planimetria e BIM
 * solo per gli asset inclusi in GAM_CONFIG.BIM_ASSET_IDS.
 *
 * @async
 * @function apriModaleAsset
 * @param {number} id - ID dell'asset da visualizzare
 * @returns {Promise<void>}
 */
async function apriModaleAsset(id) {
  const overlay = document.getElementById('map-modal-overlay');
  overlay.classList.add('open');

  // Reset tab: torna sempre ad Anagrafica
  document.querySelectorAll('.map-modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.map-modal-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.map-modal-tab[data-mmpanel="anagrafica"]').classList.add('active');
  document.getElementById('mm-panel-anagrafica').classList.add('active');
  document.getElementById('mm-panel-anagrafica').innerHTML = '<div class="spinner" style="margin:24px auto"></div>';

  // Reset badge (null-safe: alcuni elementi potrebbero non esistere in tutte le pagine)
  const _elAlarmBadge = document.getElementById('mm-alarm-badge');
  const _elWoBadge    = document.getElementById('mm-wo-badge');
  const _elDocBadge   = document.getElementById('mm-doc-badge');
  const _elDlBadge    = document.getElementById('mm-dl-badge');
  if (_elAlarmBadge) _elAlarmBadge.innerHTML = '';
  if (_elWoBadge)    _elWoBadge.innerHTML = '';
  if (_elDocBadge)   _elDocBadge.innerHTML = '';
  if (_elDlBadge)    _elDlBadge.innerHTML = '';
  document.getElementById('mm-title').textContent = 'Caricamento...';
  document.getElementById('mm-subtitle').textContent = '';

  _assetAperto = id;
  window._assetApertoId = id; // esposto globalmente per il viewer 3D

  try {
    const d = await API.getAsset(id);
    const a = d.asset;
    const m = d.monitoraggio || {};
    const esg = d.esg || {};
    const allarmi = d.allarmi || [];

    document.getElementById('mm-title').textContent = a.codice + ' — ' + a.nome;
    document.getElementById('mm-subtitle').textContent = a.tipo + ' · ' + a.citta + (a.provincia ? ' (' + a.provincia + ')' : '');

    // Pulsante anagrafica
    const _btnAnagrafica = document.getElementById('mm-btn-anagrafica');
    if (_btnAnagrafica) _btnAnagrafica.href = '/static/assets.html';

    // Tab Planimetria, BIM e Modello 3D: visibili solo per asset con dati BIM
    const tabPlani    = document.querySelector('.mm-tab-planimetria');
    const tabBim      = document.querySelector('.mm-tab-bim');
    const tabViewer3d = document.querySelector('.mm-tab-viewer3d');
    if (BIM_ASSET_IDS_MODAL.includes(a.id)) {
      tabPlani.style.display    = 'inline-block';
      tabBim.style.display      = 'inline-block';
      if (tabViewer3d) tabViewer3d.style.display = 'inline-block';
      // Pre-carica dati planimetria
      mmCaricaPlanimetria(a.id);
      // Pre-carica dati BIM IFC
      mmCaricaBIM(a.id);
    } else {
      tabPlani.style.display = 'none';
      tabBim.style.display   = 'none';
      if (tabViewer3d) tabViewer3d.style.display = 'none';
    }

    // Badge allarmi
    const alarmBadge = document.getElementById('mm-alarm-badge');
    if (allarmi.length > 0) {
      alarmBadge.innerHTML = ` <span style="background:var(--stato-inattivo);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px">${allarmi.length}</span>`;
    }

    // Tab Anagrafica
    const statoLabel = { attivo: 'Attivo', manutenzione: 'In manutenzione', inattivo: 'Inattivo' }[a.stato] || a.stato;
    const statoColor = { attivo: 'var(--stato-ok)', manutenzione: 'var(--stato-man)', inattivo: 'var(--stato-inattivo)' }[a.stato] || '';
    const campi = [
      ['Codice', a.codice], ['Tipo', a.tipo], ['Stato', `<span style="color:${statoColor};font-weight:600">${statoLabel}</span>`],
      ['Indirizzo', a.indirizzo], ['Città', a.citta + (a.provincia ? ' (' + a.provincia + ')' : '')],
      ['CAP', a.cap], ['Superficie', a.superficie_mq ? a.superficie_mq.toLocaleString('it-IT') + ' mq' : '–'],
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

    // Tab Monitoraggio
    let monHtml = '';
    if (a.tipo === 'stabilimento') {
      monHtml = `<div class="mm-kpi-grid">
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.linee_produzione_attive ?? '–'}/${m.linee_produzione_totali ?? '–'}</div><div class="mm-kpi-lbl">Linee produzione attive</div></div>
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.personale_attivo ?? '–'}/${m.capacita_personale ?? '–'}</div><div class="mm-kpi-lbl">Personale attivo</div></div>
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.media_produzione_giornaliera_pz ?? '–'}</div><div class="mm-kpi-lbl">Pz/giorno</div></div>
      </div>`;
    } else if (a.tipo === 'ufficio') {
      monHtml = `<div class="mm-kpi-grid">
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.dipendenti_presenti ?? '–'}/${m.capienza_massima ?? '–'}</div><div class="mm-kpi-lbl">Occupancy</div></div>
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.sale_riunioni_occupate ?? '–'}/${m.sale_riunioni_totali ?? '–'}</div><div class="mm-kpi-lbl">Sale riunioni</div></div>
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.aggiornato_il ? m.aggiornato_il.split(' ')[1] : '–'}</div><div class="mm-kpi-lbl">Ultimo aggiornamento</div></div>
      </div>`;
    } else if (a.tipo === 'magazzino') {
      monHtml = `<div class="mm-kpi-grid">
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.saturazione_stoccaggio_pct ?? '–'}%</div><div class="mm-kpi-lbl">Saturazione stoccaggio</div></div>
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.mezzi_magazzino_presenti ?? '–'}/${m.mezzi_magazzino_totali ?? '–'}</div><div class="mm-kpi-lbl">Mezzi operativi</div></div>
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.operatori_presenti ?? '–'}</div><div class="mm-kpi-lbl">Operatori presenti</div></div>
      </div>`;
    } else if (a.tipo === 'deposito') {
      monHtml = `<div class="mm-kpi-grid">
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.mezzi_disponibili ?? '–'}/${m.mezzi_totali ?? '–'}</div><div class="mm-kpi-lbl">Mezzi disponibili</div></div>
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.mezzi_in_missione ?? '–'}</div><div class="mm-kpi-lbl">In missione</div></div>
        <div class="mm-kpi-card"><div class="mm-kpi-val">${m.mezzi_in_manutenzione ?? '–'}</div><div class="mm-kpi-lbl">In manutenzione</div></div>
      </div>`;
    } else {
      monHtml = '<p style="color:var(--text-secondary);font-size:13px">Nessun dato di monitoraggio disponibile.</p>';
    }
    monHtml += `<p style="font-size:11px;color:var(--text-secondary);margin-top:8px">Aggiornato il: ${m.aggiornato_il || '–'}</p>`;
    document.getElementById('mm-panel-monitoraggio').innerHTML = monHtml;

    // Tab ESG
    let esgHtml = '';
    if (esg && esg.co2_totale_kg_giorno) {
      const ratingColor = { A:'#27AE60', B:'#4CAF50', C:'#F39C12', D:'#E74C3C', E:'#c0392b' };
      const col = ratingColor[esg.rating_esg] || 'var(--text-secondary)';
      const pctKwh = esg.benchmark_kwh > 0 ? Math.min(Math.round((esg.consumo_kwh_giorno / esg.benchmark_kwh) * 100), 150) : 0;
      const pctM3  = esg.benchmark_m3  > 0 ? Math.min(Math.round((esg.consumo_m3_acqua_giorno / esg.benchmark_m3) * 100), 150) : 0;
      esgHtml = `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
          <div style="width:56px;height:56px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff">${esg.rating_esg || '–'}</div>
          <div><div style="font-size:13px;color:var(--text-secondary)">Rating ESG</div><div style="font-size:22px;font-weight:700">${esg.co2_totale_kg_giorno.toFixed(0)} kg CO₂/giorno</div></div>
        </div>
        <div class="mm-esg-bar-wrap">
          <div class="mm-esg-bar-label"><span>Energia elettrica</span><span>${esg.consumo_kwh_giorno?.toFixed(0) ?? '–'} kWh/g (benchmark ${esg.benchmark_kwh ?? '–'})</span></div>
          <div class="mm-esg-bar"><div class="mm-esg-bar-fill" style="width:${Math.min(pctKwh,100)}%;background:${pctKwh > 100 ? '#F39C12' : '#27AE60'}"></div></div>
        </div>
        <div class="mm-esg-bar-wrap">
          <div class="mm-esg-bar-label"><span>Acqua</span><span>${esg.consumo_m3_acqua_giorno?.toFixed(1) ?? '–'} m³/g (benchmark ${esg.benchmark_m3 ?? '–'})</span></div>
          <div class="mm-esg-bar"><div class="mm-esg-bar-fill" style="width:${Math.min(pctM3,100)}%;background:${pctM3 > 100 ? '#F39C12' : '#27AE60'}"></div></div>
        </div>`;
    } else {
      esgHtml = '<p style="color:var(--text-secondary);font-size:13px">Nessun dato ESG disponibile per questo asset.</p>';
    }
    document.getElementById('mm-panel-esg').innerHTML = esgHtml;

    // Tab Allarmi
    let allHtml = '';
    if (allarmi.length === 0) {
      allHtml = '<p style="color:#27AE60;font-size:13px"><i class="fa fa-check-circle"></i> Nessun allarme attivo</p>';
    } else {
      allHtml = allarmi.map(al => {
        const col = al.livello === 'alarm' ? '#E74C3C' : '#F39C12';
        return `<div class="mm-alarm-row">
          <i class="fa fa-exclamation-triangle" style="color:${col}"></i>
          <span style="flex:1">${al.campo.replace(/_/g,' ')}</span>
          <span style="font-weight:600;color:${col}">${al.valore ?? '–'}</span>
          <span style="background:${col}20;color:${col};padding:2px 6px;border-radius:4px;font-size:11px">${al.livello}</span>
        </div>`;
      }).join('');
    }
    document.getElementById('mm-panel-allarmi').innerHTML = allHtml;

    // Tab Work Order
    try {
      const woList = await API.getAssetWorkOrders(id);
      const aperti = woList.filter(w => w.stato !== 'completato' && w.stato !== 'annullato').length;
      if (aperti > 0) {
        document.getElementById('mm-wo-badge').innerHTML = ` <span style="background:#F39C12;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px">${aperti}</span>`;
      }
      const statoColor2 = { aperto:'#3498DB', in_corso:'#F39C12', completato:'#27AE60', annullato:'#95A5A6' };
      const prioColor2  = { bassa:'#95A5A6', media:'#3498DB', alta:'#F39C12', critica:'#E74C3C' };
      let woHtml = '';
      if (woList.length === 0) {
        woHtml = '<p style="color:var(--text-secondary);font-size:13px"><i class="fa fa-check-circle"></i> Nessun work order per questo asset</p>';
      } else {
        woHtml = woList.map(w => `
          <div class="mm-alarm-row" style="cursor:pointer" onclick="window.location.href='/static/workorders.html'">
            <span style="font-size:11px;color:var(--text-secondary);min-width:72px">${w.codice}</span>
            <span style="flex:1;font-size:13px">${w.titolo}</span>
            <span style="font-size:11px;font-weight:600;color:${prioColor2[w.priorita]||''}">${w.priorita.toUpperCase()}</span>
            <span style="background:${statoColor2[w.stato]||''}20;color:${statoColor2[w.stato]||''};padding:2px 6px;border-radius:4px;font-size:11px">${w.stato.replace('_',' ')}</span>
          </div>`).join('');
      }
      document.getElementById('mm-panel-workorders').innerHTML = woHtml;
    } catch(woErr) {
      console.warn('[apriModaleAsset] Impossibile caricare i work order per asset', id, ':', woErr.message);
      document.getElementById('mm-panel-workorders').innerHTML = '<p style="color:var(--text-secondary);font-size:13px"><i class="fa fa-exclamation-circle" style="margin-right:5px"></i>Work order non disponibili</p>';
    }

    // Tab Documenti
    // ── Helper: renderizza la lista documenti nel pannello ──
    const iconMap2 = { 'application/pdf': 'fa-file-pdf-o', 'image/': 'fa-file-image-o', 'application/vnd': 'fa-file-excel-o', 'text/': 'fa-file-text-o' };
    function icona2(mime) { if (!mime) return 'fa-file-o'; for (const [k,v] of Object.entries(iconMap2)) { if (mime.startsWith(k)) return v; } return 'fa-file-o'; }
    function fmtSize(b) { if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; }

    function _renderListaDocumenti(docs) {
      const panel = document.getElementById('mm-panel-documenti');
      if (!panel) return;
      const badge = document.getElementById('mm-doc-badge');
      if (badge) badge.innerHTML = docs.length > 0
        ? ` <span style="background:#3498DB;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px">${docs.length}</span>`
        : '';
      const lista = docs.length === 0
        ? '<p style="color:var(--text-secondary);font-size:13px"><i class="fa fa-folder-open-o"></i> Nessun documento allegato</p>'
        : docs.map(d => `<div class="mm-alarm-row">
            <i class="fa ${icona2(d.tipo_mime)}" style="color:#3498DB;font-size:16px;min-width:20px"></i>
            <span style="flex:1;font-size:13px">${d.nome_file}</span>
            <span style="font-size:11px;color:var(--text-secondary)">${fmtSize(d.dimensione)}</span>
            <a href="${API.getDocumentDownloadUrl(d.id)}" target="_blank" class="btn btn-secondary btn-sm" style="margin-left:8px;padding:2px 8px"><i class="fa fa-download"></i></a>
          </div>`).join('');
      // Pulsante upload + input nascosto + lista
      const canUpload = API.can('documents.upload');
      const uploadBar = canUpload
        ? `<div style="display:flex;justify-content:flex-end;margin-bottom:8px">
            <input type="file" id="mm-doc-file-input" style="display:none" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt">
            <button id="mm-doc-upload-btn" class="btn btn-primary btn-sm" style="padding:4px 12px;font-size:12px">
              <i class="fa fa-upload" style="margin-right:5px"></i>Carica documento
            </button>
          </div>`
        : '';
      panel.innerHTML = uploadBar + lista;
      if (canUpload) {
        const btn = document.getElementById('mm-doc-upload-btn');
        const inp = document.getElementById('mm-doc-file-input');
        btn.addEventListener('click', () => inp.click());
        inp.addEventListener('change', async () => {
          const file = inp.files[0];
          if (!file) return;
          btn.disabled = true;
          btn.innerHTML = '<i class="fa fa-spinner fa-spin" style="margin-right:5px"></i>Caricamento...';
          try {
            await API.uploadDocument(id, file);
            const nuoviDocs = await API.getAssetDocuments(id);
            _renderListaDocumenti(nuoviDocs);
          } catch(e) {
            alert('Errore upload: ' + e.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fa fa-upload" style="margin-right:5px"></i>Carica documento';
          } finally {
            inp.value = '';
          }
        });
      }
    }

    try {
      const docs = await API.getAssetDocuments(id);
      _renderListaDocumenti(docs);
    } catch(docErr) {
      console.warn('[apriModaleAsset] Impossibile caricare i documenti per asset', id, ':', docErr.message);
      document.getElementById('mm-panel-documenti').innerHTML = '<p style="color:var(--text-secondary);font-size:13px"><i class="fa fa-exclamation-circle" style="margin-right:5px"></i>Documenti non disponibili</p>';
    }

    // Tab Scadenze
    try {
      const deadlines = await API.getAssetDeadlines(id);
      const aperte = deadlines.filter(d => d.stato !== 'completata');
      if (aperte.length > 0) {
        const dlBadge = document.getElementById('mm-dl-badge');
        if (dlBadge) dlBadge.innerHTML = ` <span style="background:#e67e22;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px">${aperte.length}</span>`;
      }
      const coloreStato = { 'aperta': 'var(--stato-man)', 'in_corso': '#3498DB', 'completata': 'var(--stato-ok)', 'scaduta': 'var(--stato-inattivo)' };
      const iconaStato  = { 'aperta': 'fa-clock-o', 'in_corso': 'fa-spinner', 'completata': 'fa-check-circle', 'scaduta': 'fa-exclamation-circle' };
      let dlHtml = deadlines.length === 0
        ? '<p style="color:var(--text-secondary);font-size:13px"><i class="fa fa-calendar-check-o"></i> Nessuna scadenza registrata</p>'
        : deadlines.map(d => {
            const oggi = new Date();
            const scad = new Date(d.data_scadenza);
            const giorni = Math.ceil((scad - oggi) / 86400000);
            const statoEff = d.stato !== 'completata' && scad < oggi ? 'scaduta' : d.stato;
            const giorniLabel = d.stato === 'completata' ? '' : giorni < 0 ? `<span style="color:var(--stato-inattivo);font-size:11px">${Math.abs(giorni)}gg scaduta</span>` : `<span style="color:var(--stato-man);font-size:11px">${giorni}gg</span>`;
            return `<div class="mm-alarm-row">
              <i class="fa ${iconaStato[statoEff] || 'fa-calendar'} " style="color:${coloreStato[statoEff] || '#aaa'};font-size:16px;min-width:20px"></i>
              <span style="flex:1;font-size:13px">${d.titolo}</span>
              <span style="font-size:11px;color:var(--text-secondary);margin-right:8px">${d.tipo || ''}</span>
              <span style="font-size:11px;color:var(--text-secondary)">${d.data_scadenza || ''}</span>
              ${giorniLabel}
            </div>`;
          }).join('');
      const dlPanel = document.getElementById('mm-panel-scadenze');
      if (dlPanel) dlPanel.innerHTML = dlHtml;
    } catch(dlErr) {
      console.warn('[apriModaleAsset] Impossibile caricare le scadenze per asset', id, ':', dlErr.message);
      const dlPanel = document.getElementById('mm-panel-scadenze');
      if (dlPanel) dlPanel.innerHTML = '<p style="color:var(--text-secondary);font-size:13px"><i class="fa fa-exclamation-circle" style="margin-right:5px"></i>Scadenze non disponibili</p>';
    }

  } catch(e) {
    console.error('[apriModaleAsset] Errore nel caricamento dell\'asset', id, ':', e.message, e.stack);
    document.getElementById('mm-panel-anagrafica').innerHTML =
      `<div style="text-align:center;padding:20px;color:var(--stato-inattivo)">
         <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
         <div style="font-size:13px">Impossibile caricare i dati dell'asset.</div>
         <div style="font-size:11px;margin-top:4px;color:var(--text-secondary)">${e.message}</div>
       </div>`;
  }
}

/**
 * Chiude la modale dettaglio e resetta lo stato interno.
 *
 * Rimuove la classe 'open' dall'overlay e imposta _assetAperto a null.
 *
 * @function chiudiModaleAsset
 * @returns {void}
 */
function chiudiModaleAsset() {
  document.getElementById('map-modal-overlay').classList.remove('open');
  _assetAperto = null;
  window._assetApertoId = null;
}

