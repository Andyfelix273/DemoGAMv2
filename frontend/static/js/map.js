/**
 * map.js — Logica JavaScript della pagina GIS Asset Manager (mappa)
 *
 * @module map
 * @requires api.js       Autenticazione, fetch helper, gestione token
 * @requires utils.js     Topbar, sidebar, tema, i18n
 * @requires Leaflet       Libreria mappa interattiva
 *
 * Struttura del modulo (sezioni):
 *   CONFIG        Costanti, token, mapping colori/icone
 *   INIT          Inizializzazione mappa e autenticazione
 *   ASSETS        Caricamento GeoJSON, marker, filtri, ricerca
 *   METEO         Widget meteo per asset selezionato
 *   MODALE        Modale dettaglio asset (tab Anagrafica…Documenti)
 *   PLANIMETRIA   Tab Planimetria: viewer SVG IFC per piano
 *   BIM           Tab BIM: scheda informativa modello IFC4
 *   STATS         Pannello laterale: KPI operativi, panoramica, ESG
 *   LIVE          Polling live refresh (30s)
 *
 * Variabili globali principali:
 *   @var {L.Map}    map            Istanza Leaflet
 *   @var {Array}    allMarkers     Lista di tutti i marker sulla mappa
 *   @var {Array}    allFeatures    Lista di tutte le feature GeoJSON
 *   @var {Object}   _assetStati    Mappa assetId → stato operativo
 *   @var {number|null} _assetAperto  ID dell'asset con modale aperta
 */

/* global L, API, renderTopbar, renderSidebar, applicaTema */

// =============================================
// AUTENTICAZIONE
// =============================================
if (!API.isAuthenticated()) {
  window.location.href = '/static/login.html';
}

// =============================================
// NOTIFICHE ALLARMI GLOBALI (polling 30s)
// =============================================
// Registra callback per aggiornare campanella topbar, dot sidebar e toast
API.onAlarmUpdate(({ totale, nuovi }) => {
  // Badge campanella topbar
  const badge = document.getElementById('topbar-alarm-badge');
  if (badge) {
    if (totale > 0) {
      badge.textContent = totale > 99 ? '99+' : totale;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
  // Dot sidebar
  const dot = document.getElementById('sb-alarm-dot');
  if (dot) {
    if (totale > 0) dot.classList.add('visible');
    else dot.classList.remove('visible');
  }
  // Badge nav allarmi (topbar nav)
  const nav = document.getElementById('nav-allarmi');
  if (nav) {
    nav.innerHTML = totale > 0
      ? `Allarmi <span class="alarm-badge">${totale}</span>`
      : 'Allarmi';
  }
  // Toast per nuovi allarmi (max 3)
  nuovi.slice(0, 3).forEach(a => showAlarmToast(a));
});
API.startAlarmPolling(30000);

// =============================================
// TOPBAR: utente, logout, tema, rotte
// =============================================
const nome = API.getNome() || API.getRole() || 'Utente';
const role = API.getRole() || 'user';
document.getElementById('topbar-nome').textContent = nome;
document.getElementById('topbar-badge').textContent = role === 'admin' ? 'admin' : 'user';

document.getElementById('btn-logout').addEventListener('click', () => {
  API.logout();
  window.location.href = '/static/login.html';
});

// Tema (gestito da impostazioni, applica solo la preferenza salvata)
const temaAttuale = localStorage.getItem('gam_tema') || 'dark';
if (temaAttuale === 'light') {
  document.body.classList.add('light');
  const logo = document.getElementById('meta-logo');
  if (logo) logo.src = '/static/img/logolight.png';
}

// =============================================
// MAPPA LEAFLET
// =============================================
const JAWG_TOKEN = 'QHoHKE9mfIrm3sUkmrrM1v95NtcsqYNtMOdLeC91Hb1n1mLrqMzLWKzTkHLON1bD';
const map = L.map('map', {
  center: [42.5, 12.5],
  zoom: 6,
  zoomControl: true,
  attributionControl: true
});
L.tileLayer(`https://tile.jawg.io/jawg-dark/{z}/{x}/{y}.png?access-token=${JAWG_TOKEN}`, {
  attribution: '&copy; <a href="https://jawg.io">Jawg Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 18
}).addTo(map);

// =============================================
// ROTTE MARITTIME
// =============================================
let rotteLayer = null;
let rotteVisibili = false; // verrà impostato dopo lettura config

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
  } catch(e) {}
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

      // Gruppo Scadenze
      if (scadEl) scadEl.innerHTML =
        opKpi('fa-calendar-times',     d.scadenze_7gg,       'Scadenze 7 gg',   'In scadenza nei prossimi 7 gg', scad7Clr,    '/static/deadlines.html') +
        opKpi('fa-clock',              d.scadenze_ritardo,   'In Ritardo',      'Scadenze superate non chiuse',  scadRitClr,  '/static/deadlines.html');

      // Gruppo Asset
      if (assetEl) assetEl.innerHTML =
        opKpi('fa-bell',               d.asset_con_allarmi,  'Con Allarmi',     'Asset con allarmi attivi',      allarmiClr,  '/static/alarms.html') +
        opKpi('fa-tools',              d.asset_manutenzione, 'In Manutenzione', 'Asset con stato manutenzione',  manClr,      '/static/assets.html');
    }
    // Compatibilità: aggiorna anche op-kpi-grid se presente (vecchio layout)
    const opKpiEl = document.getElementById('op-kpi-grid');
    if (opKpiEl && !document.getElementById('op-kpi-wo')) {
      // fallback: non usato nel nuovo layout
    }

  } catch(e) { /* silenzioso */ }
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
// =============================================
function selezionaAsset(feature, marker) {
  // Centra la mappa sull'asset
  map.panTo(marker.getLatLng());
  // Apre la modale dettaglio
  apriModaleAsset(feature.properties.id);
}

