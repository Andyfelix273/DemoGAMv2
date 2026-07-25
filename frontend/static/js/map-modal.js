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
    const [d, referenti] = await Promise.all([
      API.getAsset(id),
      fetch('/api/assets/' + id + '/referenti', { headers: { 'Authorization': 'Bearer ' + API.getToken() } })
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    ]);
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
      ['Coordinate', a.lat.toFixed(5) + ', ' + a.lon.toFixed(5)],
      ['Note', a.note || '–', true]
    ];

    // ── Sezione Referenti ────────────────────────────────────────────────────
    const canEdit = API.can('assets.update');
    const refHtml = _renderReferenti(referenti, id, canEdit);

    document.getElementById('mm-panel-anagrafica').innerHTML =
      `<div class="mm-detail-grid">${
        campi.map(([lbl, val, full]) =>
          `<div class="mm-detail-row${full ? ' full' : ''}">
            <span class="mm-detail-label">${lbl}</span>
            <span class="mm-detail-value">${val || '–'}</span>
          </div>`
        ).join('')
      }</div>
      <div class="mm-referenti-section">
        <div class="mm-section-header">
          <i class="fas fa-users" style="margin-right:6px;color:var(--accent);"></i>Referenti
          ${canEdit ? `<button class="mm-btn-add-ref" onclick="_apriModaleNuovoReferente(${id})" title="Aggiungi referente"><i class="fas fa-plus"></i></button>` : ''}
        </div>
        ${refHtml}
      </div>`;

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

    // Tab Efficienza energetica
    let esgHtml = '';
    if (esg && esg.co2_totale_kg_giorno) {
      const ratingColor = { A:'#27AE60', B:'#4CAF50', C:'#F39C12', D:'#E74C3C', E:'#c0392b' };
      const col = ratingColor[esg.rating_esg] || 'var(--text-secondary)';
      const pctKwh = esg.benchmark_kwh > 0 ? Math.min(Math.round((esg.consumo_kwh_giorno / esg.benchmark_kwh) * 100), 150) : 0;
      const pctM3  = esg.benchmark_m3  > 0 ? Math.min(Math.round((esg.consumo_m3_acqua_giorno / esg.benchmark_m3) * 100), 150) : 0;
      esgHtml = `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
          <div style="width:56px;height:56px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff">${esg.rating_esg || '–'}</div>
          <div><div style="font-size:13px;color:var(--text-secondary)">Rating energetico</div><div style="font-size:22px;font-weight:700">${esg.co2_totale_kg_giorno.toFixed(0)} kg CO₂/giorno</div></div>
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
      esgHtml = '<p style="color:var(--text-secondary);font-size:13px">Nessun dato di efficienza energetica disponibile per questo asset.</p>';
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
        : docs.map(d => {
            const isPdf = (d.tipo_mime === 'application/pdf') || d.nome_file.toLowerCase().endsWith('.pdf');
            const viewBtn = isPdf
              ? `<button onclick="_mmApriViewerPdf(${d.id}, '${d.nome_file.replace(/'/g, "\\'")}')"
                   style="margin-left:4px;padding:2px 8px;background:transparent;
                          border:1px solid var(--border,#1E3A5F);border-radius:4px;
                          color:var(--text-secondary,#7BAFC4);cursor:pointer;font-size:12px;
                          display:inline-flex;align-items:center;gap:4px;"
                   title="Visualizza PDF">
                   <i class="fa fa-eye"></i>
                 </button>`
              : '';
            return `<div class="mm-alarm-row">
              <i class="fa ${icona2(d.tipo_mime)}" style="color:#3498DB;font-size:16px;min-width:20px"></i>
              <span style="font-size:10px;color:var(--text-secondary);font-family:monospace;min-width:100px;flex-shrink:0">${d.codice || '—'}</span>
              <span style="flex:1;font-size:13px;margin-left:8px">${d.nome_file}</span>
              <span style="font-size:11px;color:var(--text-secondary)">${fmtSize(d.dimensione)}</span>
              ${viewBtn}
              <a href="${API.getDocumentDownloadUrl(d.id)}" target="_blank" class="btn btn-secondary btn-sm" style="margin-left:4px;padding:2px 8px" title="Scarica">
                <i class="fa fa-download"></i>
              </a>
            </div>`;
          }).join('');
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
            const giorniLabel = d.stato === 'completata' ? '' : giorni < 0
              ? `<span style="color:var(--stato-inattivo);font-size:11px">${Math.abs(giorni)}gg scaduta</span>`
              : `<span style="color:var(--stato-man);font-size:11px">${giorni}gg</span>`;
            return `<div class="mm-alarm-row mm-dl-row" onclick="_mmApriDettaglioScadenza(${d.id})"
              style="cursor:pointer;transition:background 0.15s;"
              onmouseover="this.style.background='rgba(0,180,216,0.07)'"
              onmouseout="this.style.background=''">
              <i class="fa ${iconaStato[statoEff] || 'fa-calendar'} " style="color:${coloreStato[statoEff] || '#aaa'};font-size:16px;min-width:20px"></i>
              <span style="font-size:10px;color:var(--text-secondary);font-family:monospace;min-width:100px;flex-shrink:0">${d.codice || '—'}</span>
              <span style="flex:1;font-size:13px;margin-left:8px">${d.titolo}</span>
              <span style="font-size:11px;color:var(--text-secondary);margin-right:8px">${d.tipo || ''}</span>
              <span style="font-size:11px;color:var(--text-secondary)">${d.data_scadenza ? new Date(d.data_scadenza).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'}) : ''}</span>
              ${giorniLabel}
              <i class="fa fa-chevron-right" style="color:var(--text-secondary);font-size:10px;margin-left:6px;"></i>
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


// =============================================
// VIEWER PDF — funzione helper
// =============================================

/**
 * Apre un viewer PDF inline in una modale sovrapposta.
 * Usa l'elemento <iframe> con l'URL di download del documento.
 * Funziona per qualsiasi PDF servito dall'endpoint /api/documents/{id}/download.
 */
async function _mmApriViewerPdf(docId, nomeFile) {
  // Rimuovi viewer precedente se esiste
  const old = document.getElementById('mm-pdf-viewer-overlay');
  if (old) old.remove();

  const downloadUrl = API.getDocumentDownloadUrl(docId);

  // Costruisci la modale con spinner di caricamento
  const overlay = document.createElement('div');
  overlay.id = 'mm-pdf-viewer-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.82)',
    'z-index:5000', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'padding:20px'
  ].join(';');

  overlay.innerHTML = `
    <div id="mm-pdf-viewer-box" style="width:100%;max-width:900px;height:90vh;display:flex;flex-direction:column;
                background:#0D1B2A;border:1px solid #1E3A5F;
                border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
      <!-- Header viewer -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:12px 18px;border-bottom:1px solid #1E3A5F;flex-shrink:0;background:#0D1B2A;">
        <div style="display:flex;align-items:center;gap:10px;">
          <i class="fa fa-file-pdf-o" style="color:#E74C3C;font-size:16px;"></i>
          <span style="font-size:13px;font-weight:600;color:#E0F0FF;">${nomeFile}</span>
        </div>
        <div style="display:flex;gap:8px;">
          <a id="mm-pdf-dl-link" href="#"
             style="padding:5px 12px;background:rgba(0,180,216,0.15);
                    border:1px solid #00B4D8;border-radius:5px;
                    color:#00B4D8;font-size:12px;text-decoration:none;
                    display:flex;align-items:center;gap:5px;">
            <i class="fa fa-download"></i> Scarica
          </a>
          <button onclick="document.getElementById('mm-pdf-viewer-overlay').remove()"
                  style="padding:5px 12px;background:transparent;border:1px solid #1E3A5F;
                         border-radius:5px;color:#7BAFC4;cursor:pointer;
                         font-size:18px;line-height:1;">&times;</button>
        </div>
      </div>
      <!-- Area contenuto -->
      <div id="mm-pdf-content" style="flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0D1B2A;">
        <div style="text-align:center;color:#7BAFC4;">
          <i class="fa fa-spinner fa-spin" style="font-size:28px;margin-bottom:10px;display:block;"></i>
          <span style="font-size:13px;">Caricamento documento...</span>
        </div>
      </div>
    </div>`;

  // Chiudi cliccando fuori dalla modale
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      const blobUrl = overlay._blobUrl;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      overlay.remove();
    }
  });
  // Chiudi con Escape
  const onKey = (e) => {
    if (e.key === 'Escape') {
      const blobUrl = overlay._blobUrl;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  // Scarica il PDF con il token JWT e crea un Blob URL
  try {
    const token = API.getToken ? API.getToken() : (localStorage.getItem('gam_token') || sessionStorage.getItem('gam_token') || '');
    const resp = await fetch(downloadUrl, {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    overlay._blobUrl = blobUrl;

    // Imposta link download
    const dlLink = document.getElementById('mm-pdf-dl-link');
    if (dlLink) {
      dlLink.href = blobUrl;
      dlLink.download = nomeFile;
    }

    // Sostituisci spinner con iframe
    const contentDiv = document.getElementById('mm-pdf-content');
    if (contentDiv) {
      contentDiv.innerHTML = `<iframe src="${blobUrl}" style="width:100%;height:100%;border:none;"
        title="${nomeFile}"></iframe>`;
    }
  } catch (err) {
    const contentDiv = document.getElementById('mm-pdf-content');
    if (contentDiv) {
      contentDiv.innerHTML = `<div style="text-align:center;color:#E74C3C;padding:30px;">
        <i class="fa fa-exclamation-triangle" style="font-size:28px;margin-bottom:10px;display:block;"></i>
        <div style="font-size:13px;">Impossibile caricare il documento.</div>
        <div style="font-size:11px;margin-top:6px;color:#7BAFC4;">${err.message}</div>
        <a href="${downloadUrl}" target="_blank"
           style="display:inline-block;margin-top:14px;padding:6px 16px;
                  background:rgba(0,180,216,0.15);border:1px solid #00B4D8;
                  border-radius:5px;color:#00B4D8;font-size:12px;text-decoration:none;">
          <i class="fa fa-external-link"></i> Apri in nuova scheda
        </a>
      </div>`;
    }
  }
}


// =============================================
// DETTAGLIO SCADENZA — funzione helper
// =============================================

/**
 * Apre una modale sovrapposta con il dettaglio completo di una scadenza.
 * Carica i dati tramite GET /api/deadlines/{id} e mostra tutti i campi.
 */
async function _mmApriDettaglioScadenza(dlId) {
  // Rimuovi dettaglio precedente se esiste
  const old = document.getElementById('mm-dl-detail-overlay');
  if (old) old.remove();

  // Mostra spinner
  const overlay = document.createElement('div');
  overlay.id = 'mm-dl-detail-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
    'z-index:4500', 'display:flex', 'align-items:center',
    'justify-content:center', 'padding:20px'
  ].join(';');
  overlay.innerHTML = `
    <div style="background:#0D1B2A;border:1px solid #1E3A5F;border-radius:12px;
                padding:30px;min-width:200px;text-align:center;color:#7BAFC4;">
      <i class="fa fa-spinner fa-spin" style="font-size:24px;"></i>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  try {
    const d = await API.getDeadline(dlId);

    const coloreStato = { 'aperta': '#F39C12', 'in_corso': '#3498DB', 'completata': '#2ECC71', 'scaduta': '#E74C3C' };
    const labelStato  = { 'aperta': 'Aperta', 'in_corso': 'In corso', 'completata': 'Completata', 'scaduta': 'Scaduta' };
    const colorePrio  = { 'bassa': '#2ECC71', 'media': '#F39C12', 'alta': '#E74C3C', 'critica': '#C0392B' };
    const labelPrio   = { 'bassa': 'Bassa', 'media': 'Media', 'alta': 'Alta', 'critica': 'Critica' };

    const oggi = new Date();
    const scad = new Date(d.data_scadenza);
    const giorni = Math.ceil((scad - oggi) / 86400000);
    const statoEff = d.stato !== 'completata' && scad < oggi ? 'scaduta' : d.stato;
    const giorniTxt = d.stato === 'completata'
      ? ''
      : giorni < 0
        ? `<span style="color:#E74C3C;font-weight:600;">${Math.abs(giorni)} giorni fa</span>`
        : giorni === 0
          ? `<span style="color:#E74C3C;font-weight:600;">Oggi</span>`
          : `<span style="color:#F39C12;font-weight:600;">tra ${giorni} giorni</span>`;

    const fmtDate = (s) => {
      if (!s) return '—';
      const dt = new Date(s);
      return dt.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' });
    };

    const row = (label, val) => val
      ? `<tr>
          <td style="padding:6px 10px 6px 0;color:#7BAFC4;font-size:12px;white-space:nowrap;vertical-align:top;">${label}</td>
          <td style="padding:6px 0;color:#E0F0FF;font-size:13px;">${val}</td>
        </tr>`
      : '';

    overlay.innerHTML = `
      <div style="width:100%;max-width:560px;background:#0D1B2A;border:1px solid #1E3A5F;
                  border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.6);">

        <!-- Header -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;
                    padding:16px 20px;border-bottom:1px solid #1E3A5F;background:#0a1628;">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="font-size:10px;font-family:monospace;color:#7BAFC4;">${d.codice || ''}</span>
              <span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;
                           background:${coloreStato[statoEff] || '#aaa'}22;
                           color:${coloreStato[statoEff] || '#aaa'};border:1px solid ${coloreStato[statoEff] || '#aaa'}44;">
                ${labelStato[statoEff] || statoEff}
              </span>
              <span style="padding:2px 8px;border-radius:10px;font-size:11px;
                           background:${colorePrio[d.priorita] || '#aaa'}22;
                           color:${colorePrio[d.priorita] || '#aaa'};border:1px solid ${colorePrio[d.priorita] || '#aaa'}44;">
                ${labelPrio[d.priorita] || d.priorita || ''}
              </span>
            </div>
            <div style="font-size:15px;font-weight:700;color:#E0F0FF;">${d.titolo}</div>
          </div>
          <button onclick="document.getElementById('mm-dl-detail-overlay').remove()"
                  style="background:transparent;border:1px solid #1E3A5F;border-radius:5px;
                         color:#7BAFC4;cursor:pointer;font-size:18px;padding:4px 10px;
                         margin-left:12px;flex-shrink:0;">&times;</button>
        </div>

        <!-- Corpo -->
        <div style="padding:16px 20px;">
          <table style="width:100%;border-collapse:collapse;">
            ${row('Tipo', d.tipo)}
            ${row('Scadenza', `${fmtDate(d.data_scadenza)} &nbsp; ${giorniTxt}`)}
            ${row('Assegnatario', d.assegnatario)}
            ${row('Creato da', d.creato_da)}
            ${row('Data creazione', fmtDate(d.created_at))}
            ${d.stato === 'completata' ? row('Data chiusura', fmtDate(d.closed_at)) : ''}
          </table>

          ${d.descrizione ? `
            <div style="margin-top:12px;padding:10px 14px;background:rgba(0,180,216,0.05);
                         border:1px solid #1E3A5F;border-radius:6px;">
              <div style="font-size:11px;color:#7BAFC4;margin-bottom:4px;">Descrizione</div>
              <div style="font-size:13px;color:#E0F0FF;line-height:1.5;">${d.descrizione}</div>
            </div>` : ''}

          ${d.note ? `
            <div style="margin-top:10px;padding:10px 14px;background:rgba(243,156,18,0.05);
                         border:1px solid rgba(243,156,18,0.2);border-radius:6px;">
              <div style="font-size:11px;color:#F39C12;margin-bottom:4px;">Note</div>
              <div style="font-size:13px;color:#E0F0FF;line-height:1.5;">${d.note}</div>
            </div>` : ''}
        </div>

        <!-- Footer -->
        <div style="padding:12px 20px;border-top:1px solid #1E3A5F;display:flex;justify-content:flex-end;">
          <button onclick="document.getElementById('mm-dl-detail-overlay').remove()"
                  style="padding:6px 18px;background:transparent;border:1px solid #1E3A5F;
                         border-radius:6px;color:#7BAFC4;cursor:pointer;font-size:13px;">Chiudi</button>
        </div>
      </div>`;

    // Ri-aggancia chiusura Escape dopo innerHTML
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  } catch (err) {
    overlay.innerHTML = `
      <div style="background:#0D1B2A;border:1px solid #1E3A5F;border-radius:12px;
                  padding:30px;text-align:center;color:#E74C3C;max-width:400px;">
        <i class="fa fa-exclamation-triangle" style="font-size:24px;margin-bottom:10px;display:block;"></i>
        <div style="font-size:13px;">Impossibile caricare il dettaglio scadenza.</div>
        <div style="font-size:11px;margin-top:6px;color:#7BAFC4;">${err.message}</div>
        <button onclick="document.getElementById('mm-dl-detail-overlay').remove()"
                style="margin-top:14px;padding:6px 18px;background:transparent;
                       border:1px solid #1E3A5F;border-radius:6px;color:#7BAFC4;cursor:pointer;">
          Chiudi
        </button>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }
}


