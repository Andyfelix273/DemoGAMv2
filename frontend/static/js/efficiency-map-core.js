/**
 * efficiency-map-core.js — Nucleo funzionale della mappa Asset Efficiency
 *
 * @module efficiency-map-core
 * @requires efficiency-map-config.js  Costanti globali
 * @requires api.js                    Autenticazione, fetch helper
 *
 * Funzioni principali:
 *   creaIcona(tipo, sel, assetId)  Crea un L.divIcon colorato per efficienza energetica
 *   caricaHUD()                    Carica KPI energetici e aggiorna colori marker
 *   caricaAssets()                 Carica GeoJSON asset, crea marker, gestisce deep link
 *   gestisciRicerca()              Filtra asset per nome/città/codice nella search box
 */
/* global L, API, map, JAWG_TOKEN, apriModaleAsset, selezionaAsset, i18n */

// =============================================
// ICONE E COLORI MARKER
// =============================================
const ICONE_TIPO = {
  'stabilimento': 'fa-industry',
  'ufficio':      'fa-building',
  'magazzino':    'fa-archive',
  'deposito':     'fa-truck',
};
const COLORE_MARKER   = '#7BAFC4'; // colore pre-caricamento dati
const COLORE_SELECTED = '#F39C12'; // colore marker selezionato

// Colori efficienza energetica marker
// Basati su efficiency_score dall'endpoint /api/energy/heatmap
const COLORI_EFFICIENZA = {
  alta:    '#27AE60',  // kWh/m² basso — efficiente
  media:   '#F39C12',  // kWh/m² nella media
  bassa:   '#E74C3C',  // kWh/m² alto — inefficiente
  nd:      '#95A5A6',  // nessun dato disponibile
};

// Colori stato asset — stessi valori di .stato-attivo/.stato-manutenzione/.stato-inattivo in bems-ui.css
const COLORI_STATO = {
  attivo:       null,           // usa colore efficienza energetica (comportamento normale)
  manutenzione: '#F39C12',      // arancione — var(--accent-orange)
  inattivo:     '#6E7681',      // grigio   — var(--text-muted)
};

// Mappa assetId → stato asset (popolata da caricaAssets)
let _assetStati = {};

// Mappa assetId → livello efficienza (aggiornata da caricaHUD)
let _assetEfficienze = {};

/**
 * Crea un'icona Leaflet personalizzata per un marker asset.
 * Priorità colore: selected > stato (manutenzione/inattivo) > efficienza energetica.
 * Replica la stessa logica cromatica di assets.html (.stato-attivo/manutenzione/inattivo).
 */
