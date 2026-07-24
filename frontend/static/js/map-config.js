/**
 * map-config.js — Costanti globali e configurazione del GIS Asset Manager
 *
 * @module map-config
 * @requires api.js   Autenticazione, fetch helper, gestione token
 * @requires Leaflet  Libreria mappa interattiva
 *
 * Esporta (globali):
 *   JAWG_TOKEN        Token Jawg Maps per i tile layer
 *   map               Istanza L.Map Leaflet
 *   ICONE_TIPO        Mappa tipo asset → classe Font Awesome
 *   COLORE_MARKER     Colore predefinito marker (pre-caricamento dati)
 *   COLORE_SELECTED   Colore marker selezionato
 *   COLORI_STATO      Mappa stato operativo → colore hex
 *   _assetStati       Mappa assetId → stato operativo (aggiornata da caricaHUD)
 */
/* global L, API, renderTopbar, renderSidebar, applicaTema, GAM_CONFIG */

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
// Token Jawg Maps letto dalla configurazione centralizzata (config.js)
const JAWG_TOKEN = GAM_CONFIG.JAWG_TOKEN;
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

