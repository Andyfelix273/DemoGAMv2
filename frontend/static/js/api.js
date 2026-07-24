/**
 * GIS Asset Manager - API Client
 * Versione: 2.1 | Autore: Felix / KeyBiz
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

  // ── Gestione permessi RBAC ──────────────────────────────────
  function getPermissions() {
    try { return JSON.parse(localStorage.getItem('gam_permissions') || '[]'); }
    catch (_) { return []; }
  }
  function setPermissions(perms) {
    localStorage.setItem('gam_permissions', JSON.stringify(perms || []));
  }

  /**
   * Verifica se l'utente corrente ha il permesso specificato.
   * Uso: if (API.can('assets.create')) { ... }
   * @param {string} permesso - es. 'assets.create', 'alarms.acknowledge'
   * @returns {boolean}
   */
  function can(permesso) {
    return getPermissions().includes(permesso);
  }

  function clearAuth() {
    localStorage.removeItem('gam_token');
    localStorage.removeItem('gam_role');
    localStorage.removeItem('gam_nome');
    localStorage.removeItem('gam_permissions');
  }

  function isAdmin()          { return getRole() === 'admin' || getRole() === 'superadmin'; }
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
    setPermissions(data.permissions || []);
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

  // ── Work Order ──────────────────────────────────────────────
  async function getWorkOrders()           { return request('GET', '/api/work-orders'); }
  async function getWorkOrder(id)          { return request('GET', `/api/work-orders/${id}`); }
  async function getWorkOrderStats()       { return request('GET', '/api/work-orders/stats'); }
  async function createWorkOrder(data)     { return request('POST', '/api/work-orders', data); }
  async function updateWorkOrder(id, data) { return request('PUT', `/api/work-orders/${id}`, data); }
  async function deleteWorkOrder(id)       { return request('DELETE', `/api/work-orders/${id}`); }
  async function getAssetWorkOrders(assetId) { return request('GET', `/api/assets/${assetId}/work-orders`); }

  // -- Documenti
  async function getAssetDocuments(assetId)   { return request('GET', `/api/assets/${assetId}/documents`); }
  async function deleteDocument(docId)         { return request('DELETE', `/api/documents/${docId}`); }
  function getDocumentDownloadUrl(docId) {
    const token = getToken();
    return `/api/documents/${docId}/download?token=${token}`;
  }
  async function uploadDocument(assetId, file) {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', `/api/assets/${assetId}/documents`, fd, true);
  }

  // -- Scadenze
  async function getDeadlines(params)       { const q = params ? '?' + new URLSearchParams(params).toString() : ''; return request('GET', '/api/deadlines' + q); }
  async function getDeadlineStats()         { return request('GET', '/api/deadlines/stats'); }
  async function getDeadline(id)            { return request('GET', `/api/deadlines/${id}`); }
  async function createDeadline(data)       { return request('POST', '/api/deadlines', data); }
  async function updateDeadline(id, data)   { return request('PUT', `/api/deadlines/${id}`, data); }
  async function deleteDeadline(id)         { return request('DELETE', `/api/deadlines/${id}`); }

  // ── Polling allarmi globale ─────────────────────────────────
  // Stato interno: IDs degli allarmi già noti (per rilevare i nuovi)
  let _alarmKnownIds = null;  // null = primo caricamento
  let _alarmPollingTimer = null;
  let _alarmCallbacks = [];   // callback registrate dalle pagine

  /**
   * Registra una callback chiamata ad ogni aggiornamento allarmi.
   * La callback riceve { totale, nuovi, allarmi } dove:
   *   totale  = numero allarmi attivi non ack
   *   nuovi   = array di allarmi comparsi dall'ultimo poll
   *   allarmi = array completo allarmi attivi
   */
  function onAlarmUpdate(cb) {
    _alarmCallbacks.push(cb);
  }

  async function _pollAlarms() {
    try {
      const lista = await getAlarms();
      const attivi = lista.filter(a => !a.acknowledged);
      const attiviIds = new Set(attivi.map(a => a.id));

      let nuovi = [];
      if (_alarmKnownIds !== null) {
        // Rileva allarmi comparsi dall'ultimo poll
        nuovi = attivi.filter(a => !_alarmKnownIds.has(a.id));
      }
      _alarmKnownIds = attiviIds;

      const payload = { totale: attivi.length, nuovi, allarmi: attivi };
      _alarmCallbacks.forEach(cb => { try { cb(payload); } catch(_) {} });
    } catch (_) {}
  }

  /**
   * Avvia il polling allarmi globale.
   * Va chiamato una volta sola dopo il login, su ogni pagina.
   * @param {number} intervalloMs - default 30000 (30 secondi)
   */
  function startAlarmPolling(intervalloMs) {
    if (_alarmPollingTimer) return; // già avviato
    intervalloMs = intervalloMs || 30000;
    // Prima chiamata immediata
    _pollAlarms();
    _alarmPollingTimer = setInterval(_pollAlarms, intervalloMs);
  }

  function stopAlarmPolling() {
    if (_alarmPollingTimer) { clearInterval(_alarmPollingTimer); _alarmPollingTimer = null; }
  }

  // ── Esposizione pubblica ─────────────────────────────────────
  return {
    login, logout, me,
    isAuthenticated, isAdmin, getToken, getRole, getNome,
    can, getPermissions,
    getAssets, getAssetsGeoJSON, getAsset, createAsset, updateAsset, deleteAsset, importExcel,
    getStats, getStatsEsg,
    getThresholds, updateThreshold,
    getAlarms, ackAlarm,
    getConfig, updateConfig,
    getWorkOrders, getWorkOrder, getWorkOrderStats, createWorkOrder, updateWorkOrder, deleteWorkOrder, getAssetWorkOrders,
    getAssetDocuments, uploadDocument, deleteDocument, getDocumentDownloadUrl,
    getDeadlines, getDeadlineStats, getDeadline, createDeadline, updateDeadline, deleteDeadline,
    startAlarmPolling, stopAlarmPolling, onAlarmUpdate
  };

})();
