/**
 * GIS Asset Manager - API Client
 * Versione: 2.0 | Autore: Felix / KeyBiz
 *
 * Centralizza tutte le chiamate al backend FastAPI.
 * Gestisce automaticamente il token JWT e il redirect al login in caso di 401.
 */

const API = (() => {

  const BASE = '';  // stesso dominio, path relativo

  // ── Gestione token ──────────────────────────────────────────
  function getToken()         { return localStorage.getItem('gam_token'); }
  function setToken(t)        { localStorage.setItem('gam_token', t); }
  function getRole()          { return localStorage.getItem('gam_role'); }
  function setRole(r)         { localStorage.setItem('gam_role', r); }
  function getNome()          { return localStorage.getItem('gam_nome'); }
  function setNome(n)         { localStorage.setItem('gam_nome', n); }
  function clearAuth() {
    localStorage.removeItem('gam_token');
    localStorage.removeItem('gam_role');
    localStorage.removeItem('gam_nome');
  }

  function isAdmin()          { return getRole() === 'admin'; }
  function isAuthenticated()  { return !!getToken(); }

  // ── Fetch con auth ──────────────────────────────────────────
  async function request(method, path, body = null, isForm = false) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };

    if (body && !isForm) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body && isForm) {
      // FormData o URLSearchParams passati direttamente
      opts.body = body;
    }

    const res = await fetch(BASE + path, opts);

    if (res.status === 401) {
      clearAuth();
      window.location.href = '/static/login.html';
      return;
    }

    if (!res.ok) {
      let msg = `Errore ${res.status}`;
      try {
        const err = await res.json();
        msg = err.detail || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    // Risposta vuota (204)
    if (res.status === 204) return null;

    return res.json();
  }

  // ── Auth ────────────────────────────────────────────────────
  async function login(username, password) {
    const form = new URLSearchParams();
    form.append('username', username);
    form.append('password', password);
    const data = await request('POST', '/auth/login', form, true);
    setToken(data.access_token);
    setRole(data.role);
    setNome(data.nome_completo || username);
    return data;
  }

  function logout() {
    clearAuth();
    window.location.href = '/static/login.html';
  }

  async function me() {
    return request('GET', '/auth/me');
  }

  // ── Asset ───────────────────────────────────────────────────
  async function getAssets(params)  { return request('GET', '/api/assets' + (params ? '?' + new URLSearchParams(params) : '')); }
  async function getAssetsGeoJSON() { return request('GET', '/api/assets?geojson=true'); }
  async function getAsset(id)      { return request('GET', `/api/assets/${id}`); }
  async function createAsset(data) { return request('POST', '/api/assets', data); }
  async function updateAsset(id, data) { return request('PUT', `/api/assets/${id}`, data); }
  async function deleteAsset(id)   { return request('DELETE', `/api/assets/${id}`); }

  async function importExcel(file) {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', '/api/assets/import', fd, true);
  }

  // ── Statistiche ─────────────────────────────────────────────
  async function getStats()        { return request('GET', '/api/stats'); }
  async function getStatsEsg()     { return request('GET', '/api/stats/esg'); }

  // ── Soglie ──────────────────────────────────────────────────
  async function getThresholds()             { return request('GET', '/api/thresholds'); }
  async function updateThreshold(id, data)   { return request('PUT', `/api/thresholds/${id}`, data); }

  // ── Allarmi ─────────────────────────────────────────────────
  async function getAlarms()       { return request('GET', '/api/alarms'); }
  async function ackAlarm(id)      { return request('POST', `/api/alarms/${id}/ack`); }

  // ── Configurazione ───────────────────────────────────────────
  async function getConfig()       { return request('GET', '/api/config'); }
  async function updateConfig(data){ return request('PUT', '/api/config', data); }

  // ── Esposizione pubblica ─────────────────────────────────────
  return {
    login, logout, me,
    isAuthenticated, isAdmin, getToken, getRole, getNome,
    getAssets, getAssetsGeoJSON, getAsset, createAsset, updateAsset, deleteAsset, importExcel,
    getStats, getStatsEsg,
    getThresholds, updateThreshold,
    getAlarms, ackAlarm,
    getConfig, updateConfig
  };

})();
