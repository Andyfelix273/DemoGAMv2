/**
 * map-core.js — Nucleo funzionale della mappa GIS Asset Manager
 *
 * @module map-core
 * @requires map-config.js  Costanti globali (JAWG_TOKEN, map, COLORI_STATO…)
 * @requires api.js         Autenticazione, fetch helper
 *
 * Funzioni principali:
 *   caricaRotte()           Carica e visualizza le rotte marittime GeoJSON
 *   creaIcona(tipo, sel, id) Crea un L.divIcon colorato per stato operativo
 *   caricaHUD()             Carica KPI operativi e aggiorna colori marker
 *   caricaMeteo(id, lat, lon) Widget meteo live (Open-Meteo, no API key)
 *   aggiornaLegenda(features) Aggiorna la legenda mappa con conteggi per tipo
 *   caricaAssets()          Carica GeoJSON asset, crea marker, gestisce deep link
 *   gestisciRicerca()       Filtra asset per nome/città/codice nella search box
 */
/* global L, API, map, JAWG_TOKEN, ICONE_TIPO, COLORE_MARKER, COLORE_SELECTED,
          COLORI_STATO, _assetStati, BIM_ASSET_IDS_MODAL, apriModaleAsset,
          selezionaAsset, i18n */
// =============================================
// ROTTE MARITTIME
// =============================================
let rotteLayer = null;
let rotteVisibili = false; // verrà impostato dopo lettura config

/**
 * Carica e visualizza le rotte marittime GeoJSON sulla mappa.
 *
 * Legge la preferenza di visibilità dal backend (API.getConfig) con fallback
 * al localStorage. In caso di errore di rete, la funzione fallisce silenziosamente.
 *
 * @async
 * @function caricaRotte
 * @returns {Promise<void>}
 */
async function caricaRotte() {
  try {
    // Legge la preferenza dal backend (fonte di verità) e sincronizza localStorage
    try {
      const cfg = await API.getConfig();
      if (cfg.rotte_marittime !== undefined && cfg.rotte_marittime !== null) {
        rotteVisibili = (cfg.rotte_marittime === 'true' || cfg.rotte_marittime === true);
        localStorage.setItem('gam_rotte', String(rotteVisibili));
      } else {
        // Fallback al localStorage se il backend non risponde
        rotteVisibili = (localStorage.getItem('gam_rotte') !== 'false');
      }
    } catch(_) {
      rotteVisibili = (localStorage.getItem('gam_rotte') !== 'false');
    }
    const r = await fetch('/static/data/med_routes.geojson');
    const gj = await r.json();
    rotteLayer = L.geoJSON(gj, {
      style: { color: '#00A3E0', weight: 1, opacity: 0.35, dashArray: '4 6' }
    });
    if (rotteVisibili) rotteLayer.addTo(map);
  } catch(e) {
    console.warn('[caricaRotte] Impossibile caricare le rotte marittime:', e.message);
  }
}
caricaRotte();

// =============================================
// ICONE E COLORI MARKER (monocromatici v1)
// =============================================
const ICONE_TIPO = {
  'stabilimento': 'fa-industry',
  'ufficio':      'fa-building',
  'magazzino':    'fa-archive',
  'deposito':     'fa-truck',
};
const COLORE_MARKER   = '#7BAFC4';
const COLORE_SELECTED = '#F39C12';

// Colori stato operativo marker
// Basati esclusivamente su WO + allarmi (non sullo stato anagrafico)
const COLORI_STATO = {
  critico:  '#E74C3C',  // WO critico aperto o allarme alarm
  warning:  '#F39C12',  // WO alta priorità, allarme warning o scadenza entro 7 gg
  ok:       '#27AE60',  // Nessun evento critico aperto
  inattivo: '#95A5A6',  // Asset dismesso (assets.stato = 'inattivo')
};

// Mappa stato operativo per asset_id (aggiornata da caricaHUD)
let _assetStati = {};

/**
 * Crea un'icona Leaflet personalizzata per un marker asset.
 *
 * Il colore dell'icona riflette lo stato operativo dell'asset (critico, warning,
 * ok, inattivo) oppure il colore predefinito se i dati non sono ancora stati
 * caricati. Gli asset in stato critico ottengono un'animazione pulse.
 *
 * @function creaIcona
 * @param {string}  tipo     - Tipo asset ('stabilimento'|'ufficio'|'magazzino'|'deposito')
 * @param {boolean} selected - Se true, applica il colore di selezione
 * @param {number}  [assetId] - ID asset per recuperare lo stato operativo da _assetStati
 * @returns {L.DivIcon} Icona Leaflet pronta per essere assegnata a un marker
 */
