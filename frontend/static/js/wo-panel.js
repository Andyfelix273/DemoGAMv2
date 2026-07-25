/**
 * wo-panel.js — Pannello Work Order riutilizzabile
 * GIS Asset Manager v2.0 — KeyBiz
 *
 * Espone l'oggetto globale `WoPanel` con il metodo:
 *
 *   WoPanel.mount(containerEl, opts)
 *
 * Parametri opts:
 *   assetId   {number|null}  — se presente, filtra i WO per quell'asset
 *   assetNome {string|null}  — nome asset per il titolo della modale di creazione
 *   zIndex    {number}       — z-index base per le modali (default 1000; usare 1100 dentro modale asset)
 *   onSave    {function}     — callback opzionale dopo ogni salvataggio/eliminazione
 *   readonly  {boolean}      — se true, nasconde i controlli di creazione/modifica
 *
 * Uso in pagina standalone (workorders.html):
 *   WoPanel.mount(document.getElementById('wo-panel-root'), { zIndex: 1000 });
 *
 * Uso nella modale dettaglio asset (map-modal.js):
 *   WoPanel.mount(document.getElementById('mm-panel-workorders'), {
 *     assetId: 5, assetNome: 'Stabilimento Nord Milano', zIndex: 1100
 *   });
 */
/* global API */
const WoPanel = (() => {
  // ── Costanti ─────────────────────────────────────────────────────────────────
  const STATO_LABEL  = { aperto: 'Aperto', in_corso: 'In corso', completato: 'Completato', annullato: 'Annullato' };
  const STATO_COLOR  = { aperto: 'var(--accent-blue)', in_corso: 'var(--accent-orange)', completato: 'var(--accent-green)', annullato: 'var(--text-muted)' };
  const PRIO_COLOR   = { bassa: 'var(--text-muted)', media: 'var(--accent-blue)', alta: 'var(--accent-orange)', critica: 'var(--accent-red)' };
  const MODAL_FORM_ID   = 'wop-modal-form';
  const MODAL_DET_ID    = 'wop-modal-dettaglio';
  const MODAL_STATO_ID  = 'wop-modal-stato';

  // ── Stato interno ─────────────────────────────────────────────────────────────
  let _container   = null;
  let _opts        = {};
  let _lista       = [];
  let _corrente    = null;
  let _assetsCache = [];
  let _cambioStatoId     = null;
  let _cambioStatoScelto = null;

  // ── Utility ───────────────────────────────────────────────────────────────────
  function fmtData(d) {
    if (!d) return '—';
    const [y, m, g] = d.split('-');
    return `${g}/${m}/${y}`;
  }
  function fmtDataOra(dt) {
    if (!dt) return '—';
    try {
      const date = new Date(dt);
      if (isNaN(date.getTime())) return dt;
      const g  = String(date.getDate()).padStart(2, '0');
      const m  = String(date.getMonth() + 1).padStart(2, '0');
      const y  = date.getFullYear();
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      return `${g}/${m}/${y} ${hh}:${mm}`;
    } catch (e) { return dt; }
  }
  function badgeStato(stato) {
    const col = STATO_COLOR[stato] || 'var(--text-muted)';
    return `<span style="background:${col}22;color:${col};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${STATO_LABEL[stato] || stato}</span>`;
  }
  function badgePrio(prio) {
    const col = PRIO_COLOR[prio] || 'var(--text-muted)';
    return `<span style="color:${col};font-size:11px;font-weight:700">${(prio || '').toUpperCase()}</span>`;
  }
  function oggi() { return new Date().toISOString().split('T')[0]; }

  // ── Gestione modali ───────────────────────────────────────────────────────────
  function _getModal(id) { return document.getElementById(id); }

  function _apriModal(id) {
    const el = _getModal(id);
    if (el) el.classList.add('open');
  }
  function _chiudiModal(id) {
    const el = _getModal(id);
    if (el) el.classList.remove('open');
  }

  // ── Iniezione modali nel DOM (una sola volta per sessione) ────────────────────
  function _injectModals(zIndex) {
    if (_getModal(MODAL_FORM_ID)) {
      // Aggiorna solo il z-index se le modali esistono già
      [MODAL_FORM_ID, MODAL_DET_ID, MODAL_STATO_ID].forEach(id => {
        const el = _getModal(id);
        if (el) el.style.zIndex = zIndex;
      });
      return;
    }

    const html = `
    <!-- WoPanel: modale form crea/modifica -->
    <div class="modal-overlay" id="${MODAL_FORM_ID}" style="z-index:${zIndex}">
      <div class="modal-box" style="max-width:620px">
        <div class="modal-header">
          <h3 id="wop-form-title">Nuovo Work Order</h3>
          <button class="btn-icon" onclick="WoPanel._chiudiForm()" title="Chiudi"><i class="fa fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="wop-f-id">
          <div class="form-grid">
            <div class="form-group full" id="wop-asset-wrap">
              <label>Asset *</label>
              <select id="wop-f-asset" required></select>
            </div>
            <div class="form-group full">
              <label>Titolo *</label>
              <input type="text" id="wop-f-titolo" placeholder="Descrizione breve dell'intervento" required>
            </div>
            <div class="form-group">
              <label>Tipo</label>
              <select id="wop-f-tipo">
                <option value="correttivo">Correttivo</option>
                <option value="preventivo">Preventivo</option>
                <option value="ispezione">Ispezione</option>
                <option value="manutenzione">Manutenzione</option>
              </select>
            </div>
            <div class="form-group">
              <label>Priorità</label>
              <select id="wop-f-priorita">
                <option value="bassa">Bassa</option>
                <option value="media" selected>Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Critica</option>
              </select>
            </div>
            <div class="form-group">
              <label>Assegnatario</label>
              <input type="text" id="wop-f-assegnatario" placeholder="Nome o team responsabile">
            </div>
            <div class="form-group">
              <label>Data pianificata</label>
              <input type="date" id="wop-f-data-pianificata">
            </div>
            <div class="form-group full">
              <label>Descrizione</label>
              <textarea id="wop-f-descrizione" placeholder="Dettagli dell'intervento, cause, note operative..."></textarea>
            </div>
          </div>
          <div id="wop-form-error" class="form-error"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="WoPanel._chiudiForm()">Annulla</button>
          <button class="btn btn-primary" onclick="WoPanel._salva()"><i class="fa fa-floppy-disk"></i> Salva</button>
        </div>
      </div>
    </div>

    <!-- WoPanel: modale dettaglio -->
    <div class="modal-overlay" id="${MODAL_DET_ID}" style="z-index:${zIndex}">
      <div class="modal-box" style="max-width:680px">
        <div class="modal-header">
          <h3 id="wop-det-codice">WO-0000</h3>
          <button class="btn-icon" onclick="WoPanel._chiudiDettaglio()" title="Chiudi"><i class="fa fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
            <span id="wop-det-stato-badge"></span>
            <span id="wop-det-prio-badge"></span>
            <span id="wop-det-tipo-badge" style="font-size:11px;color:var(--text-muted)"></span>
            <span style="margin-left:auto;font-size:12px;color:var(--text-muted)" id="wop-det-creato-da"></span>
          </div>
          <div class="form-grid" style="margin-bottom:16px">
            <div class="form-group full">
              <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Titolo</label>
              <span id="wop-det-titolo" style="font-size:15px;font-weight:600"></span>
            </div>
            <div class="form-group">
              <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Asset</label>
              <span id="wop-det-asset" style="font-size:13px"></span>
            </div>
            <div class="form-group">
              <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Assegnatario</label>
              <span id="wop-det-assegnatario" style="font-size:13px"></span>
            </div>
            <div class="form-group">
              <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Data apertura</label>
              <span id="wop-det-apertura" style="font-size:13px"></span>
            </div>
            <div class="form-group">
              <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Data pianificata</label>
              <span id="wop-det-pianificata" style="font-size:13px"></span>
            </div>
            <div class="form-group" id="wop-det-chiusura-wrap" style="display:none">
              <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Data chiusura</label>
              <span id="wop-det-chiusura" style="font-size:13px"></span>
            </div>
          </div>
          <div class="form-group" id="wop-det-desc-wrap">
            <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Descrizione</label>
            <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;padding:10px;font-size:13px;line-height:1.5;margin-top:4px" id="wop-det-descrizione"></div>
          </div>
          <div class="form-group" id="wop-det-note-wrap" style="display:none;margin-top:12px">
            <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Note di chiusura</label>
            <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;padding:10px;font-size:13px;line-height:1.5;margin-top:4px" id="wop-det-note-chiusura"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="WoPanel._chiudiDettaglio()">Chiudi</button>
          <button class="btn btn-secondary" id="wop-det-btn-stato" onclick="WoPanel._apriCambioStatoDaDettaglio()"><i class="fa fa-exchange"></i> Cambia stato</button>
          <button class="btn btn-primary" id="wop-det-btn-modifica" onclick="WoPanel._apriModificaDaDettaglio()"><i class="fa fa-pen"></i> Modifica</button>
        </div>
      </div>
    </div>

    <!-- WoPanel: modale cambio stato -->
    <div class="modal-overlay" id="${MODAL_STATO_ID}" style="z-index:${zIndex}">
      <div class="modal-box modal-sm">
        <div class="modal-header">
          <h3>Cambia stato — <span id="wop-stato-codice"></span></h3>
          <button class="btn-icon" onclick="WoPanel._chiudiStato()" title="Chiudi"><i class="fa fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="stato-options" id="wop-stato-options"></div>
          <div class="form-group" id="wop-note-chiusura-wrap" style="display:none;margin-top:16px">
            <label>Note di chiusura</label>
            <textarea id="wop-note-chiusura-input" placeholder="Descrivi come è stato risolto o perché è stato annullato..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="WoPanel._chiudiStato()">Annulla</button>
          <button class="btn btn-primary" onclick="WoPanel._confermaCambioStato()"><i class="fa fa-check"></i> Conferma</button>
        </div>
      </div>
    </div>`;

    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);

    // Chiudi con Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        _chiudiModal(MODAL_STATO_ID);
        _chiudiModal(MODAL_DET_ID);
        _chiudiModal(MODAL_FORM_ID);
      }
    });
  }

  // ── Caricamento asset per il select ──────────────────────────────────────────
  async function _caricaAssets() {
    if (_assetsCache.length === 0) {
      const geo = await API.getAssets();
      _assetsCache = (geo.features || []).map(f => f.properties);
    }
    const sel = document.getElementById('wop-f-asset');
    if (!sel) return;
    sel.innerHTML = _assetsCache.map(a =>
      `<option value="${a.id}">${a.nome} (${a.tipo})</option>`
    ).join('');
  }

  // ── Render lista nel container ────────────────────────────────────────────────
  async function _carica() {
    if (!_container) return;
    _container.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
    try {
      if (_opts.assetId) {
        _lista = await API.getAssetWorkOrders(_opts.assetId);
      } else {
        _lista = await API.getWorkOrders();
      }
      _render();
    } catch (e) {
      _container.innerHTML = `<p style="color:var(--accent-red);font-size:13px"><i class="fa fa-exclamation-circle"></i> Errore caricamento: ${e.message}</p>`;
    }
  }

  function _render() {
    if (!_container) return;
    const canCreate = !_opts.readonly && API.can('work_orders.create');
    const canEdit   = !_opts.readonly && API.can('work_orders.update');
    const canDelete = !_opts.readonly && API.can('work_orders.delete');
    const oggi_str  = oggi();

    if (_lista.length === 0) {
      _container.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text-muted)">
          <i class="fa fa-wrench" style="font-size:28px;opacity:0.3;display:block;margin-bottom:8px"></i>
          <div style="font-size:13px">Nessun work order${_opts.assetNome ? ' per questo asset' : ''}</div>
          ${canCreate ? `<button class="btn btn-primary" style="margin-top:12px" onclick="WoPanel._apriNuovo()"><i class="fa fa-plus"></i> Nuovo WO</button>` : ''}
        </div>`;
      return;
    }

    const righe = _lista.map(wo => {
      const scaduto = wo.data_pianificata && wo.data_pianificata < oggi_str &&
                      !['completato', 'annullato'].includes(wo.stato);
      const rowStyle = scaduto ? 'background:rgba(248,81,73,0.04)' : '';
      const dataPian = wo.data_pianificata
        ? `${fmtData(wo.data_pianificata)}${scaduto ? ' <span style="font-size:10px;color:var(--accent-red);font-weight:600">SCADUTO</span>' : ''}`
        : '<span style="color:var(--text-muted)">—</span>';
      const canStato = canEdit && !['completato', 'annullato'].includes(wo.stato);
      return `
        <tr style="${rowStyle}" ondblclick="WoPanel._apriDettaglio(${wo.id})">
          <td><span style="font-family:monospace;font-size:12px;font-weight:600">${wo.codice}</span></td>
          <td style="max-width:260px">
            <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${wo.titolo}">${wo.titolo}</div>
          </td>
          ${!_opts.assetId ? `<td><div style="font-size:12px">${wo.asset_nome}</div><div style="font-size:11px;color:var(--text-muted)">${wo.asset_citta || ''}</div></td>` : ''}
          <td><span class="tipo-badge">${wo.tipo}</span></td>
          <td>${badgePrio(wo.priorita)}</td>
          <td>${badgeStato(wo.stato)}</td>
          <td style="font-size:12px">${wo.assegnatario || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td style="font-size:12px">${dataPian}</td>
          <td style="font-size:12px">${fmtDataOra(wo.data_apertura)}</td>
          <td>
            <div class="row-actions">
              <button class="btn-icon" title="Dettaglio" onclick="WoPanel._apriDettaglio(${wo.id})"><i class="fa fa-eye"></i></button>
              ${canStato  ? `<button class="btn-icon" title="Cambia stato" onclick="WoPanel._apriCambioStato(${wo.id})"><i class="fa fa-exchange"></i></button>` : ''}
              ${canEdit   ? `<button class="btn-icon" title="Modifica" onclick="WoPanel._apriModifica(${wo.id})"><i class="fa fa-pen"></i></button>` : ''}
              ${canDelete ? `<button class="btn-icon danger" title="Elimina" onclick="WoPanel._elimina(${wo.id})"><i class="fa fa-trash"></i></button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');

    const colAsset = !_opts.assetId ? '<th>Asset</th>' : '';
    _container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--text-muted)">${_lista.length} work order${_opts.assetNome ? ` — ${_opts.assetNome}` : ''}</span>
        ${canCreate ? `<button class="btn btn-primary" onclick="WoPanel._apriNuovo()"><i class="fa fa-plus"></i> Nuovo WO</button>` : ''}
      </div>
      <div style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th>Codice</th><th>Titolo</th>${colAsset}<th>Tipo</th><th>Priorità</th><th>Stato</th>
              <th>Assegnatario</th><th>Data pianif.</th><th>Apertura</th><th></th>
            </tr>
          </thead>
          <tbody>${righe}</tbody>
        </table>
      </div>`;
  }

  // ── Apertura form nuovo ───────────────────────────────────────────────────────
  async function _apriNuovo(prefill = {}) {
    _corrente = null;
    document.getElementById('wop-form-title').textContent = 'Nuovo Work Order';
    document.getElementById('wop-f-id').value = '';
    document.getElementById('wop-f-titolo').value = prefill.titolo || '';
    document.getElementById('wop-f-tipo').value = prefill.tipo || 'correttivo';
    document.getElementById('wop-f-priorita').value = prefill.priorita || 'media';
    document.getElementById('wop-f-assegnatario').value = prefill.assegnatario || '';
    document.getElementById('wop-f-data-pianificata').value = prefill.data_pianificata || '';
    document.getElementById('wop-f-descrizione').value = prefill.descrizione || '';
    document.getElementById('wop-form-error').textContent = '';

    // Se il pannello è contestuale a un asset, nascondi il select asset e preimpostalo
    const assetWrap = document.getElementById('wop-asset-wrap');
    if (_opts.assetId) {
      assetWrap.style.display = 'none';
      // Assicura che il select esista e abbia il valore corretto
      await _caricaAssets();
      document.getElementById('wop-f-asset').value = _opts.assetId;
    } else {
      assetWrap.style.display = '';
      await _caricaAssets();
      if (prefill.asset_id) document.getElementById('wop-f-asset').value = prefill.asset_id;
    }
    _apriModal(MODAL_FORM_ID);
  }

  function _apriModifica(id) {
    const wo = _lista.find(w => w.id === id);
    if (!wo) return;
    _corrente = wo;
    document.getElementById('wop-form-title').textContent = `Modifica ${wo.codice}`;
    document.getElementById('wop-f-id').value = wo.id;
    document.getElementById('wop-f-titolo').value = wo.titolo;
    document.getElementById('wop-f-tipo').value = wo.tipo;
    document.getElementById('wop-f-priorita').value = wo.priorita;
    document.getElementById('wop-f-assegnatario').value = wo.assegnatario || '';
    document.getElementById('wop-f-data-pianificata').value = wo.data_pianificata || '';
    document.getElementById('wop-f-descrizione').value = wo.descrizione || '';
    document.getElementById('wop-form-error').textContent = '';

    const assetWrap = document.getElementById('wop-asset-wrap');
    if (_opts.assetId) {
      assetWrap.style.display = 'none';
    } else {
      assetWrap.style.display = '';
      _caricaAssets().then(() => {
        document.getElementById('wop-f-asset').value = wo.asset_id;
      });
    }
    _apriModal(MODAL_FORM_ID);
  }

  function _apriModificaDaDettaglio() {
    _chiudiModal(MODAL_DET_ID);
    if (_corrente) _apriModifica(_corrente.id);
  }

  function _chiudiForm() { _chiudiModal(MODAL_FORM_ID); }

  async function _salva() {
    const titolo = document.getElementById('wop-f-titolo').value.trim();
    const errEl  = document.getElementById('wop-form-error');
    if (!titolo) { errEl.textContent = 'Il titolo è obbligatorio.'; return; }
    errEl.textContent = '';

    const assetId = _opts.assetId
      ? _opts.assetId
      : parseInt(document.getElementById('wop-f-asset').value);

    const payload = {
      asset_id:         assetId,
      tipo:             document.getElementById('wop-f-tipo').value,
      priorita:         document.getElementById('wop-f-priorita').value,
      titolo,
      descrizione:      document.getElementById('wop-f-descrizione').value.trim() || null,
      assegnatario:     document.getElementById('wop-f-assegnatario').value.trim() || null,
      data_pianificata: document.getElementById('wop-f-data-pianificata').value || null,
    };

    try {
      const id = document.getElementById('wop-f-id').value;
      if (id) {
        await API.updateWorkOrder(parseInt(id), payload);
      } else {
        await API.createWorkOrder(payload);
      }
      _chiudiModal(MODAL_FORM_ID);
      await _carica();
      if (_opts.onSave) _opts.onSave();
    } catch (e) {
      errEl.textContent = 'Errore: ' + e.message;
    }
  }

  // ── Dettaglio ─────────────────────────────────────────────────────────────────
  async function _apriDettaglio(id) {
    try {
      const wo = await API.getWorkOrder(id);
      _corrente = wo;
      document.getElementById('wop-det-codice').textContent = wo.codice;
      document.getElementById('wop-det-titolo').textContent = wo.titolo;
      document.getElementById('wop-det-stato-badge').innerHTML = badgeStato(wo.stato);
      document.getElementById('wop-det-prio-badge').innerHTML  = badgePrio(wo.priorita);
      document.getElementById('wop-det-tipo-badge').textContent = wo.tipo || '';
      document.getElementById('wop-det-creato-da').textContent  = wo.creato_da ? `Creato da: ${wo.creato_da}` : '';
      document.getElementById('wop-det-asset').textContent       = `${wo.asset_nome} — ${wo.asset_citta || ''}`;
      document.getElementById('wop-det-assegnatario').textContent = wo.assegnatario || '—';
      document.getElementById('wop-det-apertura').textContent    = fmtDataOra(wo.data_apertura);
      document.getElementById('wop-det-pianificata').textContent = wo.data_pianificata ? fmtData(wo.data_pianificata) : '—';

      const chiusuraWrap = document.getElementById('wop-det-chiusura-wrap');
      if (wo.data_chiusura) {
        chiusuraWrap.style.display = '';
        document.getElementById('wop-det-chiusura').textContent = fmtDataOra(wo.data_chiusura);
      } else { chiusuraWrap.style.display = 'none'; }

      document.getElementById('wop-det-descrizione').textContent = wo.descrizione || '—';
      const noteWrap = document.getElementById('wop-det-note-wrap');
      if (wo.note_chiusura) {
        noteWrap.style.display = '';
        document.getElementById('wop-det-note-chiusura').textContent = wo.note_chiusura;
      } else { noteWrap.style.display = 'none'; }

      const canEdit  = !_opts.readonly && API.can('work_orders.update');
      const canStato = canEdit && !['completato', 'annullato'].includes(wo.stato);
      document.getElementById('wop-det-btn-modifica').style.display = canEdit  ? '' : 'none';
      document.getElementById('wop-det-btn-stato').style.display    = canStato ? '' : 'none';

      _apriModal(MODAL_DET_ID);
    } catch (e) { alert('Errore caricamento dettaglio: ' + e.message); }
  }

  function _chiudiDettaglio() { _chiudiModal(MODAL_DET_ID); }

  // ── Cambio stato ──────────────────────────────────────────────────────────────
  function _apriCambioStato(id) {
    const wo = _lista.find(w => w.id === id);
    if (!wo) return;
    _cambioStatoId = id;
    _cambioStatoScelto = null;
    document.getElementById('wop-stato-codice').textContent = wo.codice;
    document.getElementById('wop-note-chiusura-input').value = '';
    document.getElementById('wop-note-chiusura-wrap').style.display = 'none';

    const opzioni = [
      { val: 'aperto',     icon: '🔵', name: 'Aperto',     desc: 'Il WO è stato aperto ma non ancora preso in carico.' },
      { val: 'in_corso',   icon: '🟡', name: 'In corso',   desc: 'Intervento in corso — qualcuno sta lavorando su questo WO.' },
      { val: 'completato', icon: '🟢', name: 'Completato', desc: 'Intervento terminato con successo.' },
      { val: 'annullato',  icon: '⚫', name: 'Annullato',  desc: 'WO annullato — non verrà eseguito.' },
    ].filter(o => o.val !== wo.stato);

    document.getElementById('wop-stato-options').innerHTML = opzioni.map(o => `
      <div class="stato-option" onclick="WoPanel._selezionaStato('${o.val}', this)">
        <span class="stato-icon">${o.icon}</span>
        <div class="stato-info">
          <div class="stato-name">${o.name}</div>
          <div class="stato-desc">${o.desc}</div>
        </div>
      </div>`).join('');

    _apriModal(MODAL_STATO_ID);
  }

  function _apriCambioStatoDaDettaglio() {
    _chiudiModal(MODAL_DET_ID);
    if (_corrente) _apriCambioStato(_corrente.id);
  }

  function _selezionaStato(val, el) {
    _cambioStatoScelto = val;
    document.querySelectorAll('#wop-stato-options .stato-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    const noteWrap = document.getElementById('wop-note-chiusura-wrap');
    noteWrap.style.display = ['completato', 'annullato'].includes(val) ? '' : 'none';
  }

  async function _confermaCambioStato() {
    if (!_cambioStatoScelto) { alert('Seleziona un nuovo stato.'); return; }
    const payload = { stato: _cambioStatoScelto };
    const note = document.getElementById('wop-note-chiusura-input').value.trim();
    if (note) payload.note_chiusura = note;
    try {
      await API.updateWorkOrder(_cambioStatoId, payload);
      _chiudiModal(MODAL_STATO_ID);
      await _carica();
      if (_opts.onSave) _opts.onSave();
    } catch (e) { alert('Errore cambio stato: ' + e.message); }
  }

  function _chiudiStato() { _chiudiModal(MODAL_STATO_ID); }

  // ── Elimina ───────────────────────────────────────────────────────────────────
  function _elimina(id) {
    const wo = _lista.find(w => w.id === id);
    if (!wo) return;
    if (typeof showConfirm === 'function') {
      showConfirm(`Eliminare il work order <strong>${wo.codice}</strong>?<br><small>${wo.titolo}</small>`, async () => {
        await API.deleteWorkOrder(id);
        await _carica();
        if (_opts.onSave) _opts.onSave();
      });
    } else if (confirm(`Eliminare il work order ${wo.codice}?`)) {
      API.deleteWorkOrder(id).then(() => _carica()).then(() => { if (_opts.onSave) _opts.onSave(); });
    }
  }

  // ── API pubblica ──────────────────────────────────────────────────────────────
  /**
   * Monta il pannello WO nel container specificato.
   *
   * @param {HTMLElement} containerEl - Elemento DOM che conterrà la lista WO
   * @param {object} opts
   * @param {number|null}   opts.assetId   - Filtra per asset (null = tutti)
   * @param {string|null}   opts.assetNome - Nome asset per il titolo contestuale
   * @param {number}        opts.zIndex    - z-index base per le modali (default 1000)
   * @param {function|null} opts.onSave    - Callback dopo ogni salvataggio/eliminazione
   * @param {boolean}       opts.readonly  - Se true, nasconde i controlli di scrittura
   */
  /**
   * mount(containerEl, opts)
   * Se containerEl è null, inietta solo le modali CRUD senza renderizzare la lista.
   * Utile nelle pagine standalone che hanno già la propria tabella.
   */
  function mount(containerEl, opts = {}) {
    _container = containerEl;
    _opts = {
      assetId:   opts.assetId   ?? null,
      assetNome: opts.assetNome ?? null,
      zIndex:    opts.zIndex    ?? 1000,
      onSave:    opts.onSave    ?? null,
      readonly:  opts.readonly  ?? false,
    };
    _injectModals(_opts.zIndex);
    if (_container) _carica();
  }

  /** Ricarica la lista (utile dopo operazioni esterne) */
  function refresh() { return _carica(); }

  return {
    mount,
    refresh,
    // Esposti per i handler inline negli onclick
    _apriNuovo,
    _apriModifica,
    _apriModificaDaDettaglio,
    _chiudiForm,
    _salva,
    _apriDettaglio,
    _chiudiDettaglio,
    _apriCambioStato,
    _apriCambioStatoDaDettaglio,
    _selezionaStato,
    _confermaCambioStato,
    _chiudiStato,
    _elimina,
  };
})();