// =============================================
// MODALE DETTAGLIO ASSET
// La funzione apriModaleAsset è definita in map-modal.js (modulo centralizzato)
// =============================================

// La funzione apriModaleAsset è definita in map-modal.js (modulo centralizzato)
// chiudiModaleAsset è definita in map-modal.js

// =============================================
// TAB PLANIMETRIA — viewer SVG nella modale
// =============================================
let _mmPlaniData = null;
let _mmPianoCorrente = null;
const MM_STATO_COLOR = { critico:'#E74C3C', warning:'#F39C12', ok:'#27AE60', nessuno:'rgba(123,175,196,0.6)' };
const MM_STATO_LABEL = { critico:'Critico', warning:'Attenzione', ok:'Operativo', nessuno:'' };

// Dati piani IFC reali per Sede Centrale Roma
const MM_IFC_PIANI = [
  { id: 'piano_interrato', label: 'Interrato' },
  { id: 'piano_terra',     label: 'Piano Terra' },
  { id: 'piano_1',         label: '1° Piano' },
  { id: 'piano_2',         label: '2° Piano' },
  { id: 'piano_copertura', label: 'Copertura' },
];

async function mmCaricaPlanimetria(assetId) {
  document.getElementById('mm-panel-planimetria').innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
  if (assetId === MM_IFC_ASSET_ID) {
    // Usa direttamente i piani IFC reali senza chiamare il backend BIM simulato
    _mmPlaniData = { bim: { piani: MM_IFC_PIANI, locali: [] } };
    mmRenderPlanimetriaPanel();
    return;
  }
  try {
    const res = await fetch(`/api/bim/${assetId}`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } });
    if (!res.ok) throw new Error('Dati planimetria non disponibili');
    _mmPlaniData = await res.json();
    mmRenderPlanimetriaPanel();
  } catch(e) {
    document.getElementById('mm-panel-planimetria').innerHTML = `<p style="color:var(--text-secondary);font-size:13px">${e.message}</p>`;
  }
}

