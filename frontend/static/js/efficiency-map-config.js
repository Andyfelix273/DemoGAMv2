/**
 * efficiency-map-config.js — Costanti globali e configurazione del dimostratore Asset Efficiency
 *
 * @module efficiency-map-config
 * @requires api.js   Autenticazione, fetch helper, gestione token
 * @requires Leaflet  Libreria mappa interattiva
 *
 * Esporta (globali):
 *   JAWG_TOKEN        Token Jawg Maps per i tile layer
 *   map               Istanza L.Map Leaflet
 *   ICONE_TIPO        Mappa tipo asset → classe Font Awesome
 *   COLORE_MARKER     Colore predefinito marker (pre-caricamento dati)
 *   COLORE_SELECTED   Colore marker selezionato
 *   COLORI_EFFICIENZA Mappa livello efficienza → colore hex
 *   _assetEfficienze  Mappa assetId → livello efficienza (aggiornata da caricaHUD)
 */
/* global L, API, GAM_CONFIG */

// =============================================
// AUTENTICAZIONE
// =============================================
if (!API.isAuthenticated()) {
  window.location.href = '/static/login.html';
}

// =============================================
// NOTIFICHE ALLARMI ENERGETICI (polling 30s)
// =============================================
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
  // Toast per nuovi allarmi (max 3)
  if (typeof nuovi !== 'undefined') nuovi.slice(0, 3).forEach(a => {
    if (typeof showAlarmToast === 'function') showAlarmToast(a);
  });
});
API.startAlarmPolling(30000);

// =============================================
// TOPBAR: utente, logout, tema
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
const JAWG_TOKEN = GAM_CONFIG.JAWG_TOKEN;
const map = L.map('map', {
  center: [42.5, 12.5],
  zoom: 6,
  zoomControl: true,
  attributionControl: true
});
L.tileLayer(`https://tile.jawg.io/jawg-dark/{z}/{x}/{y}.png?access-token=${JAWG_TOKEN}`, {
  attribution: '&copy; <a href="https://jawg.io">Jawg Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 18,
  errorTileUrl: ''
}).addTo(map);
// Fallback OpenStreetMap se Jawg non risponde
map.on('tileerror', function() {
  if (!map._osmFallback) {
    map._osmFallback = true;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);
  }
});