function creaIcona(tipo, selected, assetId) {
  const fa = ICONE_TIPO[tipo] || 'fa-map-pin';
  let c;
  if (selected) {
    c = COLORE_SELECTED;
  } else {
    const stato = assetId !== undefined ? _assetStati[assetId] : null;
    const coloreStato = stato ? COLORI_STATO[stato] : null;
    if (coloreStato) {
      // Asset in manutenzione o inattivo: usa colore stato, ignora efficienza
      c = coloreStato;
    } else {
      // Asset attivo: usa colore efficienza energetica
      const eff = assetId !== undefined ? _assetEfficienze[assetId] : null;
      c = eff ? (COLORI_EFFICIENZA[eff] || COLORI_EFFICIENZA.nd) : COLORE_MARKER;
    }
  }
  const sc = selected ? ' selected' : '';
  // Pulse solo per asset attivi con efficienza bassa
  const statoAsset = assetId !== undefined ? _assetStati[assetId] : null;
  const isAttivo = !statoAsset || statoAsset === 'attivo';
  const size = (isAttivo && !selected && _assetEfficienze[assetId] === 'bassa') ? 30 : 26;
  const pulse = (isAttivo && !selected && _assetEfficienze[assetId] === 'bassa')
    ? ` box-shadow:0 0 0 4px rgba(231,76,60,0.3),0 0 0 8px rgba(231,76,60,0.1);animation:pulse-red 1.5s ease-in-out infinite;`
    : '';
  // Opacità ridotta per asset inattivi
  const opacity = (statoAsset === 'inattivo') ? 'opacity:0.5;' : '';
  return L.divIcon({
    className: '',
    html: `<div class="custom-marker${sc}" style="color:${c};border-color:${c};width:${size}px;height:${size}px;${pulse}${opacity}">
             <i class="fas ${fa}" style="color:${c};"></i>
           </div>`,
    iconSize:   [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor:[0, -15]
  });
}

// =============================================
// HUD ENERGETICA
// =============================================
/**
 * Carica i KPI energetici dal backend e aggiorna i colori dei marker.
 * Chiama /api/energy/heatmap per ottenere efficiency_score e colore per asset.
 */
async function caricaHUD() {
  try {
    const res = await fetch('/api/energy/heatmap', {
      headers: { 'Authorization': 'Bearer ' + API.getToken() }
    });
    if (!res.ok) return;
    const items = await res.json();

    // Aggiorna _assetEfficienze e ricolora i marker
    _assetEfficienze = {};
    items.forEach(item => {
      // color dall'API: '#27AE60'=alta, '#F39C12'=media, '#E74C3C'=bassa
      const colorMap = {
        '#27AE60': 'alta',
        '#F39C12': 'media',
        '#E74C3C': 'bassa',
      };
      const eff = colorMap[item.color] || 'nd';
      _assetEfficienze[item.asset_id] = eff;
    });

    // Ricolora tutti i marker (eccetto quello selezionato)
    allMarkers.forEach(({ marker, feature }) => {
      if (marker !== selectedMkr) {
        marker.setIcon(creaIcona(feature.properties.tipo, false, feature.properties.id));
      }
    });

    // Aggiorna KPI nel pannello laterale se presenti
    const kpiEl = document.getElementById('eff-kpi-summary');
    if (kpiEl) {
      const alta  = items.filter(i => i.color === '#27AE60').length;
      const media = items.filter(i => i.color === '#F39C12').length;
      const bassa = items.filter(i => i.color === '#E74C3C').length;
      kpiEl.innerHTML = `
        <div class="op-kpi-card" style="text-decoration:none;">
          <div class="op-kpi-val" style="color:#27AE60;">${alta}</div>
          <div class="op-kpi-label">Alta efficienza</div>
          <div class="op-kpi-desc">kWh/m² nella norma</div>
        </div>
        <div class="op-kpi-card" style="text-decoration:none;">
          <div class="op-kpi-val" style="color:#F39C12;">${media}</div>
          <div class="op-kpi-label">Media efficienza</div>
          <div class="op-kpi-desc">Sopra la media</div>
        </div>
        <div class="op-kpi-card" style="text-decoration:none;">
          <div class="op-kpi-val" style="color:#E74C3C;">${bassa}</div>
          <div class="op-kpi-label">Bassa efficienza</div>
          <div class="op-kpi-desc">Anomalie rilevate</div>
        </div>`;
    }
  } catch(e) {
    console.warn('[caricaHUD] Impossibile aggiornare i KPI energetici:', e.message);
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
    const now  = new Date();
    const hIdx = now.getHours();
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
          <span><i class="fas fa-wind" style="margin-right:3px;"></i>${cw.windspeed !== undefined ? cw.windspeed + ' km/h' : 'N/D'}</span>
          ${umid !== null ? `<span><i class="fas fa-tint" style="margin-right:3px;"></i>${umid}%</span>` : ''}
          ${prec !== null ? `<span><i class="fas fa-cloud-rain" style="margin-right:3px;"></i>${prec} mm</span>` : ''}
        </div>
      </div>`;
    if (loadEl) loadEl.outerHTML = widgetHtml;
  } catch(err) {
    if (loadEl) loadEl.innerHTML = `<i class="fas fa-exclamation-circle" style="color:var(--stato-man);margin-right:5px;"></i>Meteo non disponibile`;
  }
}

// =============================================
// LEGENDA
// =============================================
function aggiornaLegenda(features) {
  const cnt = {};
  features.forEach(f => { const t = f.properties.tipo; cnt[t] = (cnt[t]||0)+1; });
  const legendEl = document.getElementById('map-legend-content');
  if (!legendEl) return;
  const voci = [
    { tipo:'stabilimento', label:'Stabilimento', fa:'fa-industry'  },
    { tipo:'ufficio',      label:'Ufficio',       fa:'fa-building'  },
    { tipo:'magazzino',    label:'Magazzino',     fa:'fa-archive'   },
    { tipo:'deposito',     label:'Deposito',      fa:'fa-truck'     },
  ];
  legendEl.innerHTML =
    `<div class="legend-title">Tipologia</div>` +
    voci.map(v => `<div class="legend-item">
      <i class="fas ${v.fa}" style="width:14px;text-align:center;color:${COLORE_MARKER};font-size:11px;"></i>
      <span style="flex:1;">${v.label}</span>
      <span style="font-size:10px;font-weight:700;color:var(--accent);">${cnt[v.tipo]||0}</span>
    </div>`).join('');
}

// =============================================
// CARICAMENTO ASSET
// =============================================
async function caricaAssets() {
  try {
    const res = await fetch('/api/assets?geojson=true', { headers: { 'Authorization': 'Bearer ' + API.getToken() } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const geojson = await res.json();
    allFeatures = geojson.features;
    aggiornaLegenda(allFeatures);
    // Popola _assetStati prima di creare i marker
    allFeatures.forEach(f => { _assetStati[f.properties.id] = f.properties.stato || 'attivo'; });
    allFeatures.forEach(feature => {
      const [lon, lat] = feature.geometry.coordinates;
      const props = feature.properties;
      const marker = L.marker([lat, lon], { icon: creaIcona(props.tipo, false, props.id) }).addTo(map);
      marker.on('click', () => selezionaAsset(feature, marker));
      allMarkers.push({ marker, feature });
    });
    document.getElementById('loading-overlay').classList.add('hidden');

    // Deep link: ?asset_id=N
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