// Mappa piano ID → file SVG IFC reale (per asset_id=6, Sede Centrale Roma)
const MM_IFC_SVG_MAP = {
  'piano_interrato':  '/static/ifc/plans/interrato.svg',
  'piano_terra':      '/static/ifc/plans/piano_terra.svg',
  'piano_1':          '/static/ifc/plans/piano_1.svg',
  'piano_2':          '/static/ifc/plans/piano_2.svg',
  'piano_copertura':  '/static/ifc/plans/copertura.svg',
};
const MM_IFC_ASSET_ID = 6; // Sede Centrale Roma

function mmRenderPlanimetriaPanel() {
  if (!_mmPlaniData) return;
  const bim = _mmPlaniData.bim;
  const piani = bim.piani;
  _mmPianoCorrente = piani[0].id;
  const hasIFC = (_assetAperto === MM_IFC_ASSET_ID);

  const pianiHtml = piani.map((p, i) =>
    `<button class="mm-piano-btn ${i===0?'active':''}" data-piano="${p.id}" onclick="mmSelezionaPiano('${p.id}', this)">${p.label}</button>`
  ).join('');

  const legendaHtml = hasIFC ? `
    <div class="mm-plani-legend">
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:#7ab0d0"></div> Pareti</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:#40b0e0"></div> Finestre</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:#e8a030"></div> Porte</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:#2a5070"></div> Scale</div>
      <div class="mm-plani-legend-item" style="margin-left:12px;color:var(--text-secondary);font-size:10px"><i class="fa fa-file-code" style="margin-right:4px"></i>Estratto da modello IFC4</div>
    </div>` : `
    <div class="mm-plani-legend">
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:rgba(231,76,60,0.55);border:1px solid #E74C3C"></div> Critico</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:rgba(243,156,18,0.45);border:1px solid #F39C12"></div> Attenzione</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:rgba(39,174,96,0.35);border:1px solid #27AE60"></div> Operativo</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:rgba(52,152,219,0.30);border:1px solid rgba(52,152,219,0.6)"></div> Area funzionale</div>
    </div>`;

  document.getElementById('mm-panel-planimetria').innerHTML = `
    <div class="mm-plani-wrap">
      <div class="mm-plani-toolbar">
        <span style="font-size:11px;color:var(--text-secondary);margin-right:4px">Piano:</span>
        ${pianiHtml}
      </div>
      <div class="mm-svg-container" id="mm-svg-container">
        ${hasIFC ? '<img id="mm-plani-img" style="width:100%;height:100%;object-fit:contain;border-radius:6px" src="" alt="Planimetria"/>' : '<svg id="mm-plani-svg" viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg"></svg>'}
      </div>
      ${legendaHtml}
    </div>`;
  mmRenderSVG(_mmPianoCorrente);
}

