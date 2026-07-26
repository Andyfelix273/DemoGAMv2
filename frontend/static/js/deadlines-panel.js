/**
 * deadlines-panel.js — Pannello Scadenze riutilizzabile
 * GIS Asset Manager v2.0 — KeyBiz
 *
 * Espone l'oggetto globale `DeadlinesPanel` con il metodo:
 *
 *   DeadlinesPanel.mount(containerEl, opts)
 *
 * Parametri opts:
 *   assetId   {number|null}  — se presente, filtra le scadenze per quell'asset
 *   assetNome {string|null}  — nome asset per il titolo contestuale
 *   zIndex    {number}       — z-index base per le modali (default 1000; usare 1100 dentro modale asset)
 *   onSave    {function}     — callback opzionale dopo ogni salvataggio/eliminazione
 *   readonly  {boolean}      — se true, nasconde i controlli di creazione/modifica
 */
/* global API */
const DeadlinesPanel = (() => {
  // ── Costanti ─────────────────────────────────────────────────────────────────
  const PRIO_COLOR  = { critica: 'var(--accent-red)', alta: 'var(--accent-orange)', media: 'var(--accent-blue)', bassa: 'var(--text-muted)' };
  const STATO_COLOR = { aperta: 'var(--accent-blue)', chiusa: 'var(--accent-green)', scaduta: 'var(--accent-red)' };
  const TIPO_ICON   = { normativa: 'fa-gavel', manutenzione: 'fa-wrench', collaudo: 'fa-circle-check', contratto: 'fa-file-lines', scadenza: 'fa-clock' };
  const MODAL_FORM_ID = 'dlp-modal-form';

  // ── Stato interno ─────────────────────────────────────────────────────────────
  let _container     = null;
  let _opts          = {};
  let _lista         = [];
  let _listaFiltrata = [];
  let _assetsCache   = [];
  const _uid = 'dlp_' + Math.random().toString(36).slice(2, 7);

  // ── Utility ───────────────────────────────────────────────────────────────────
  function fmtData(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  const STATO_LABEL = { aperta: 'Aperta', chiusa: 'Chiusa', scaduta: 'Scaduta' };
  function badgeStato(stato) {
    return `<span class="badge badge-${stato || 'aperta'}">${STATO_LABEL[stato] || stato}</span>`;
  }
  function badgePrio(prio) {
    return `<span class="prio prio-${prio || 'bassa'}">${(prio || '').toUpperCase()}</span>`;
  }

  // ── Gestione modale ───────────────────────────────────────────────────────────
  function _getModal() { return document.getElementById(MODAL_FORM_ID); }
  function _apriModal() { const el = _getModal(); if (el) el.classList.add('open'); }
  function _chiudiModal() { const el = _getModal(); if (el) el.classList.remove('open'); }

  // ── Iniezione modale nel DOM ──────────────────────────────────────────────────
  function _injectModal(zIndex) {
    if (_getModal()) {
      _getModal().style.zIndex = zIndex;
      return;
    }

    const html = `
    <!-- DeadlinesPanel: modale form crea/modifica -->
    <div class="modal-overlay" id="${MODAL_FORM_ID}" style="z-index:${zIndex}">
      <div class="modal-box" style="max-width:560px">
        <div class="modal-header">
          <h3 id="dlp-form-title">Nuova scadenza</h3>
          <button class="btn-icon" onclick="DeadlinesPanel._chiudi()" title="Chiudi"><i class="fa fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="dlp-f-id">
          <div class="form-group" id="dlp-asset-wrap">
            <label>Asset *</label>
            <select id="dlp-f-asset"></select>
          </div>
          <div class="form-group">
            <label>Titolo *</label>
            <input type="text" id="dlp-f-titolo" placeholder="Titolo scadenza">
          </div>
          <div class="form-group">
            <label>Descrizione</label>
            <textarea id="dlp-f-descrizione" rows="2" placeholder="Descrizione opzionale"></textarea>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label>Tipo</label>
              <select id="dlp-f-tipo">
                <option value="scadenza">Scadenza</option>
                <option value="normativa">Normativa</option>
                <option value="manutenzione">Manutenzione</option>
                <option value="collaudo">Collaudo</option>
                <option value="contratto">Contratto</option>
              </select>
            </div>
            <div class="form-group">
              <label>Priorità</label>
              <select id="dlp-f-priorita">
                <option value="bassa">Bassa</option>
                <option value="media" selected>Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Critica</option>
              </select>
            </div>
            <div class="form-group">
              <label>Data scadenza *</label>
              <input type="date" id="dlp-f-data-scadenza">
            </div>
            <div class="form-group">
              <label>Assegnatario</label>
              <input type="text" id="dlp-f-assegnatario" placeholder="Nome / ente">
            </div>
          </div>
          <div class="form-group" id="dlp-stato-wrap" style="display:none">
            <label>Stato</label>
            <select id="dlp-f-stato">
              <option value="aperta">Aperta</option>
              <option value="chiusa">Chiusa</option>
              <option value="scaduta">Scaduta</option>
            </select>
          </div>
          <div id="dlp-form-error" class="form-error"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="DeadlinesPanel._chiudi()">Annulla</button>
          <button class="btn btn-primary" onclick="DeadlinesPanel._salva()"><i class="fa fa-floppy-disk"></i> Salva</button>
        </div>
      </div>
    </div>`;

    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _chiudiModal();
    });
  }

  // ── Caricamento asset per il select ──────────────────────────────────────────
  async function _caricaAssets() {
    if (_assetsCache.length === 0) {
      const geo = await API.getAssets();
      _assetsCache = (geo.features || []).map(f => f.properties);
    }
    const sel = document.getElementById('dlp-f-asset');
    if (!sel) return;
    sel.innerHTML = _assetsCache.map(a =>
      `<option value="${a.id}">${a.codice} – ${a.nome}</option>`
    ).join('');
  }

  // ── Caricamento dati ──────────────────────────────────────────────────────────
  async function _carica() {
    if (!_container) return;
    _container.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
    try {
      if (_opts.assetId) {
        _lista = await API.getAssetDeadlines(_opts.assetId);
      } else {
        _lista = await API.getDeadlines();
      }
      _listaFiltrata = [..._lista];
      _render();
    } catch (e) {
      _container.innerHTML = `<p class="error-msg"><i class="fa fa-exclamation-circle"></i> Errore caricamento: ${e.message}</p>`;
    }
  }

  // ── Filtro client-side ────────────────────────────────────────────────────────
  function _filtra() {
    const q     = (document.getElementById(_uid + '_q')?.value    || '').toLowerCase();
    const stato = (document.getElementById(_uid + '_stato')?.value || '');
    const prio  = (document.getElementById(_uid + '_prio')?.value  || '');
    const oggi  = new Date(); oggi.setHours(0, 0, 0, 0);
    _listaFiltrata = _lista.filter(d => {
      const statoEffettivo = (d.stato === 'aperta' && new Date(d.data_scadenza) < oggi) ? 'scaduta' : d.stato;
      if (stato && statoEffettivo !== stato) return false;
      if (prio  && d.priorita !== prio)      return false;
      if (q && ![d.titolo, d.assegnatario, d.asset_nome]
        .some(v => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    _renderRighe();
  }

  // ── Render righe tbody ────────────────────────────────────────────────────────
  function _renderRighe() {
    const canEdit   = !_opts.readonly && API.can('deadlines.update');
    const canDelete = !_opts.readonly && API.can('deadlines.delete');
    const tbody = document.getElementById(_uid + '_tbody');
    const count = document.getElementById(_uid + '_count');
    if (!tbody) return;
    const n = _listaFiltrata.length;
    if (count) count.textContent = `${n} scadenz${n === 1 ? 'a' : 'e'}${_opts.assetNome ? ` — ${_opts.assetNome}` : ''}`;
    if (n === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Nessuna scadenza trovata</td></tr>`;
      return;
    }
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    tbody.innerHTML = _listaFiltrata.map(d => {
      const scad = new Date(d.data_scadenza);
      const giorni = Math.ceil((scad - oggi) / 86400000);
      const isScaduta = d.stato === 'scaduta' || (d.stato === 'aperta' && giorni < 0);
      const isUrgente = d.stato === 'aperta' && giorni >= 0 && giorni <= 7;
      const tipoIcon  = TIPO_ICON[d.tipo] || 'fa-clock';
      const prioCol   = PRIO_COLOR[d.priorita] || 'var(--text-muted)';
      let giorniLabel = '';
      if (d.stato !== 'chiusa') {
        giorniLabel = giorni < 0
          ? `<span class="giorni-scaduti">${Math.abs(giorni)}gg scaduta</span>`
          : giorni <= 7
            ? `<span class="giorni-urgenti">${giorni}gg</span>`
            : `<span class="giorni-ok">${giorni}gg</span>`;
      }
      const rowClass = isScaduta ? 'row-scaduto' : isUrgente ? 'row-urgente' : '';
      return `
        <tr class="${rowClass}">
          <td><i class="fa ${tipoIcon} tipo-icon prio-icon-${d.priorita || 'bassa'}" title="${d.tipo || ''}"></i></td>
          <td>
            <div class="cell-main">${d.titolo}</div>
            ${!_opts.assetId ? `<div class="cell-sub">${d.asset_nome || ''}</div>` : ''}
          </td>
          <td>${badgePrio(d.priorita)}</td>
          <td>${badgeStato(isScaduta && d.stato !== 'chiusa' ? 'scaduta' : d.stato)}</td>
          <td class="cell-sm">${fmtData(d.data_scadenza)}</td>
          <td>${giorniLabel}</td>
          <td class="cell-sm">${d.assegnatario || '<span class="text-muted">—</span>'}</td>
          <td>
            <div class="row-actions">
              ${canEdit && d.stato === 'aperta' ? `<button class="btn-icon" title="Segna chiusa" onclick="DeadlinesPanel._chiudiScadenza(${d.id})"><i class="fa fa-circle-check"></i></button>` : ''}
              ${canEdit   ? `<button class="btn-icon" title="Modifica" onclick="DeadlinesPanel._apriModifica(${d.id})"><i class="fa fa-pen"></i></button>` : ''}
              ${canDelete ? `<button class="btn-icon danger" title="Elimina" onclick="DeadlinesPanel._elimina(${d.id})"><i class="fa fa-trash"></i></button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // ── Render struttura completa ─────────────────────────────────────────────────
  function _render() {
    if (!_container) return;
    const canCreate = !_opts.readonly && API.can('deadlines.create');
    const colAsset  = !_opts.assetId ? '<th>Asset</th>' : '';

    if (_lista.length === 0) {
      _container.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text-muted)">
          <i class="fa fa-calendar-check" style="font-size:28px;opacity:0.3;display:block;margin-bottom:8px"></i>
          <div style="font-size:13px">Nessuna scadenza${_opts.assetNome ? ' per questo asset' : ''}</div>
          ${canCreate ? `<button class="btn btn-primary" style="margin-top:12px" onclick="DeadlinesPanel._apriNuova()"><i class="fa fa-plus"></i> Nuova scadenza</button>` : ''}
        </div>`;
      return;
    }

    const n = _lista.length;
    _container.innerHTML = `
      <div class="filtri-bar">
        <input type="text" id="${_uid}_q" placeholder="Cerca titolo, assegnatario..." oninput="DeadlinesPanel._filtra()" style="flex:1;min-width:160px">
        <select id="${_uid}_stato" onchange="DeadlinesPanel._filtra()">
          <option value="">Tutti gli stati</option>
          <option value="aperta">Aperta</option>
          <option value="scaduta">Scaduta</option>
          <option value="chiusa">Chiusa</option>
        </select>
        <select id="${_uid}_prio" onchange="DeadlinesPanel._filtra()">
          <option value="">Tutte le priorità</option>
          <option value="critica">Critica</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="bassa">Bassa</option>
        </select>
        <span class="record-count" id="${_uid}_count">${n} scadenz${n === 1 ? 'a' : 'e'}${_opts.assetNome ? ` — ${_opts.assetNome}` : ''}</span>
        ${canCreate ? `<button class="btn btn-primary" onclick="DeadlinesPanel._apriNuova()"><i class="fa fa-plus"></i> Nuova scadenza</button>` : ''}
      </div>
      <div style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th style="width:32px"></th>
              <th>Titolo${!_opts.assetId ? ' / Asset' : ''}</th>
              <th>Priorità</th><th>Stato</th><th>Scadenza</th><th>Giorni</th>
              <th>Assegnatario</th><th></th>
            </tr>
          </thead>
          <tbody id="${_uid}_tbody"></tbody>
        </table>
      </div>`;

    _renderRighe();
  }

  // ── Form nuovo ────────────────────────────────────────────────────────────────
  async function _apriNuova() {
    document.getElementById('dlp-form-title').textContent = 'Nuova scadenza';
    document.getElementById('dlp-f-id').value = '';
    document.getElementById('dlp-f-titolo').value = '';
    document.getElementById('dlp-f-descrizione').value = '';
    document.getElementById('dlp-f-tipo').value = 'scadenza';
    document.getElementById('dlp-f-priorita').value = 'media';
    document.getElementById('dlp-f-data-scadenza').value = '';
    document.getElementById('dlp-f-assegnatario').value = '';
    document.getElementById('dlp-stato-wrap').style.display = 'none';
    document.getElementById('dlp-form-error').textContent = '';

    const assetWrap = document.getElementById('dlp-asset-wrap');
    if (_opts.assetId) {
      assetWrap.style.display = 'none';
      await _caricaAssets();
      document.getElementById('dlp-f-asset').value = _opts.assetId;
    } else {
      assetWrap.style.display = '';
      await _caricaAssets();
    }
    _apriModal();
  }

  async function _apriModifica(id) {
    const d = _lista.find(x => x.id === id);
    if (!d) return;
    document.getElementById('dlp-form-title').textContent = 'Modifica scadenza';
    document.getElementById('dlp-f-id').value = d.id;
    document.getElementById('dlp-f-titolo').value = d.titolo || '';
    document.getElementById('dlp-f-descrizione').value = d.descrizione || '';
    document.getElementById('dlp-f-tipo').value = d.tipo || 'scadenza';
    document.getElementById('dlp-f-priorita').value = d.priorita || 'media';
    document.getElementById('dlp-f-data-scadenza').value = d.data_scadenza || '';
    document.getElementById('dlp-f-assegnatario').value = d.assegnatario || '';
    document.getElementById('dlp-f-stato').value = d.stato || 'aperta';
    document.getElementById('dlp-stato-wrap').style.display = '';
    document.getElementById('dlp-form-error').textContent = '';

    const assetWrap = document.getElementById('dlp-asset-wrap');
    if (_opts.assetId) {
      assetWrap.style.display = 'none';
      await _caricaAssets();
      document.getElementById('dlp-f-asset').value = _opts.assetId;
    } else {
      assetWrap.style.display = '';
      await _caricaAssets();
      document.getElementById('dlp-f-asset').value = d.asset_id;
    }
    _apriModal();
  }

  function _chiudi() { _chiudiModal(); }

  async function _salva() {
    const titolo   = document.getElementById('dlp-f-titolo').value.trim();
    const dataScad = document.getElementById('dlp-f-data-scadenza').value;
    const errEl    = document.getElementById('dlp-form-error');
    if (!titolo || !dataScad) {
      errEl.textContent = 'Titolo e data scadenza sono obbligatori.';
      return;
    }
    errEl.textContent = '';

    const assetId = _opts.assetId
      ? _opts.assetId
      : parseInt(document.getElementById('dlp-f-asset').value);

    const id = document.getElementById('dlp-f-id').value;
    const payload = {
      asset_id:      assetId,
      titolo,
      descrizione:   document.getElementById('dlp-f-descrizione').value.trim() || null,
      tipo:          document.getElementById('dlp-f-tipo').value,
      priorita:      document.getElementById('dlp-f-priorita').value,
      data_scadenza: dataScad,
      assegnatario:  document.getElementById('dlp-f-assegnatario').value.trim() || null,
    };
    if (id) payload.stato = document.getElementById('dlp-f-stato').value;

    try {
      if (id) {
        await API.updateDeadline(parseInt(id), payload);
      } else {
        await API.createDeadline(payload);
      }
      _chiudiModal();
      await _carica();
      if (_opts.onSave) _opts.onSave();
    } catch (e) {
      errEl.textContent = 'Errore: ' + e.message;
    }
  }

  // ── Azioni rapide ─────────────────────────────────────────────────────────────
  async function _chiudiScadenza(id) {
    if (!confirm('Segnare la scadenza come chiusa?')) return;
    try {
      await API.updateDeadline(id, { stato: 'chiusa' });
      await _carica();
      if (_opts.onSave) _opts.onSave();
    } catch (e) { alert('Errore: ' + e.message); }
  }

  function _elimina(id) {
    const d = _lista.find(x => x.id === id);
    if (!d) return;
    if (typeof showConfirm === 'function') {
      showConfirm(`Eliminare la scadenza <strong>${d.titolo}</strong>?`, async () => {
        await API.deleteDeadline(id);
        await _carica();
        if (_opts.onSave) _opts.onSave();
      });
    } else if (confirm(`Eliminare la scadenza "${d.titolo}"?`)) {
      API.deleteDeadline(id).then(() => _carica()).then(() => { if (_opts.onSave) _opts.onSave(); });
    }
  }

  // ── Modale pannello asset (layout card-list identico a deadlines.html) ─────────
  let _panelAssetId   = null;
  let _panelAssetNome = null;
  let _panelDati      = [];
  let _panelFiltrati  = [];

  const PRIO_COLOR_P = { critica: 'var(--accent-red)', alta: 'var(--accent-orange)', media: 'var(--accent-blue)', bassa: 'var(--text-muted)' };
  const TIPO_ICON_P  = { normativa: 'fa-gavel', manutenzione: 'fa-wrench', collaudo: 'fa-circle-check', contratto: 'fa-file-lines', scadenza: 'fa-clock' };

  function _injectPanelOverlay() {
    if (document.getElementById('dlp-panel-overlay')) return;
    const div = document.createElement('div');
    div.innerHTML = `
    <div class="modal-overlay" id="dlp-panel-overlay" style="z-index:1100;align-items:flex-start;padding:40px 20px;">
      <div class="modal-box" style="max-width:920px;width:96%;max-height:85vh;display:flex;flex-direction:column;">
        <div class="modal-header">
          <h3 id="dlp-panel-title">Scadenze</h3>
          <button class="btn-icon" onclick="DeadlinesPanel._chiudiPanel()" title="Chiudi"><i class="fa fa-xmark"></i></button>
        </div>
        <div style="padding:12px 20px 0;flex-shrink:0">
          <div class="filtri-bar">
            <input type="text" id="dlp-panel-search" placeholder="Cerca scadenza, assegnatario..." style="flex:1;min-width:180px" oninput="DeadlinesPanel._panelFiltra()">
            <select id="dlp-panel-stato" onchange="DeadlinesPanel._panelFiltra()">
              <option value="">Tutti gli stati</option>
              <option value="aperta">Aperta</option>
              <option value="chiusa">Chiusa</option>
              <option value="scaduta">Scaduta</option>
            </select>
            <select id="dlp-panel-priorita" onchange="DeadlinesPanel._panelFiltra()">
              <option value="">Tutte le priorità</option>
              <option value="critica">Critica</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="bassa">Bassa</option>
            </select>
            <span class="record-count" id="dlp-panel-count"></span>
            <button class="btn btn-primary" onclick="DeadlinesPanel._apriNuovaPanel()"><i class="fa fa-plus"></i> Nuova scadenza</button>
          </div>
        </div>
        <div id="dlp-panel-list" style="flex:1;overflow-y:auto;padding:12px 20px 20px">
          <div style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto"></div></div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(div);
  }

  function _renderPanelCards() {
    const oggi = new Date(); oggi.setHours(0,0,0,0);
    const container = document.getElementById('dlp-panel-list');
    const countEl   = document.getElementById('dlp-panel-count');
    const n = _panelFiltrati.length;
    if (countEl) countEl.textContent = `${n} scadenz${n===1?'a':'e'}${_panelAssetNome ? ' — '+_panelAssetNome : ''}`;
    if (!container) return;
    if (n === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:32px"><i class="fa fa-calendar-check"></i> Nessuna scadenza trovata</p>';
      return;
    }
    const canEdit = API.can('deadlines.update');
    const canDel  = API.can('deadlines.delete');
    container.innerHTML = _panelFiltrati.map(d => {
      const scad    = new Date(d.data_scadenza);
      const diffGg  = Math.ceil((scad - oggi) / 86400000);
      const isScad  = d.stato === 'scaduta' || (d.stato === 'aperta' && diffGg < 0);
      const isUrg   = d.stato === 'aperta' && diffGg >= 0 && diffGg <= 7;
      const rowCls  = d.stato === 'chiusa' ? 'chiusa' : isScad ? 'scaduta' : isUrg ? 'urgente' : 'normale';
      let dataLbl = '';
      if (d.stato === 'chiusa') dataLbl = `<span style="color:var(--accent-green)"><i class="fa fa-check"></i> Chiusa</span>`;
      else if (isScad)          dataLbl = `<span style="color:var(--accent-red)"><i class="fa fa-exclamation-circle"></i> Scaduta il ${d.data_scadenza}</span>`;
      else if (diffGg === 0)    dataLbl = `<span style="color:var(--accent-orange)"><i class="fa fa-clock"></i> Scade oggi</span>`;
      else if (diffGg === 1)    dataLbl = `<span style="color:var(--accent-orange)"><i class="fa fa-clock"></i> Scade domani</span>`;
      else if (diffGg <= 7)     dataLbl = `<span style="color:var(--accent-orange)"><i class="fa fa-clock"></i> Scade tra ${diffGg} gg</span>`;
      else                      dataLbl = `<span style="color:var(--text-muted)"><i class="fa fa-calendar"></i> ${d.data_scadenza}</span>`;
      const canClose = canEdit && d.stato === 'aperta';
      return `<div class="dl-row ${rowCls}">
        <i class="fa ${TIPO_ICON_P[d.tipo]||'fa-clock'}" style="color:${PRIO_COLOR_P[d.priorita]||''};font-size:18px;flex-shrink:0"></i>
        <div class="dl-info">
          <div class="dl-titolo">${d.titolo}</div>
          <div class="dl-asset"><i class="fa fa-map-marker"></i> ${d.asset_nome||''} &mdash; ${d.asset_citta||''}</div>
          <div class="dl-meta">${dataLbl} &nbsp;·&nbsp; <span style="font-weight:600;color:${PRIO_COLOR_P[d.priorita]||''}">${(d.priorita||'').toUpperCase()}</span> &nbsp;·&nbsp; ${d.tipo||''}${d.assegnatario?' &nbsp;·&nbsp; <i class="fa fa-user"></i> '+d.assegnatario:''}</div>
        </div>
        <div class="dl-actions">
          ${canClose ? `<button class="btn btn-secondary btn-sm" title="Chiudi" onclick="DeadlinesPanel._chiudiScadenzaPanel(${d.id})"><i class="fa fa-check"></i></button>` : ''}
          ${canEdit  ? `<button class="btn btn-secondary btn-sm" title="Modifica" onclick="DeadlinesPanel._apriModificaPanel(${d.id})"><i class="fa fa-pen"></i></button>` : ''}
          ${canDel   ? `<button class="btn-icon danger" onclick="DeadlinesPanel._eliminaPanel(${d.id})"><i class="fa fa-trash"></i></button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  async function apri(assetId, assetNome) {
    _panelAssetId   = assetId;
    _panelAssetNome = assetNome;
    _injectModal(1200);
    _injectPanelOverlay();
    const ov = document.getElementById('dlp-panel-overlay');
    if (ov) ov.classList.add('open');
    const titleEl = document.getElementById('dlp-panel-title');
    if (titleEl) titleEl.textContent = assetNome ? `Scadenze — ${assetNome}` : 'Scadenze';
    // Reset filtri
    const s = document.getElementById('dlp-panel-search');    if (s) s.value = '';
    const st = document.getElementById('dlp-panel-stato');    if (st) st.value = '';
    const pr = document.getElementById('dlp-panel-priorita'); if (pr) pr.value = '';
    const lst = document.getElementById('dlp-panel-list');
    if (lst) lst.innerHTML = '<div style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto"></div></div>';
    try {
      const params = assetId ? { asset_id: assetId } : {};
      _panelDati = await API.getDeadlines(params);
      _panelFiltrati = [..._panelDati];
      _renderPanelCards();
    } catch (e) {
      if (lst) lst.innerHTML = `<p style="color:var(--accent-red);padding:16px">Errore: ${e.message}</p>`;
    }
  }

  function _chiudiPanel() {
    const ov = document.getElementById('dlp-panel-overlay');
    if (ov) ov.classList.remove('open');
  }

  function _panelFiltra() {
    const q  = (document.getElementById('dlp-panel-search')?.value    || '').toLowerCase();
    const st = (document.getElementById('dlp-panel-stato')?.value     || '');
    const pr = (document.getElementById('dlp-panel-priorita')?.value  || '');
    _panelFiltrati = _panelDati.filter(d => {
      if (st && d.stato !== st) return false;
      if (pr && d.priorita !== pr) return false;
      if (q && ![(d.titolo||''), (d.assegnatario||'')].some(v => v.toLowerCase().includes(q))) return false;
      return true;
    });
    _renderPanelCards();
  }

  function _apriNuovaPanel() {
    _opts = { assetId: _panelAssetId, assetNome: _panelAssetNome, zIndex: 1200, onSave: null, readonly: false };
    _apriNuova();
  }

  async function _apriModificaPanel(id) {
    _lista = _panelDati;
    _opts  = { assetId: _panelAssetId, assetNome: _panelAssetNome, zIndex: 1200, onSave: null, readonly: false };
    await _apriModifica(id);
  }

  async function _chiudiScadenzaPanel(id) {
    if (!confirm('Segnare la scadenza come chiusa?')) return;
    try {
      await API.updateDeadline(id, { stato: 'chiusa' });
      await apri(_panelAssetId, _panelAssetNome);
    } catch (e) { alert('Errore: ' + e.message); }
  }

  async function _eliminaPanel(id) {
    const d = _panelDati.find(x => x.id === id);
    if (!d || !confirm(`Eliminare la scadenza "${d.titolo}"?`)) return;
    try {
      await API.deleteDeadline(id);
      await apri(_panelAssetId, _panelAssetNome);
    } catch (e) { alert('Errore: ' + e.message); }
  }

  // ── API pubblica ──────────────────────────────────────────────────────────────
  function mount(containerEl, opts = {}) {
    _container = containerEl;
    _opts = {
      assetId:   opts.assetId   ?? null,
      assetNome: opts.assetNome ?? null,
      zIndex:    opts.zIndex    ?? 1000,
      onSave:    opts.onSave    ?? null,
      readonly:  opts.readonly  ?? false,
    };
    _injectModal(_opts.zIndex);
    if (_container) _caricaConCards();
  }

  // ── Caricamento con layout card-list (identico a deadlines.html) ──────────────
  async function _caricaConCards() {
    if (!_container) return;
    _container.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
    try {
      if (_opts.assetId) {
        _panelDati = await API.getAssetDeadlines(_opts.assetId);
      } else {
        const params = {};
        _panelDati = await API.getDeadlines(params);
      }
      _panelAssetId   = _opts.assetId;
      _panelAssetNome = _opts.assetNome;
      _panelFiltrati  = [..._panelDati];
      _renderCards();
    } catch (e) {
      _container.innerHTML = `<p class="error-msg"><i class="fa fa-exclamation-circle"></i> Errore: ${e.message}</p>`;
    }
  }

  // ── Render card-list nel container (identico a deadlines.html) ────────────────
  function _renderCards() {
    if (!_container) return;
    const canCreate = !_opts.readonly && API.can('deadlines.create');
    const n = _panelDati.length;
    _container.innerHTML = `
      <div class="filtri-bar">
        <input type="text" id="dlp-c-search" placeholder="Cerca scadenza, assegnatario..." style="flex:1;min-width:180px" oninput="DeadlinesPanel._cardFiltra()">
        <select id="dlp-c-stato" onchange="DeadlinesPanel._cardFiltra()">
          <option value="">Tutti gli stati</option>
          <option value="aperta">Aperta</option>
          <option value="chiusa">Chiusa</option>
          <option value="scaduta">Scaduta</option>
        </select>
        <select id="dlp-c-prio" onchange="DeadlinesPanel._cardFiltra()">
          <option value="">Tutte le priorità</option>
          <option value="critica">Critica</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="bassa">Bassa</option>
        </select>
        <span class="record-count" id="dlp-c-count">${n} scadenz${n===1?'a':'e'}${_opts.assetNome ? ' — '+_opts.assetNome : ''}</span>
        ${canCreate ? `<button class="btn btn-primary" onclick="DeadlinesPanel._apriNuovaCard()"><i class="fa fa-plus"></i> Nuova scadenza</button>` : ''}
      </div>
      <div id="dlp-c-list" style="overflow-y:auto;max-height:calc(100% - 60px)"></div>`;
    _renderCardRighe();
  }

  function _renderCardRighe() {
    const container = document.getElementById('dlp-c-list');
    const countEl   = document.getElementById('dlp-c-count');
    const oggi = new Date(); oggi.setHours(0,0,0,0);
    const n = _panelFiltrati.length;
    if (countEl) countEl.textContent = `${n} scadenz${n===1?'a':'e'}${_opts.assetNome ? ' — '+_opts.assetNome : ''}`;
    if (!container) return;
    if (n === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:32px"><i class="fa fa-calendar-check"></i> Nessuna scadenza trovata</p>';
      return;
    }
    const canEdit = !_opts.readonly && API.can('deadlines.update');
    const canDel  = !_opts.readonly && API.can('deadlines.delete');
    container.innerHTML = _panelFiltrati.map(d => {
      const scad   = new Date(d.data_scadenza);
      const diffGg = Math.ceil((scad - oggi) / 86400000);
      const isScad = d.stato === 'scaduta' || (d.stato === 'aperta' && diffGg < 0);
      const isUrg  = d.stato === 'aperta' && diffGg >= 0 && diffGg <= 7;
      const rowCls = d.stato === 'chiusa' ? 'chiusa' : isScad ? 'scaduta' : isUrg ? 'urgente' : 'normale';
      let dataLbl = '';
      if (d.stato === 'chiusa')  dataLbl = `<span style="color:var(--accent-green)"><i class="fa fa-check"></i> Chiusa</span>`;
      else if (isScad)           dataLbl = `<span style="color:var(--accent-red)"><i class="fa fa-exclamation-circle"></i> Scaduta il ${d.data_scadenza}</span>`;
      else if (diffGg === 0)     dataLbl = `<span style="color:var(--accent-orange)"><i class="fa fa-clock"></i> Scade oggi</span>`;
      else if (diffGg === 1)     dataLbl = `<span style="color:var(--accent-orange)"><i class="fa fa-clock"></i> Scade domani</span>`;
      else if (diffGg <= 7)      dataLbl = `<span style="color:var(--accent-orange)"><i class="fa fa-clock"></i> Scade tra ${diffGg} gg</span>`;
      else                       dataLbl = `<span style="color:var(--text-muted)"><i class="fa fa-calendar"></i> ${d.data_scadenza}</span>`;
      const canClose = canEdit && d.stato === 'aperta';
      return `<div class="dl-row ${rowCls}">
        <i class="fa ${TIPO_ICON_P[d.tipo]||'fa-clock'}" style="color:${PRIO_COLOR_P[d.priorita]||''};font-size:18px;flex-shrink:0"></i>
        <div class="dl-info">
          <div class="dl-titolo">${d.titolo}</div>
          ${!_opts.assetId ? `<div class="dl-asset"><i class="fa fa-map-marker"></i> ${d.asset_nome||''} &mdash; ${d.asset_citta||''}</div>` : ''}
          <div class="dl-meta">${dataLbl} &nbsp;·&nbsp; <span style="font-weight:600;color:${PRIO_COLOR_P[d.priorita]||''}">${(d.priorita||'').toUpperCase()}</span> &nbsp;·&nbsp; ${d.tipo||''}${d.assegnatario?' &nbsp;·&nbsp; <i class="fa fa-user"></i> '+d.assegnatario:''}</div>
        </div>
        <div class="dl-actions">
          ${canClose ? `<button class="btn btn-secondary btn-sm" title="Chiudi" onclick="DeadlinesPanel._chiudiScadenzaCard(${d.id})"><i class="fa fa-check"></i></button>` : ''}
          ${canEdit  ? `<button class="btn btn-secondary btn-sm" title="Modifica" onclick="DeadlinesPanel._apriModificaCard(${d.id})"><i class="fa fa-pen"></i></button>` : ''}
          ${canDel   ? `<button class="btn-icon danger" onclick="DeadlinesPanel._eliminaCard(${d.id})"><i class="fa fa-trash"></i></button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function _cardFiltra() {
    const q  = (document.getElementById('dlp-c-search')?.value || '').toLowerCase();
    const st = (document.getElementById('dlp-c-stato')?.value  || '');
    const pr = (document.getElementById('dlp-c-prio')?.value   || '');
    const oggi = new Date(); oggi.setHours(0,0,0,0);
    _panelFiltrati = _panelDati.filter(d => {
      const statoEff = (d.stato === 'aperta' && new Date(d.data_scadenza) < oggi) ? 'scaduta' : d.stato;
      if (st && statoEff !== st) return false;
      if (pr && d.priorita !== pr) return false;
      if (q && ![(d.titolo||''), (d.assegnatario||''), (d.asset_nome||'')].some(v => v.toLowerCase().includes(q))) return false;
      return true;
    });
    _renderCardRighe();
  }

  function _apriNuovaCard() {
    _opts = { assetId: _panelAssetId, assetNome: _panelAssetNome, zIndex: 1100, onSave: () => _caricaConCards(), readonly: false };
    _apriNuova();
  }

  async function _apriModificaCard(id) {
    _lista = _panelDati;
    _opts  = { assetId: _panelAssetId, assetNome: _panelAssetNome, zIndex: 1100, onSave: () => _caricaConCards(), readonly: false };
    await _apriModifica(id);
  }

  async function _chiudiScadenzaCard(id) {
    if (!confirm('Segnare la scadenza come chiusa?')) return;
    try {
      await API.updateDeadline(id, { stato: 'chiusa' });
      await _caricaConCards();
    } catch (e) { alert('Errore: ' + e.message); }
  }

  async function _eliminaCard(id) {
    const d = _panelDati.find(x => x.id === id);
    if (!d || !confirm(`Eliminare la scadenza "${d.titolo}"?`)) return;
    try {
      await API.deleteDeadline(id);
      await _caricaConCards();
    } catch (e) { alert('Errore: ' + e.message); }
  }

  function refresh() { return _carica(); }

  return {
    mount,
    refresh,
    apri,
    _filtra,
    _panelFiltra,
    _cardFiltra,
    _apriNuova,
    _apriNuovaPanel,
    _apriNuovaCard,
    _apriModifica,
    _apriModificaPanel,
    _apriModificaCard,
    _chiudi,
    _chiudiPanel,
    _salva,
    _chiudiScadenza,
    _chiudiScadenzaPanel,
    _chiudiScadenzaCard,
    _elimina,
    _eliminaPanel,
    _eliminaCard,
  };
})();
