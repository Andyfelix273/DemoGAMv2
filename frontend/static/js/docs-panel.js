/**
 * docs-panel.js — Pannello Documenti riutilizzabile
 * GIS Asset Manager v2.0 — KeyBiz
 *
 * Espone l'oggetto globale `DocsPanel` con il metodo:
 *
 *   DocsPanel.mount(containerEl, opts)
 *
 * Parametri opts:
 *   assetId   {number|null}  — se presente, filtra i documenti per quell'asset
 *   assetNome {string|null}  — nome asset per il titolo contestuale
 *   zIndex    {number}       — z-index base per le modali (default 1000; usare 1100 dentro modale asset)
 *   onSave    {function}     — callback opzionale dopo ogni upload/eliminazione
 *   readonly  {boolean}      — se true, nasconde i controlli di upload/eliminazione
 */
/* global API */
const DocsPanel = (() => {
  // ── Costanti ─────────────────────────────────────────────────────────────────
  const MODAL_UPLOAD_ID = 'docp-modal-upload';
  const MODAL_PDF_ID    = 'docp-modal-pdf';

  // ── Stato interno ─────────────────────────────────────────────────────────────
  let _container     = null;
  let _opts          = {};
  let _lista         = [];
  let _listaFiltrata = [];
  let _fileScelto    = null;
  let _assetsCache   = [];
  const _uid = 'docp_' + Math.random().toString(36).slice(2, 7);

  // ── Utility ───────────────────────────────────────────────────────────────────
  function fmtDim(bytes) {
    if (!bytes || bytes === 0) return '–';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function fmtData(s) {
    if (!s) return '–';
    return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function _tipoDoc(mime, nomeFile) {
    const nm = (nomeFile || '').toLowerCase();
    const m  = (mime || '').toLowerCase();
    if (m.includes('pdf') || nm.endsWith('.pdf'))   return 'pdf';
    if (m.includes('word') || nm.endsWith('.docx') || nm.endsWith('.doc')) return 'word';
    if (m.includes('excel') || m.includes('spreadsheet') || nm.endsWith('.xlsx') || nm.endsWith('.xls')) return 'excel';
    if (m.includes('image') || nm.endsWith('.png') || nm.endsWith('.jpg') || nm.endsWith('.jpeg')) return 'immagine';
    return 'altro';
  }
  function mimeBadge(mime, nomeFile) {
    const t = _tipoDoc(mime, nomeFile);
    const map = {
      pdf:      '<span class="mime-badge mime-pdf"><i class="fa fa-file-pdf"></i> PDF</span>',
      word:     '<span class="mime-badge mime-word"><i class="fa fa-file-word"></i> Word</span>',
      excel:    '<span class="mime-badge mime-xls"><i class="fa fa-file-excel"></i> Excel</span>',
      immagine: '<span class="mime-badge mime-img"><i class="fa fa-file-image"></i> Immagine</span>',
    };
    return map[t] || '<span class="mime-badge mime-other"><i class="fa fa-file"></i> File</span>';
  }
  function isPdf(mime, nomeFile) {
    return (mime || '').toLowerCase().includes('pdf') || (nomeFile || '').toLowerCase().endsWith('.pdf');
  }

  // ── Gestione modali ───────────────────────────────────────────────────────────
  function _apriModal(id) { const el = document.getElementById(id); if (el) el.classList.add('open'); }
  function _chiudiModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('open'); }

  // ── Iniezione modali nel DOM ──────────────────────────────────────────────────
  function _injectModals(zIndex) {
    if (document.getElementById(MODAL_UPLOAD_ID)) {
      [MODAL_UPLOAD_ID, MODAL_PDF_ID].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.zIndex = zIndex;
      });
      return;
    }

    const html = `
    <!-- DocsPanel: modale upload documento -->
    <div class="modal-overlay" id="${MODAL_UPLOAD_ID}" style="z-index:${zIndex}">
      <div class="modal-box" style="max-width:500px">
        <div class="modal-header">
          <h3 id="docp-upload-title">Carica documento</h3>
          <button class="btn-icon" onclick="DocsPanel._chiudiUpload()" title="Chiudi"><i class="fa fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div id="docp-asset-wrap" class="form-group">
            <label>Asset *</label>
            <select id="docp-f-asset"></select>
          </div>
          <div class="form-group">
            <label>File *</label>
            <div style="border:2px dashed var(--border-color);border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:border-color 0.2s"
                 id="docp-drop-zone"
                 onclick="document.getElementById('docp-file-input').click()"
                 ondragover="event.preventDefault();this.style.borderColor='var(--accent-blue)'"
                 ondragleave="this.style.borderColor='var(--border-color)'"
                 ondrop="DocsPanel._onDrop(event)">
              <i class="fa fa-upload" style="font-size:24px;color:var(--text-muted);display:block;margin-bottom:8px"></i>
              <div style="font-size:13px;color:var(--text-muted)">Trascina qui il file o <span style="color:var(--accent-blue)">clicca per selezionare</span></div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px">PDF, Word, Excel, immagini — max 50 MB</div>
            </div>
            <input type="file" id="docp-file-input" style="display:none"
                   accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                   onchange="DocsPanel._onFileSelected(this.files[0])">
            <div id="docp-file-preview" style="display:none;margin-top:10px;padding:10px;background:var(--bg-secondary);border-radius:6px;font-size:13px;align-items:center;gap:8px">
              <i class="fa fa-file" style="color:var(--accent-blue)"></i>
              <span id="docp-file-name"></span>
              <span id="docp-file-size" style="color:var(--text-muted);margin-left:auto"></span>
            </div>
          </div>
          <div id="docp-upload-error" class="form-error"></div>
          <div id="docp-upload-progress" style="display:none;margin-top:8px">
            <div style="background:var(--border-color);border-radius:4px;height:4px;overflow:hidden">
              <div id="docp-progress-bar" style="height:100%;background:var(--accent-blue);width:0%;transition:width 0.3s"></div>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:center">Caricamento in corso...</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="DocsPanel._chiudiUpload()">Annulla</button>
          <button class="btn btn-primary" id="docp-upload-btn" onclick="DocsPanel._eseguiUpload()"><i class="fa fa-upload"></i> Carica</button>
        </div>
      </div>
    </div>

    <!-- DocsPanel: viewer PDF inline -->
    <div class="modal-overlay" id="${MODAL_PDF_ID}" style="z-index:${zIndex + 10}">
      <div class="modal-box" style="max-width:900px;height:90vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <h3 id="docp-pdf-title">Anteprima documento</h3>
          <div style="display:flex;gap:8px">
            <a id="docp-pdf-download" class="btn btn-secondary btn-sm" target="_blank" download>
              <i class="fa fa-download"></i> Scarica
            </a>
            <button class="btn-icon" onclick="DocsPanel._chiudiPdf()" title="Chiudi"><i class="fa fa-xmark"></i></button>
          </div>
        </div>
        <div style="flex:1;overflow:hidden">
          <iframe id="docp-pdf-iframe" style="width:100%;height:100%;border:none"></iframe>
        </div>
      </div>
    </div>`;

    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        _chiudiModal(MODAL_PDF_ID);
        _chiudiModal(MODAL_UPLOAD_ID);
      }
    });
  }

  // ── Caricamento asset per il select ──────────────────────────────────────────
  async function _caricaAssets() {
    if (_assetsCache.length === 0) {
      const geo = await API.getAssets();
      _assetsCache = (geo.features || []).map(f => f.properties);
    }
    const sel = document.getElementById('docp-f-asset');
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
        _lista = await API.getAssetDocuments(_opts.assetId);
      } else {
        _lista = await API.getDocuments();
      }
      _listaFiltrata = [..._lista];
      _render();
    } catch (e) {
      _container.innerHTML = `<p style="color:var(--accent-red);font-size:13px"><i class="fa fa-exclamation-circle"></i> Errore caricamento: ${e.message}</p>`;
    }
  }

  // ── Filtro client-side ────────────────────────────────────────────────────────
  function _filtra() {
    const q    = (document.getElementById(_uid + '_q')?.value   || '').toLowerCase();
    const tipo = (document.getElementById(_uid + '_tipo')?.value || '');
    _listaFiltrata = _lista.filter(doc => {
      if (tipo && _tipoDoc(doc.mime_type, doc.nome_file) !== tipo) return false;
      if (q && ![doc.nome_file, doc.caricato_da, doc.asset_nome]
        .some(v => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    _renderRighe();
  }

  // ── Render righe tbody ────────────────────────────────────────────────────────
  function _renderRighe() {
    const canDelete = !_opts.readonly && API.can('documents.delete');
    const tbody = document.getElementById(_uid + '_tbody');
    const count = document.getElementById(_uid + '_count');
    if (!tbody) return;
    const n = _listaFiltrata.length;
    if (count) count.textContent = `${n} document${n === 1 ? 'o' : 'i'}${_opts.assetNome ? ` — ${_opts.assetNome}` : ''}`;
    if (n === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted)">Nessun documento trovato</td></tr>`;
      return;
    }
    tbody.innerHTML = _listaFiltrata.map(doc => {
      const pdfPreview = isPdf(doc.mime_type, doc.nome_file)
        ? `<button class="btn-icon" title="Anteprima PDF" onclick="DocsPanel._apriPdf(${doc.id}, '${(doc.nome_file || '').replace(/'/g, "\\'")}')"><i class="fa fa-eye"></i></button>`
        : '';
      return `
        <tr>
          <td>${mimeBadge(doc.mime_type, doc.nome_file)}</td>
          <td style="max-width:280px">
            <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${doc.nome_file || ''}">${doc.nome_file || '—'}</div>
            ${!_opts.assetId ? `<div style="font-size:11px;color:var(--text-muted)">${doc.asset_nome || ''}</div>` : ''}
          </td>
          <td style="font-size:12px;color:var(--text-muted)">${fmtDim(doc.dimensione_bytes)}</td>
          <td style="font-size:12px">${fmtData(doc.data_caricamento)}</td>
          <td style="font-size:12px;color:var(--text-muted)">${doc.caricato_da || '—'}</td>
          <td>
            <div class="row-actions">
              ${pdfPreview}
              <a class="btn-icon" title="Scarica" href="${API.getDocumentDownloadUrl(doc.id)}" target="_blank" download>
                <i class="fa fa-download"></i>
              </a>
              ${canDelete ? `<button class="btn-icon danger" title="Elimina" onclick="DocsPanel._elimina(${doc.id}, '${(doc.nome_file || '').replace(/'/g, "\\'")}')"><i class="fa fa-trash"></i></button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // ── Render struttura completa ─────────────────────────────────────────────────
  function _render() {
    if (!_container) return;
    const canUpload = !_opts.readonly && API.can('documents.create');

    if (_lista.length === 0) {
      _container.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text-muted)">
          <i class="fa fa-folder-open" style="font-size:28px;opacity:0.3;display:block;margin-bottom:8px"></i>
          <div style="font-size:13px">Nessun documento${_opts.assetNome ? ' per questo asset' : ''}</div>
          ${canUpload ? `<button class="btn btn-primary" style="margin-top:12px" onclick="DocsPanel._apriUpload()"><i class="fa fa-upload"></i> Carica documento</button>` : ''}
        </div>`;
      return;
    }

    const n = _lista.length;
    _container.innerHTML = `
      <div class="filtri-bar">
        <input type="text" id="${_uid}_q" placeholder="Cerca nome file, caricato da..." oninput="DocsPanel._filtra()" style="flex:1;min-width:160px">
        <select id="${_uid}_tipo" onchange="DocsPanel._filtra()">
          <option value="">Tutti i tipi</option>
          <option value="pdf">PDF</option>
          <option value="word">Word</option>
          <option value="excel">Excel</option>
          <option value="immagine">Immagine</option>
          <option value="altro">Altro</option>
        </select>
        <span class="record-count" id="${_uid}_count">${n} document${n === 1 ? 'o' : 'i'}${_opts.assetNome ? ` — ${_opts.assetNome}` : ''}</span>
        ${canUpload ? `<button class="btn btn-primary" onclick="DocsPanel._apriUpload()"><i class="fa fa-upload"></i> Carica documento</button>` : ''}
      </div>
      <div style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th style="width:80px">Tipo</th>
              <th>Nome file${!_opts.assetId ? ' / Asset' : ''}</th>
              <th>Dimensione</th><th>Caricato il</th><th>Caricato da</th><th></th>
            </tr>
          </thead>
          <tbody id="${_uid}_tbody"></tbody>
        </table>
      </div>`;

    _renderRighe();
  }

  // ── Upload ────────────────────────────────────────────────────────────────────
  async function _apriUpload() {
    _fileScelto = null;
    document.getElementById('docp-file-name').textContent = '';
    document.getElementById('docp-file-preview').style.display = 'none';
    document.getElementById('docp-upload-error').textContent = '';
    document.getElementById('docp-upload-progress').style.display = 'none';
    document.getElementById('docp-progress-bar').style.width = '0%';
    document.getElementById('docp-file-input').value = '';

    const assetWrap = document.getElementById('docp-asset-wrap');
    if (_opts.assetId) {
      assetWrap.style.display = 'none';
      await _caricaAssets();
      document.getElementById('docp-f-asset').value = _opts.assetId;
    } else {
      assetWrap.style.display = '';
      await _caricaAssets();
    }
    _apriModal(MODAL_UPLOAD_ID);
  }

  function _onFileSelected(file) {
    if (!file) return;
    _fileScelto = file;
    document.getElementById('docp-file-name').textContent = file.name;
    document.getElementById('docp-file-size').textContent = fmtDim(file.size);
    document.getElementById('docp-file-preview').style.display = 'flex';
  }

  function _onDrop(event) {
    event.preventDefault();
    document.getElementById('docp-drop-zone').style.borderColor = 'var(--border-color)';
    const file = event.dataTransfer.files[0];
    if (file) _onFileSelected(file);
  }

  async function _eseguiUpload() {
    const errEl = document.getElementById('docp-upload-error');
    if (!_fileScelto) { errEl.textContent = 'Seleziona un file da caricare.'; return; }
    errEl.textContent = '';

    const assetId = _opts.assetId
      ? _opts.assetId
      : parseInt(document.getElementById('docp-f-asset').value);

    const btn = document.getElementById('docp-upload-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Caricamento...';
    document.getElementById('docp-upload-progress').style.display = '';
    document.getElementById('docp-progress-bar').style.width = '60%';

    try {
      await API.uploadDocument(assetId, _fileScelto);
      document.getElementById('docp-progress-bar').style.width = '100%';
      setTimeout(() => {
        _chiudiModal(MODAL_UPLOAD_ID);
        _carica();
        if (_opts.onSave) _opts.onSave();
      }, 400);
    } catch (e) {
      errEl.textContent = 'Errore upload: ' + e.message;
      document.getElementById('docp-upload-progress').style.display = 'none';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-upload"></i> Carica';
      _fileScelto = null;
    }
  }

  function _chiudiUpload() { _chiudiModal(MODAL_UPLOAD_ID); }

  // ── Viewer PDF ────────────────────────────────────────────────────────────────
  function _apriPdf(docId, nomeFile) {
    const url = API.getDocumentDownloadUrl(docId);
    document.getElementById('docp-pdf-title').textContent = nomeFile || 'Anteprima documento';
    document.getElementById('docp-pdf-iframe').src = url;
    document.getElementById('docp-pdf-download').href = url;
    document.getElementById('docp-pdf-download').download = nomeFile || 'documento.pdf';
    _apriModal(MODAL_PDF_ID);
  }

  function _chiudiPdf() {
    document.getElementById('docp-pdf-iframe').src = '';
    _chiudiModal(MODAL_PDF_ID);
  }

  // ── Elimina ───────────────────────────────────────────────────────────────────
  function _elimina(id, nomeFile) {
    if (typeof showConfirm === 'function') {
      showConfirm(`Eliminare il documento <strong>${nomeFile}</strong>?`, async () => {
        await API.deleteDocument(id);
        await _carica();
        if (_opts.onSave) _opts.onSave();
      });
    } else if (confirm(`Eliminare il documento "${nomeFile}"?`)) {
      API.deleteDocument(id).then(() => _carica()).then(() => { if (_opts.onSave) _opts.onSave(); });
    }
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
    _injectModals(_opts.zIndex);
    if (_container) _carica();
  }

  function refresh() { return _carica(); }

  return {
    mount,
    refresh,
    _filtra,
    _apriUpload,
    _onFileSelected,
    _onDrop,
    _eseguiUpload,
    _chiudiUpload,
    _apriPdf,
    _chiudiPdf,
    _elimina,
  };
})();