function mmSelezionaPiano(pianoId, btnEl) {
  document.querySelectorAll('.mm-piano-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  _mmPianoCorrente = pianoId;
  mmRenderSVG(pianoId);
}

function mmRenderSVG(pianoId) {
  if (!_mmPlaniData) return;
  // Se asset con IFC reale: mostra SVG estratto dal modello
  const imgEl = document.getElementById('mm-plani-img');
  if (imgEl && MM_IFC_SVG_MAP[pianoId]) {
    imgEl.src = MM_IFC_SVG_MAP[pianoId];
    return;
  }
  const locali = _mmPlaniData.bim.locali.filter(l => l.piano === pianoId);
  const svg = document.getElementById('mm-plani-svg');
  if (!svg) return;
  svg.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  // Sfondo
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x','2'); bg.setAttribute('y','2'); bg.setAttribute('width','96'); bg.setAttribute('height','66');
  bg.setAttribute('rx','1'); bg.setAttribute('fill','rgba(19,35,56,0.6)'); bg.setAttribute('stroke','rgba(255,255,255,0.15)'); bg.setAttribute('stroke-width','0.5');
  svg.appendChild(bg);
  // Griglia
  for (let x=10;x<100;x+=10) { const l=document.createElementNS(NS,'line'); l.setAttribute('x1',x);l.setAttribute('y1','2');l.setAttribute('x2',x);l.setAttribute('y2','68');l.setAttribute('stroke','rgba(255,255,255,0.04)');l.setAttribute('stroke-width','0.3');svg.appendChild(l); }
  for (let y=10;y<70;y+=10) { const l=document.createElementNS(NS,'line'); l.setAttribute('x1','2');l.setAttribute('y1',y);l.setAttribute('x2','98');l.setAttribute('y2',y);l.setAttribute('stroke','rgba(255,255,255,0.04)');l.setAttribute('stroke-width','0.3');svg.appendChild(l); }
  // Locali
  locali.forEach(loc => {
    const g = document.createElementNS(NS,'g'); g.classList.add('mm-bim-room'); g.dataset.id = loc.id;
    const rect = document.createElementNS(NS,'rect');
    rect.setAttribute('x',loc.x); rect.setAttribute('y',loc.y); rect.setAttribute('width',loc.w); rect.setAttribute('height',loc.h);
    rect.setAttribute('rx','0.8'); rect.setAttribute('stroke-width','1');
    if (loc.asset_id) { rect.classList.add(`mm-fill-${loc.stato_operativo||'nessuno'}`); }
    else { rect.classList.add(`mm-fill-tipo-${loc.tipo||'comune'}`); }
    g.appendChild(rect);
    const text = document.createElementNS(NS,'text'); text.classList.add('mm-bim-room-label');
    text.setAttribute('x', loc.x + loc.w/2); text.setAttribute('y', loc.y + loc.h/2 - (loc.h>12?2:0));
    const maxChars = Math.floor(loc.w/1.8);
    text.textContent = loc.nome.length > maxChars ? loc.nome.substring(0,maxChars-1)+'…' : loc.nome;
    g.appendChild(text);
    if (loc.h > 12) {
      const sub = document.createElementNS(NS,'text'); sub.classList.add('mm-bim-room-sublabel');
      sub.setAttribute('x', loc.x+loc.w/2); sub.setAttribute('y', loc.y+loc.h/2+3.5);
      if (loc.asset_id && loc.stato_operativo !== 'ok' && loc.stato_operativo !== 'nessuno') {
        sub.textContent = MM_STATO_LABEL[loc.stato_operativo]||''; sub.setAttribute('fill', MM_STATO_COLOR[loc.stato_operativo]||'rgba(255,255,255,0.55)');
      } else { sub.textContent = `${(loc.mq||0).toLocaleString('it-IT')} m²`; }
      g.appendChild(sub);
    }
    svg.appendChild(g);
  });
}

// =============================================
// TAB BIM — dati IFC reali nella modale
// =============================================
const BIM_IFC_ASSET_ID = 6; // Sede Centrale Roma → modello IFC reale
let _mmBimData = null;

async function mmCaricaBIM(assetId) {
  document.getElementById('mm-panel-bim').innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
  if (assetId !== BIM_IFC_ASSET_ID) {
    document.getElementById('mm-panel-bim').innerHTML = '<p style="color:var(--text-secondary);font-size:13px"><i class="fa fa-info-circle"></i> Modello IFC non disponibile per questo asset. Disponibile per: Sede Centrale Roma.</p>';
    return;
  }
  try {
    const res = await fetch('/static/ifc/office_building_data.json');
    if (!res.ok) throw new Error('Dati IFC non disponibili');
    _mmBimData = await res.json();
    mmRenderBIMPanel();
  } catch(e) {
    document.getElementById('mm-panel-bim').innerHTML = `<p style="color:var(--text-secondary);font-size:13px">${e.message}</p>`;
  }
}

function mmRenderBIMPanel() {
  if (!_mmBimData) return;
  const d = _mmBimData;
  const s = d.statistics;
  // Nomi piani e tipi elementi già in italiano nel JSON tradotto

  const storeyRows = d.storeys.map((st, idx) => {
    const nomeIt = st.long_name;
    const elems = Object.entries(st.element_types).sort((a,b)=>b[1]-a[1]);
    const elemsHtml = elems.map(([t,n]) => {
      return `<div class="mm-bim-elem-row"><span class="mm-bim-elem-name">${t}</span><div class="mm-bim-elem-bar-wrap"><div class="mm-bim-elem-bar" style="width:${Math.round(n/st.element_count*100)}%"></div></div><span class="mm-bim-elem-count">${n}</span></div>`;
    }).join('');
    const spacesHtml = st.spaces.map(sp => {
      const area = sp.area ? ` <span style="color:var(--text-secondary);font-size:10px">${sp.area} m²</span>` : '';
      return `<div class="mm-bim-space-row"><i class="fa fa-square" style="color:var(--accent);font-size:8px;margin-right:5px"></i><span>${sp.long_name || sp.name}</span>${area}</div>`;
    }).join('');
    return `<div class="mm-bim-storey-block">
      <div class="mm-bim-storey-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="mm-bim-storey-left">
          <i class="fa fa-layer-group" style="color:var(--accent);margin-right:8px"></i>
          <span class="mm-bim-storey-name">${nomeIt}</span>
          <span class="mm-bim-storey-counts">${st.spaces.length} spazi · ${st.element_count} elementi</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mm-bim-storey-badge">${st.elevation >= 0 ? '+' : ''}${st.elevation}m</span>
          <i class="fa fa-chevron-down mm-bim-chevron"></i>
        </div>
      </div>
      <div class="mm-bim-storey-body">
        <div class="mm-bim-storey-cols">
          <div class="mm-bim-storey-col">
            <div class="mm-bim-col-title">Locali (${st.spaces.length})</div>
            <div class="mm-bim-spaces-list">${spacesHtml}</div>
          </div>
          <div class="mm-bim-storey-col">
            <div class="mm-bim-col-title">Elementi costruttivi</div>
            <div class="mm-bim-elems-list">${elemsHtml}</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Distribuzione globale elementi
  const allTypes = {};
  d.storeys.forEach(st => Object.entries(st.element_types).forEach(([t,n]) => { allTypes[t] = (allTypes[t]||0)+n; }));
  const topTypes = Object.entries(allTypes).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const totalEl = Object.values(allTypes).reduce((a,b)=>a+b,0);
  const globalElemsHtml = topTypes.map(([t,n]) => {
    return `<div class="mm-bim-elem-row"><span class="mm-bim-elem-name">${t}</span><div class="mm-bim-elem-bar-wrap"><div class="mm-bim-elem-bar" style="width:${Math.round(n/totalEl*100)}%"></div></div><span class="mm-bim-elem-count">${n}</span></div>`;
  }).join('');

  document.getElementById('mm-panel-bim').innerHTML = `
    <div class="mm-bim-wrap">
      <div class="mm-bim-header">
        <div style="flex:1">
          <div class="mm-bim-title"><i class="fa fa-cube" style="color:var(--accent);margin-right:8px"></i>Modello BIM — ${d.building.name}</div>
          <div class="mm-bim-subtitle">Schema ${d.project.schema} · ${d.statistics.total_storeys} piani · ${d.statistics.total_spaces} spazi · ${d.statistics.total_elements} elementi</div>
        </div>
        <div class="mm-bim-schema-badge">${d.project.schema}</div>
      </div>
      <div class="mm-bim-two-col">
        <div>
          <div class="mm-bim-section-title">Riepilogo strutturale</div>
          <div class="mm-bim-stats-grid">
            <div class="mm-bim-stat-card"><div class="mm-bim-stat-val">${s.walls}</div><div class="mm-bim-stat-lbl">Pareti</div></div>
            <div class="mm-bim-stat-card"><div class="mm-bim-stat-val">${s.doors}</div><div class="mm-bim-stat-lbl">Porte</div></div>
            <div class="mm-bim-stat-card"><div class="mm-bim-stat-val">${s.windows}</div><div class="mm-bim-stat-lbl">Finestre</div></div>
            <div class="mm-bim-stat-card"><div class="mm-bim-stat-val">${s.stairs}</div><div class="mm-bim-stat-lbl">Scale</div></div>
          </div>
        </div>
        <div>
          <div class="mm-bim-section-title">Distribuzione elementi</div>
          <div class="mm-bim-elems-list">${globalElemsHtml}</div>
        </div>
      </div>
      <div>
        <div class="mm-bim-section-title">Struttura per piano <span style="font-size:11px;color:var(--text-secondary);font-weight:400">(clicca per espandere)</span></div>
        <div class="mm-bim-storeys">${storeyRows}</div>
      </div>
      <div style="padding:12px;background:var(--bg-card);border-radius:8px;border:1px solid var(--border);font-size:12px;color:var(--text-secondary)">
        <i class="fa fa-info-circle" style="color:var(--accent);margin-right:6px"></i>
        Modello IFC4 generato con ArchiCAD 20 — Edificio uffici di riferimento associato alla Sede Centrale Roma.
        I dati strutturali sono estratti direttamente dal file IFC tramite ifcopenshell.
      </div>
    </div>`;
}

// =============================================
// TORNA ALLA PANORAMICA (non più usata per il pannello, mantenuta per compatibilità)
// =============================================
function tornaOverview() {
  chiudiModaleAsset();
}

// =============================================
// RENDER DETTAGLIO ASSET
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
  const BIM_ASSET_IDS = [1, 2, 6, 7];
  if (BIM_ASSET_IDS.includes(a.id)) {
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
      if (woEl) woEl.textContent = 'Dati non disponibili';
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
      if (scEl) scEl.textContent = 'Dati non disponibili';
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
          <div class="kpi-group-header">Work Order</div>
          <div class="op-kpi-grid" id="op-kpi-wo">
            <div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:11px;grid-column:span 3;"><i class="fas fa-spinner fa-spin"></i></div>
          </div>
        </div>
        <div class="kpi-group group-scad">
          <div class="kpi-group-header">Scadenze</div>
          <div class="op-kpi-grid" id="op-kpi-scad">
            <div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:11px;grid-column:span 2;"><i class="fas fa-spinner fa-spin"></i></div>
          </div>
        </div>
        <div class="kpi-group group-asset">
          <div class="kpi-group-header">Asset</div>
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
      // ESG non critico, ignora silenziosamente
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
    panel.innerHTML = '<div style="color:var(--stato-inattivo);padding:16px;font-size:12px;">Errore nel caricamento della panoramica.</div>';
  }
}

// =============================================
// =============================================
// POLLING LIVE (ogni 60s)
// =============================================
// Aggiorna la panoramica operativa e, se un asset è aperto, ricarica il suo dettaglio.
// I marker non vengono ricaricati (sono statici), solo i dati cambiano.
let _assetAperto = null; // id dell'asset attualmente aperto nel pannello dettaglio

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
  setInterval(_aggiornaLive, 60000); // ogni 60 secondi
}, 5000); // prima esecuzione dopo 5s dall'avvio

// ── Tab switching modale ─────────────────────────────────────
document.querySelectorAll('.map-modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.map-modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.map-modal-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('mm-panel-' + tab.dataset.mmpanel).classList.add('active');
  });
});

// ── Chiusura modale ──────────────────────────────────────────
document.getElementById('mm-close').addEventListener('click', chiudiModaleAsset);
document.getElementById('mm-btn-chiudi').addEventListener('click', chiudiModaleAsset);
document.getElementById('map-modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('map-modal-overlay')) chiudiModaleAsset();
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
  renderSidebar('mappa', 'gam', 'map-sidebar');