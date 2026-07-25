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
  let _container   = null;
  let _opts        = {};
  let _lista       = [];
  let _assetsCache = [];

  // ── Utility ───────────────────────────────────────────────────────────────────
  function fmtData(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function diffGiorni(dataStr) {
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const scad = new Date(dataStr);
    return Math.ceil((scad - oggi) / 86400000);
  }
  function badgeStato(stato) {
    const col = STATO_COLOR[stato] || 'var(--text-muted)';
    const label = { aperta: 'Aperta', chiusa: 'Chiusa', scaduta: 'Scaduta' }[stato] || stato;
    return `<span style="background:${col}22;color:${col};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${label}</span>`;
  }
  function badgePrio(prio) {
    const col = PRIO_COLOR[prio] || 'var(--text-muted)';
    return `<span style="color:${col};font-size:11px;font-weight:700">${(prio || '').toUpperCase()}</span>`;
  }

  // ── Gestione modale ───────────────────────────────────────────────────────────
  function _getModal() { return document.getElementById(MODAL_FORM_ID); }
  function _apriModal() {
    const el = _getModal();
    if (el) el.classList.add('open');
  }
  function _chiudiModal() {
    const el = _getModal();
    if (el) el.classList.remove('open');
  }

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

  // ── Caricamento e render ──────────────────────────────────────────────────────
  async function _carica() {
    if (!_container) return;
    _container.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
    try {
      if (_opts.assetId) {
        _lista = await API.getAssetDeadlines(_opts.assetId);
      } else {
        _lista = await API.getDeadlines();
      }
      _render();
    } catch (e) {
      _container.innerHTML = `<p style="color:var(--accent-red);font-size:13px"><i class="fa fa-exclamation-circle"></i> Errore caricamento: ${e.message}</p>`;
    }
  }

  function _render() {
    if (!_container) return;
    const canCreate = !_opts.readonly && API.can('deadlines.create');
    const canEdit   = !_opts.readonly && API.can('deadlines.update');
    const canDelete = !_opts.readonly && API.can('deadlines.delete');

    if (_lista.length === 0) {
      _container.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text-muted)">
          <i class="fa fa-calendar-check" style="font-size:28px;opacity:0.3;display:block;margin-bottom:8px"></i>
          <div style="font-size:13px">Nessuna scadenza${_opts.assetNome ? ' per questo asset' : ''}</div>
          ${canCreate ? `<button class="btn btn-primary" style="margin-top:12px" onclick="DeadlinesPanel._apriNuova()"><i class="fa fa-plus"></i> Nuova scadenza</button>` : ''}
        </div>`;
      return;
    }

    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);

    const righe = _lista.map(d => {
      const scad = new Date(d.data_scadenza);
      const giorni = Math.ceil((scad - oggi) / 86400000);
      const isScaduta = d.stato === 'scaduta' || (d.stato === 'aperta' && giorni < 0);
      const isUrgente = d.stato === 'aperta' && giorni >= 0 && giorni <= 7;
      const tipoIcon  = TIPO_ICON[d.tipo] || 'fa-clock';
      const prioCol   = PRIO_COLOR[d.priorita] || 'var(--text-muted)';

      let giorniLabel = '';
      if (d.stato !== 'chiusa') {
        giorniLabel = giorni < 0
          ? `<span style="color:var(--accent-red);font-size:11px;font-weight:600">${Math.abs(giorni)}gg scaduta</span>`
          : giorni <= 7
            ? `<span style="color:var(--accent-orange);font-size:11px;font-weight:600">${giorni}gg</span>`
            : `<span style="color:var(--text-muted);font-size:11px">${giorni}gg</span>`;
      }

      const rowBg = isScaduta ? 'rgba(248,81,73,0.04)' : isUrgente ? 'rgba(210,153,34,0.04)' : '';

      return `
        <tr style="background:${rowBg}">
          <td><i class="fa ${tipoIcon}" style="color:${prioCol};font-size:14px" title="${d.tipo || ''}"></i></td>
          <td>
            <div style="font-weight:500;font-size:13px">${d.titolo}</div>
            ${!_opts.assetId ? `<div style="font-size:11px;color:var(--text-muted)">${d.asset_nome || ''}</div>` : ''}
          </td>
          <td>${badgePrio(d.priorita)}</td>
          <td>${badgeStato(isScaduta && d.stato !== 'chiusa' ? 'scaduta' : d.stato)}</td>
          <td style="font-size:12px">${fmtData(d.data_scadenza)}</td>
          <td>${giorniLabel}</td>
          <td style="font-size:12px">${d.assegnatario || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td>
            <div class="row-actions">
              ${canEdit && d.stato === 'aperta' ? `<button class="btn-icon" title="Segna chiusa" onclick="DeadlinesPanel._chiudiScadenza(${d.id})"><i class="fa fa-circle-check"></i></button>` : ''}
              ${canEdit   ? `<button class="btn-icon" title="Modifica" onclick="DeadlinesPanel._apriModifica(${d.id})"><i class="fa fa-pen"></i></button>` : ''}
              ${canDelete ? `<button class="btn-icon danger" title="Elimina" onclick="DeadlinesPanel._elimina(${d.id})"><i class="fa fa-trash"></i></button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');

    const colAsset = !_opts.assetId ? '<th>Asset</th>' : '';
    _container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--text-muted)">${_lista.length} scadenz${_lista.length === 1 ? 'a' : 'e'}${_opts.assetNome ? ` — ${_opts.assetNome}` : ''}</span>
        ${canCreate ? `<button class="btn btn-primary" onclick="DeadlinesPanel._apriNuova()"><i class="fa fa-plus"></i> Nuova scadenza</button>` : ''}
      </div>
      <div style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th style="width:32px"></th><th>Titolo${!_opts.assetId ? ' / Asset' : ''}</th>
              <th>Priorità</th><th>Stato</th><th>Scadenza</th><th>Giorni</th>
              <th>Assegnatario</th><th></th>
            </tr>
          </thead>
          <tbody>${righe}</tbody>
        </table>
      </div>`;
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

  // ── API pubblica ──────────────────────────────────────────────────────────────
  /**
   * mount(containerEl, opts)
   * Se containerEl è null, inietta solo la modale CRUD senza renderizzare la lista.
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
    _injectModal(_opts.zIndex);
    if (_container) _carica();
  }

  function refresh() { return _carica(); }

  return {
    mount,
    refresh,
    _apriNuova,
    _apriModifica,
    _chiudi,
    _salva,
    _chiudiScadenza,
    _elimina,
  };
})();