// =============================================
// SEZIONE REFERENTI — helper functions
// =============================================

/**
 * Renderizza la griglia dei referenti per la tab Anagrafica.
 * Mostra tutti gli slot (obbligatori e facoltativi), con card compatte.
 */
function _renderReferenti(referenti, assetId, canEdit) {
  if (!referenti || referenti.length === 0) {
    return '<p style="color:var(--text-secondary);font-size:12px;padding:8px 0;">Nessun referente associato.</p>';
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

  // Separa obbligatori e facoltativi
  const obbligatori = referenti.filter(r => r.obbligatorio);
  const facoltativi = referenti.filter(r => !r.obbligatorio);

  function renderCard(r) {
    const icona = iconeRuolo[r.ruolo] || 'fa-user';
    const hasRef = r.referente_id !== null;
    const editBtn = canEdit
      ? `<button class="mm-ref-edit-btn" onclick="_apriModaleEditReferente(${assetId}, '${r.ruolo}', ${r.referente_id || 'null'})" title="${hasRef ? 'Modifica' : 'Assegna'}">
           <i class="fas ${hasRef ? 'fa-pencil-alt' : 'fa-plus-circle'}"></i>
         </button>`
      : '';
    const removeBtn = (canEdit && hasRef)
      ? `<button class="mm-ref-remove-btn" onclick="_rimuoviReferente(${assetId}, '${r.ruolo}')" title="Rimuovi"><i class="fas fa-times"></i></button>`
      : '';

    if (!hasRef) {
      return `
        <div class="mm-ref-card mm-ref-empty">
          <div class="mm-ref-icon"><i class="fas ${icona}"></i></div>
          <div class="mm-ref-body">
            <div class="mm-ref-ruolo">${r.label}</div>
            <div class="mm-ref-nome" style="color:var(--text-secondary);font-style:italic;">Non assegnato</div>
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

  // Obbligatori
  if (obbligatori.length > 0) {
    html += `<div class="mm-ref-group-label">Obbligatori</div>`;
    html += `<div class="mm-ref-grid">${obbligatori.map(renderCard).join('')}</div>`;
  }

  // Facoltativi (solo quelli assegnati + slot vuoti facoltativi)
  const facoltativiAssegnati = facoltativi.filter(r => r.referente_id !== null);
  const facoltativiVuoti     = facoltativi.filter(r => r.referente_id === null);

  if (facoltativiAssegnati.length > 0 || canEdit) {
    html += `<div class="mm-ref-group-label" style="margin-top:10px;">Facoltativi</div>`;
    html += `<div class="mm-ref-grid">`;
    html += facoltativiAssegnati.map(renderCard).join('');
    // Mostra slot vuoti facoltativi solo in modalità edit
    if (canEdit) {
      html += facoltativiVuoti.map(renderCard).join('');
    }
    html += `</div>`;
  }

  return html;
}


/**
 * Apre la modale per assegnare/modificare un referente su un ruolo specifico.
 */
async function _apriModaleEditReferente(assetId, ruolo, referenteIdCorrente) {
  // Carica la lista di tutti i referenti disponibili
  let tutti = [];
  try {
    const res = await fetch('/api/referenti', { headers: { 'Authorization': 'Bearer ' + API.getToken() } });
    tutti = res.ok ? await res.json() : [];
  } catch(e) { tutti = []; }

  const ruoliLabel = {
    responsabile_asset: 'Responsabile asset', responsabile_manutenzione: 'Responsabile manutenzione',
    responsabile_sicurezza: 'Responsabile sicurezza', facility_manager: 'Facility Manager',
    responsabile_it: 'Responsabile IT', responsabile_energia: 'Responsabile energia',
    proprietario: 'Proprietario', locatore: 'Locatore',
    fornitore_manutenzione: 'Fornitore manutenzione', referente_legale: 'Referente legale',
    referente_emergenze: 'Referente emergenze',
  };

  // Crea o riusa la modale referenti
  let m = document.getElementById('mm-ref-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'mm-ref-modal';
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
        <button onclick="document.getElementById('mm-ref-modal').style.display='none'"
                style="background:none;border:none;color:var(--text-secondary);font-size:20px;cursor:pointer;">&times;</button>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:4px;">Seleziona referente dall'elenco</label>
        <select id="mm-ref-select" style="width:100%;padding:8px;background:var(--bg-card,#0A1628);
                border:1px solid var(--border,#1E3A5F);border-radius:6px;color:var(--text-primary,#E0F0FF);font-size:13px;">
          <option value="">— Seleziona —</option>
          ${opzioni}
        </select>
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:4px;">Note (opzionale)</label>
        <input id="mm-ref-note" type="text" placeholder="Note sull'associazione..."
               style="width:100%;padding:8px;background:var(--bg-card,#0A1628);
               border:1px solid var(--border,#1E3A5F);border-radius:6px;color:var(--text-primary,#E0F0FF);font-size:13px;box-sizing:border-box;">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('mm-ref-modal').style.display='none'"
                style="padding:7px 16px;background:var(--bg-card);border:1px solid var(--border);
                       border-radius:6px;color:var(--text-secondary);cursor:pointer;font-size:13px;">Annulla</button>
        <button id="mm-ref-save-btn"
                style="padding:7px 16px;background:var(--accent,#2196F3);border:none;
                       border-radius:6px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Salva</button>
      </div>
      <div id="mm-ref-modal-err" style="margin-top:8px;font-size:12px;color:#E74C3C;display:none;"></div>
    </div>`;

  m.style.display = 'flex';

  document.getElementById('mm-ref-save-btn').onclick = async () => {
    const selId = parseInt(document.getElementById('mm-ref-select').value);
    const nota  = document.getElementById('mm-ref-note').value.trim();
    const errEl = document.getElementById('mm-ref-modal-err');
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
      // Ricarica la sezione referenti
      apriModaleAsset(assetId);
    } catch(e) {
      errEl.textContent = 'Errore: ' + e.message;
      errEl.style.display = 'block';
    }
  };
}


/**
 * Rimuove l'associazione referente-ruolo da un asset.
 */
async function _rimuoviReferente(assetId, ruolo) {
  if (!confirm('Rimuovere il referente per questo ruolo?')) return;
  try {
    const res = await fetch(`/api/assets/${assetId}/referenti/${ruolo}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) throw new Error(await res.text());
    apriModaleAsset(assetId);
  } catch(e) {
    alert('Errore nella rimozione: ' + e.message);
  }
}


/**
 * Apre la modale per creare un nuovo referente (anagrafica) e associarlo.
 */
async function _apriModaleNuovoReferente(assetId) {
  let m = document.getElementById('mm-ref-new-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'mm-ref-new-modal';
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
        <button onclick="document.getElementById('mm-ref-new-modal').style.display='none'"
                style="background:none;border:none;color:var(--text-secondary);font-size:20px;cursor:pointer;">&times;</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Nome *</label>
          <input id="mm-rn-nome" type="text" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary);font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Cognome *</label>
          <input id="mm-rn-cognome" type="text" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary);font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Email</label>
          <input id="mm-rn-email" type="email" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary);font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Telefono</label>
          <input id="mm-rn-tel" type="text" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary);font-size:13px;box-sizing:border-box;">
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:3px;">Ruolo per questo asset *</label>
        <select id="mm-rn-ruolo" style="width:100%;padding:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:5px;color:var(--text-primary);font-size:13px;">
          ${ruoliOpts}
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('mm-ref-new-modal').style.display='none'"
                style="padding:7px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-secondary);cursor:pointer;font-size:13px;">Annulla</button>
        <button id="mm-rn-save"
                style="padding:7px 16px;background:var(--accent,#2196F3);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Crea e associa</button>
      </div>
      <div id="mm-rn-err" style="margin-top:8px;font-size:12px;color:#E74C3C;display:none;"></div>
    </div>`;

  m.style.display = 'flex';

  document.getElementById('mm-rn-save').onclick = async () => {
    const nome    = document.getElementById('mm-rn-nome').value.trim();
    const cognome = document.getElementById('mm-rn-cognome').value.trim();
    const email   = document.getElementById('mm-rn-email').value.trim();
    const tel     = document.getElementById('mm-rn-tel').value.trim();
    const ruolo   = document.getElementById('mm-rn-ruolo').value;
    const errEl   = document.getElementById('mm-rn-err');
    if (!nome || !cognome) { errEl.textContent = 'Nome e cognome sono obbligatori.'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    try {
      // 1. Crea il referente
      const r1 = await fetch('/api/referenti', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, cognome, email: email || null, telefono: tel || null, ruolo_default: ruolo })
      });
      if (!r1.ok) throw new Error(await r1.text());
      const { id: newId } = await r1.json();
      // 2. Associa all'asset
      const r2 = await fetch(`/api/assets/${assetId}/referenti`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API.getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ referente_id: newId, ruolo: ruolo })
      });
      if (!r2.ok) throw new Error(await r2.text());
      m.style.display = 'none';
      apriModaleAsset(assetId);
    } catch(e) {
      errEl.textContent = 'Errore: ' + e.message;
      errEl.style.display = 'block';
    }
  };
}