function creaIcona(tipo, selected, assetId) {
  const fa = ICONE_TIPO[tipo] || 'fa-map-pin';
  let c;
  if (selected) {
    c = COLORE_SELECTED;
  } else {
    const stato = assetId !== undefined ? _assetStati[assetId] : null;
    // COLORE_MARKER (azzurro) = solo pre-caricamento dati; dopo caricaHUD ogni asset ha uno stato esplicito
    c = stato ? (COLORI_STATO[stato] || COLORI_STATO.ok) : COLORE_MARKER;
  }
  const sc = selected ? ' selected' : '';
  // Marker più grande per stati critici/warning
  const size = (!selected && _assetStati[assetId] === 'critico') ? 30 : 26;
  const pulse = (!selected && _assetStati[assetId] === 'critico')
    ? ` box-shadow:0 0 0 4px rgba(231,76,60,0.3),0 0 0 8px rgba(231,76,60,0.1);animation:pulse-red 1.5s ease-in-out infinite;`
    : '';
  return L.divIcon({
    className: '',
    html: `<div class="custom-marker${sc}" style="color:${c};border-color:${c};width:${size}px;height:${size}px;${pulse}">
             <i class="fas ${fa}" style="color:${c};"></i>
           </div>`,
    iconSize:   [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor:[0, -15]
  });
}

// =============================================
// HUD OPERATIVA
// =============================================
/**
 * Carica i KPI operativi dal backend e aggiorna marker e pannello laterale.
 *
 * Chiama /api/stats/operational, aggiorna la mappa _assetStati e ricolora
 * tutti i marker non selezionati. Aggiorna anche i tre gruppi KPI nel pannello
 * laterale (Work Order, Scadenze, Asset).
 *
 * @async
 * @function caricaHUD
 * @returns {Promise<void>}
 */
async function caricaHUD() {
  try {
    const res = await fetch('/api/stats/operational', {
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) return;
    const d = await res.json();

    // Aggiorna _assetStati e ricolora i marker
    _assetStati = {};
    if (d.asset_stati) {
      Object.entries(d.asset_stati).forEach(([id, stato]) => {
        _assetStati[parseInt(id)] = stato;
      });
    }
    // Ricolora tutti i marker (eccetto quello selezionato)
    allMarkers.forEach(({ marker, feature }) => {
      if (marker !== selectedMkr) {
        marker.setIcon(creaIcona(feature.properties.tipo, false, feature.properties.id));
      }
    });

    // Aggiorna KPI operativi nel pannello laterale (3 gruppi)
    const woEl   = document.getElementById('op-kpi-wo');
    const scadEl = document.getElementById('op-kpi-scad');
    const assetEl= document.getElementById('op-kpi-asset');
    if (woEl || scadEl || assetEl) {
      const woUrgClass  = d.wo_urgenti > 0 ? '#E74C3C' : '#27AE60';
      const woApertiClr = d.wo_aperti > 3 ? '#E67E22' : (d.wo_aperti > 0 ? 'var(--accent)' : '#27AE60');
      const scad7Clr    = d.scadenze_7gg > 0 ? '#E67E22' : '#27AE60';
      const scadRitClr  = d.scadenze_ritardo > 0 ? '#E74C3C' : '#27AE60';
      const allarmiClr  = d.asset_con_allarmi > 0 ? '#E74C3C' : '#27AE60';
      const manClr      = d.asset_manutenzione > 0 ? '#E67E22' : '#27AE60';
      const compClr     = d.wo_completati_mese > 0 ? '#27AE60' : 'var(--text-secondary)';

      function opKpi(icon, val, label, desc, clr, href) {
        return `<a href="${href||'#'}" class="op-kpi-card" style="text-decoration:none;" ${href?'':'onclick="return false"'}>
          <div class="op-kpi-val" style="color:${clr};">${val}</div>
          <div class="op-kpi-label">${label}</div>
          <div class="op-kpi-desc">${desc}</div>
        </a>`;
      }

      // Gruppo Work Order
      if (woEl) woEl.innerHTML =
        opKpi('fa-exclamation-circle', d.wo_urgenti,         'WO Urgenti',      'Priorità critica/alta aperti',  woUrgClass,  '/static/workorders.html') +
        opKpi('fa-wrench',             d.wo_aperti,          'WO Aperti',       'Work order non completati',     woApertiClr, '/static/workorders.html') +
        opKpi('fa-check-circle',       d.wo_completati_mese, 'Completati/mese', 'WO chiusi nel mese corrente',   compClr,     '/static/workorders.html');

      const scadTotClr  = d.scadenze_totali_aperte > 0 ? 'var(--accent)' : 'var(--text-secondary)';
      const inattClr    = d.asset_inattivi > 0 ? 'var(--text-secondary)' : '#27AE60';

      // Gruppo Scadenze
      if (scadEl) scadEl.innerHTML =
        opKpi('fa-calendar-times',     d.scadenze_7gg,            'Scad. 7 gg',      'In scadenza nei prossimi 7 gg', scad7Clr,    '/static/deadlines.html') +
        opKpi('fa-clock',              d.scadenze_ritardo,        'In Ritardo',      'Scadenze superate non chiuse',  scadRitClr,  '/static/deadlines.html') +
        opKpi('fa-list-alt',           d.scadenze_totali_aperte ?? '-', 'Tot. Aperte', 'Scadenze non ancora chiuse',  scadTotClr,  '/static/deadlines.html');

      // Gruppo Asset
      if (assetEl) assetEl.innerHTML =
        opKpi('fa-bell',               d.asset_con_allarmi,       'Con Allarmi',     'Asset con allarmi attivi',      allarmiClr,  '/static/alarms.html') +
        opKpi('fa-tools',              d.asset_manutenzione,      'In Manutenzione', 'Asset con stato manutenzione',  manClr,      '/static/assets.html') +
        opKpi('fa-power-off',          d.asset_inattivi ?? '-',   'Inattivi',        'Asset con stato inattivo',      inattClr,    '/static/assets.html');
    }
    // Compatibilità: aggiorna anche op-kpi-grid se presente (vecchio layout)
    const opKpiEl = document.getElementById('op-kpi-grid');
    if (opKpiEl && !document.getElementById('op-kpi-wo')) {
      // fallback: non usato nel nuovo layout
    }

  } catch(e) {
    console.warn('[caricaHUD] Impossibile aggiornare i KPI operativi:', e.message);
  }
}

// =============================================
// STATO
// =============================================
let allMarkers  = [];
let selectedMkr = null;
let filtroAttivo = 'tutti';
let allFeatures  = [];

// =============================================
// METEO LIVE (Open-Meteo, no API key)
// =============================================
// Mappa codici WMO weather interpretation codes → emoji + descrizione
const WMO_CODES = {
  0:  { icon: '☀️', desc: 'Sereno' },
  1:  { icon: '🌤️', desc: 'Prevalentemente sereno' },
  2:  { icon: '⛅', desc: 'Parzialmente nuvoloso' },
  3:  { icon: '☁️', desc: 'Coperto' },
  45: { icon: '🌫️', desc: 'Nebbia' },
  48: { icon: '🌫️', desc: 'Nebbia gelata' },
  51: { icon: '🌧️', desc: 'Pioggerella leggera' },
  53: { icon: '🌧️', desc: 'Pioggerella moderata' },
  55: { icon: '🌧️', desc: 'Pioggerella intensa' },
  61: { icon: '🌧️', desc: 'Pioggia leggera' },
  63: { icon: '🌧️', desc: 'Pioggia moderata' },
  65: { icon: '🌧️', desc: 'Pioggia intensa' },
  71: { icon: '🌨️', desc: 'Neve leggera' },
  73: { icon: '🌨️', desc: 'Neve moderata' },
  75: { icon: '❄️', desc: 'Neve intensa' },
  80: { icon: '🌦️', desc: 'Rovesci leggeri' },
  81: { icon: '🌦️', desc: 'Rovesci moderati' },
  82: { icon: '⛈️', desc: 'Rovesci violenti' },
  95: { icon: '⚡', desc: 'Temporale' },
  99: { icon: '⚡', desc: 'Temporale con grandine' },
};

/**
 * Carica e visualizza il widget meteo live per un asset.
 *
 * Usa l'API Open-Meteo (gratuita, senza API key) per ottenere temperatura,
 * condizioni meteo, vento, umidità e precipitazioni correnti.
 * In caso di errore mostra un messaggio inline nel widget.
 *
 * @async
 * @function caricaMeteo
 * @param {number} assetId - ID asset (usato per trovare l'elemento DOM del widget)
 * @param {number} lat     - Latitudine dell'asset
 * @param {number} lon     - Longitudine dell'asset
 * @returns {Promise<void>}
 */
async function caricaMeteo(assetId, lat, lon) {
  const loadEl = document.getElementById(`meteo-loading-${assetId}`);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m,precipitation&timezone=auto&forecast_days=1`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const cw   = data.current_weather || {};
    const wmo  = WMO_CODES[cw.weathercode] || { icon: '🌡️', desc: 'N/D' };

    // Umidità e precipitazioni dall'ora corrente
    const now  = new Date();
    const hIdx = now.getHours(); // indice approssimativo nell'array orario
    const umid = data.hourly && data.hourly.relativehumidity_2m ? data.hourly.relativehumidity_2m[hIdx] : null;
    const prec = data.hourly && data.hourly.precipitation ? data.hourly.precipitation[hIdx] : null;

    const widgetHtml = `
      <div class="meteo-widget">
        <div class="meteo-icon">${wmo.icon}</div>
        <div class="meteo-main">
          <div class="meteo-temp">${cw.temperature !== undefined ? cw.temperature + '°C' : 'N/D'}</div>
          <div class="meteo-desc">${wmo.desc}</div>
        </div>
        <div class="meteo-details">
          <span><i class="fas fa-wind" style="margin-right:3px;"></i>${cw.windspeed !== undefined ? cw.windspeed + ' ' + i18n.t('meteo.kmh') : 'N/D'}</span>
          ${umid !== null ? `<span><i class="fas fa-tint" style="margin-right:3px;"></i>${umid}%</span>` : ''}
          ${prec !== null ? `<span><i class="fas fa-cloud-rain" style="margin-right:3px;"></i>${prec} ${i18n.t('meteo.mm')}</span>` : ''}
        </div>
      </div>`;

    if (loadEl) loadEl.outerHTML = widgetHtml;
  } catch(err) {
    if (loadEl) loadEl.innerHTML = `<i class="fas fa-exclamation-circle" style="color:var(--stato-man);margin-right:5px;"></i>${i18n.t('meteo.errore')}`;
  }
}

// =============================================
// LEGENDA
// =============================================
/**
 * Aggiorna la legenda mappa con i conteggi per tipo di asset.
 *
 * Conta gli asset per tipo (stabilimento, ufficio, magazzino, deposito)
 * e aggiorna il contenuto dell'elemento #map-legend-content.
 * Se l'elemento non esiste (legenda rimossa), la funzione è no-op.
 *
 * @function aggiornaLegenda
 * @param {GeoJSON.Feature[]} features - Array di feature GeoJSON degli asset
 * @returns {void}
 */
function aggiornaLegenda(features) {
  const cnt = {};
  features.forEach(f => { const t = f.properties.tipo; cnt[t] = (cnt[t]||0)+1; });
  const voci = [
    { tipo:'stabilimento', label:'Stabilimento', fa:'fa-industry'  },
    { tipo:'ufficio',      label:'Ufficio',       fa:'fa-building'  },
    { tipo:'magazzino',    label:'Magazzino',     fa:'fa-archive' },
    { tipo:'deposito',     label:'Deposito',      fa:'fa-truck'     },
  ];
  const tipoLabels = {
    stabilimento: i18n.t('tipo.stabilimento'),
    ufficio:      i18n.t('tipo.ufficio'),
    magazzino:    i18n.t('tipo.magazzino'),
    deposito:     i18n.t('tipo.deposito')
  };
  const legendEl = document.getElementById('map-legend-content');
  if (!legendEl) return; // legenda tipologia rimossa, skip
  legendEl.innerHTML =
    `<div class="legend-title">${i18n.t('mappa.tipologia')}</div>` +
    voci.map(v => `<div class="legend-item">
      <i class="fas ${v.fa}" style="width:14px;text-align:center;color:${COLORE_MARKER};font-size:11px;"></i>
      <span style="flex:1;">${tipoLabels[v.tipo] || v.label}</span>
      <span style="font-size:10px;font-weight:700;color:var(--accent);">${cnt[v.tipo]||0}</span>
    </div>`).join('');
}

// =============================================
// CARICAMENTO ASSET
// =============================================
/**
 * Carica il GeoJSON degli asset dal backend e popola la mappa con i marker.
 *
 * Gestisce anche il deep link (?asset_id=N) per aprire direttamente la modale
 * di un asset specifico al caricamento della pagina. In caso di errore mostra
 * un messaggio nell'overlay di caricamento.
 *
 * @async
 * @function caricaAssets
 * @returns {Promise<void>}
 */
async function caricaAssets() {
  try {
    // Chiamata diretta con geojson=true per ottenere FeatureCollection
  const res = await fetch('/api/assets?geojson=true', { headers: { 'Authorization': 'Bearer ' + API.getToken() } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const geojson = await res.json();
    allFeatures = geojson.features;
    aggiornaLegenda(allFeatures);
    allFeatures.forEach(feature => {
      const [lon, lat] = feature.geometry.coordinates;
      const props = feature.properties;
      const marker = L.marker([lat, lon], { icon: creaIcona(props.tipo, false, props.id) }).addTo(map);
      marker.on('click', () => selezionaAsset(feature, marker));
      allMarkers.push({ marker, feature });
    });
    document.getElementById('loading-overlay').classList.add('hidden');

    // ── Deep link: ?asset_id=N ────────────────────────────────────
    const urlParams = new URLSearchParams(window.location.search);
    const deepAssetId = urlParams.get('asset_id');
    if (deepAssetId) {
      const found = allMarkers.find(m => String(m.feature.properties.id) === String(deepAssetId));
      if (found) {
        const [lon, lat] = found.feature.geometry.coordinates;
        map.setView([lat, lon], 14, { animate: true });
        selezionaAsset(found.feature, found.marker);
      }
    }

    // Ricerca
    document.getElementById('search-input').addEventListener('input', gestisciRicerca);
    document.getElementById('search-input').addEventListener('blur', () => {
      setTimeout(() => document.getElementById('search-results').classList.remove('visible'), 200);
    });
  } catch(e) {
    console.error('[caricaAssets] errore:', e.message, e.stack);
    document.getElementById('loading-overlay').innerHTML =
      `<div style="color:var(--stato-inattivo);font-size:13px;text-align:center;padding:20px;">
         <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
         Errore nel caricamento degli asset
       </div>`;
  }
}

// =============================================
// FILTRI TIPO
// =============================================
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filtroAttivo = btn.dataset.tipo;
    allMarkers.forEach(({ marker, feature }) => {
      const mostra = filtroAttivo === 'tutti' || feature.properties.tipo === filtroAttivo;
      if (mostra) { if (!map.hasLayer(marker)) map.addLayer(marker); }
      else         { if (map.hasLayer(marker))  map.removeLayer(marker); }
    });
  });
});

// =============================================
// RICERCA
// =============================================
/**
 * Filtra gli asset in base al testo inserito nella search box.
 *
 * Esegue una ricerca case-insensitive su nome, città e codice asset.
 * Mostra al massimo 8 risultati nel dropdown #search-results.
 * Al click su un risultato, centra la mappa sull'asset e apre la modale.
 *
 * @function gestisciRicerca
 * @returns {void}
 */
function gestisciRicerca() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const box = document.getElementById('search-results');
  if (!q) { box.classList.remove('visible'); return; }
  const risultati = allFeatures.filter(f =>
    f.properties.nome.toLowerCase().includes(q) ||
    (f.properties.citta||'').toLowerCase().includes(q) ||
    (f.properties.codice||'').toLowerCase().includes(q)
  ).slice(0, 8);
  if (!risultati.length) { box.classList.remove('visible'); return; }
  box.innerHTML = risultati.map(f => `
    <div class="search-result-item" data-id="${f.properties.id}">
      <div>${f.properties.nome}</div>
      <div class="search-result-sub">${f.properties.citta||''} · ${f.properties.tipo}</div>
    </div>`).join('');
  box.classList.add('visible');
  box.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.id);
      const found = allMarkers.find(m => m.feature.properties.id === id);
      if (found) {
        map.setView(found.marker.getLatLng(), 12, { animate: true });
        selezionaAsset(found.feature, found.marker);
      }
      box.classList.remove('visible');
      document.getElementById('search-input').value = '';
    });
  });
}

// =============================================
// SELEZIONE ASSET: apre la modale dettaglio
