/**
 * documents.js — Pagina Documenti globale
 * GIS Asset Manager v2.0 — KeyBiz
 */

if (!requireAuth()) throw new Error('not authenticated');
Tema.apply();
renderTopbar('documenti', { filtri: false });
renderSidebar('documenti');
initAlarmNotifications();
i18n.apply();

// Mostra azioni admin solo se l'utente ha il permesso
if (!API.can('documents.read')) {
  document.getElementById('admin-actions').style.display = 'none';
}

// ── Stato applicazione ────────────────────────────────────────────────────────
const PAGE_SIZE = 50;
let _tuttiDocs = [];   // tutti i documenti caricati
let _docsFiltrati = []; // dopo applicazione filtri
let _paginaCorrente = 1;

// ── Utility ───────────────────────────────────────────────────────────────────

function fmtDim(bytes) {
  if (!bytes || bytes === 0) return '–';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function fmtData(s) {
  if (!s) return '–';
  const d = new Date(s);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function mimeBadge(mime, nomeFile) {
  const nm = (nomeFile || '').toLowerCase();
  const m  = (mime || '').toLowerCase();
  if (m.includes('pdf') || nm.endsWith('.pdf'))
    return '<span class="mime-badge mime-pdf"><i class="fa fa-file-pdf-o"></i> PDF</span>';
  if (m.includes('word') || nm.endsWith('.docx') || nm.endsWith('.doc'))
    return '<span class="mime-badge mime-word"><i class="fa fa-file-word-o"></i> Word</span>';
  if (m.includes('excel') || m.includes('spreadsheet') || nm.endsWith('.xlsx') || nm.endsWith('.xls'))
    return '<span class="mime-badge mime-xls"><i class="fa fa-file-excel-o"></i> Excel</span>';
  if (m.includes('image') || nm.endsWith('.png') || nm.endsWith('.jpg') || nm.endsWith('.jpeg'))
    return '<span class="mime-badge mime-img"><i class="fa fa-file-image-o"></i> Immagine</span>';
  return '<span class="mime-badge mime-other"><i class="fa fa-file-o"></i> File</span>';
}

function isPdf(mime, nomeFile) {
  return (mime || '').toLowerCase().includes('pdf') || (nomeFile || '').toLowerCase().endsWith('.pdf');
}

// ── Caricamento dati ──────────────────────────────────────────────────────────

async function caricaStats() {
  try {
    const s = await API.request('GET', '/api/documents/stats');
    document.getElementById('kpi-totale').textContent = s.totale ?? '–';
    document.getElementById('kpi-mese').textContent   = s.questo_mese ?? '–';
    document.getElementById('kpi-asset').textContent  = s.asset_con_docs ?? '–';

    // Popola filtro anno
    const selAnno = document.getElementById('filter-anno');
    (s.anni || []).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      selAnno.appendChild(opt);
    });

    // Popola filtro caricato da
    const selCaricato = document.getElementById('filter-caricato');
    (s.caricatori || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      selCaricato.appendChild(opt);
    });
  } catch (err) {
    console.warn('[documents] Impossibile caricare le statistiche:', err.message);
  }
}

async function caricaDocumenti() {
  const tbody = document.getElementById('doc-tbody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);"><i class="fa fa-spinner fa-spin"></i> Caricamento...</td></tr>';

  try {
    const docs = await API.request('GET', '/api/documents?limit=500');
    _tuttiDocs = docs;

    // KPI PDF
    const nPdf = docs.filter(d => isPdf(d.tipo_mime, d.nome_file)).length;
    document.getElementById('kpi-pdf').textContent = nPdf;

    applicaFiltri();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--accent-red);">
      <i class="fa fa-exclamation-circle"></i> Impossibile caricare i documenti: ${err.message}
    </td></tr>`;
  }
}

// ── Filtri ────────────────────────────────────────────────────────────────────

function applicaFiltri() {
  const q        = document.getElementById('search-input').value.trim().toLowerCase();
  const anno     = document.getElementById('filter-anno').value;
  const tipo     = document.getElementById('filter-tipo').value;
  const caricato = document.getElementById('filter-caricato').value;

  _docsFiltrati = _tuttiDocs.filter(d => {
    if (q && !((d.nome_file || '').toLowerCase().includes(q) || (d.codice || '').toLowerCase().includes(q))) return false;
    if (anno && !(d.codice || '').startsWith(`DOC-${anno}-`)) return false;
    if (caricato && (d.caricato_da || '') !== caricato) return false;
    if (tipo) {
      const m = (d.tipo_mime || '').toLowerCase();
      const n = (d.nome_file || '').toLowerCase();
      if (tipo === 'pdf'   && !isPdf(d.tipo_mime, d.nome_file)) return false;
      if (tipo === 'word'  && !(m.includes('word') || n.endsWith('.doc') || n.endsWith('.docx'))) return false;
      if (tipo === 'excel' && !(m.includes('excel') || m.includes('spreadsheet') || n.endsWith('.xls') || n.endsWith('.xlsx'))) return false;
      if (tipo === 'image' && !(m.includes('image') || n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg'))) return false;
    }
    return true;
  });

  _paginaCorrente = 1;
  renderTabella();
}

// ── Rendering tabella ─────────────────────────────────────────────────────────

function renderTabella() {
  const tbody = document.getElementById('doc-tbody');
  const totale = _docsFiltrati.length;
  const inizio = (_paginaCorrente - 1) * PAGE_SIZE;
  const fine   = Math.min(inizio + PAGE_SIZE, totale);
  const pagina = _docsFiltrati.slice(inizio, fine);

  if (totale === 0) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state">
        <i class="fa fa-folder-open-o"></i>
        Nessun documento trovato.
      </div>
    </td></tr>`;
    document.getElementById('pagination').style.display = 'none';
    return;
  }

  tbody.innerHTML = pagina.map(d => {
    const dlUrl  = `/api/documents/${d.id}/download`;
    const canDel = API.can('documents.delete');
    const viewBtn = isPdf(d.tipo_mime, d.nome_file)
      ? `<button class="btn-icon" onclick="apriViewerPdf(${d.id}, '${(d.nome_file || '').replace(/'/g, "\\'")}')" title="Visualizza">
           <i class="fa fa-eye"></i>
         </button>`
      : '';
    const delBtn = canDel
      ? `<button class="btn-icon danger" onclick="eliminaDocumento(${d.id}, '${(d.nome_file || '').replace(/'/g, "\\'")}')" title="Elimina">
           <i class="fa fa-trash"></i>
         </button>`
      : '';

    return `<tr>
      <td class="doc-codice">${d.codice || '–'}</td>
      <td class="doc-nome">
        ${mimeBadge(d.tipo_mime, d.nome_file)}
        <span style="margin-left:6px;">${d.nome_file || '–'}</span>
      </td>
      <td>
        ${d.asset_id
          ? `<a class="doc-asset-link" onclick="apriModaleAsset(${d.asset_id})" title="Apri asset">
               <span style="font-family:monospace;font-size:11px;">${d.asset_codice || ''}</span>
               <span style="margin-left:4px;">${d.asset_nome || ''}</span>
             </a>`
          : '–'}
      </td>
      <td>${mimeBadge(d.tipo_mime, d.nome_file)}</td>
      <td class="doc-dim">${fmtDim(d.dimensione)}</td>
      <td class="doc-data">${fmtData(d.created_at)}</td>
      <td style="font-size:12px;color:var(--text-muted);">${d.caricato_da || '–'}</td>
      <td>
        <div class="doc-actions">
          ${viewBtn}
          <a class="btn-icon" href="${dlUrl}" download="${d.nome_file || 'documento'}" title="Scarica">
            <i class="fa fa-download"></i>
          </a>
          ${delBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Paginazione
  const totalePagine = Math.ceil(totale / PAGE_SIZE);
  if (totalePagine > 1) {
    document.getElementById('pagination').style.display = 'flex';
    document.getElementById('pg-info').textContent = `${inizio + 1}–${fine} di ${totale}`;
    document.getElementById('pg-prev').disabled = _paginaCorrente <= 1;
    document.getElementById('pg-next').disabled = _paginaCorrente >= totalePagine;
  } else {
    document.getElementById('pagination').style.display = 'none';
  }
}

// ── Viewer PDF (riutilizza la stessa logica di map-modal.js) ──────────────────

async function apriViewerPdf(docId, nomeFile) {
  const old = document.getElementById('doc-pdf-viewer-overlay');
  if (old) old.remove();

  const downloadUrl = `/api/documents/${docId}/download`;

  const overlay = document.createElement('div');
  overlay.id = 'doc-pdf-viewer-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.82)',
    'z-index:5000', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'padding:20px'
  ].join(';');

  overlay.innerHTML = `
    <div style="width:100%;max-width:960px;height:90vh;display:flex;flex-direction:column;
                background:#0D1B2A;border:1px solid #1E3A5F;
                border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:12px 18px;border-bottom:1px solid #1E3A5F;flex-shrink:0;background:#0a1628;">
        <div style="display:flex;align-items:center;gap:10px;">
          <i class="fa fa-file-pdf-o" style="color:#E74C3C;font-size:16px;"></i>
          <span style="font-size:13px;font-weight:600;color:#E0F0FF;">${nomeFile}</span>
        </div>
        <div style="display:flex;gap:8px;">
          <a id="doc-pdf-dl-link" href="#"
             style="padding:5px 12px;background:rgba(0,180,216,0.15);
                    border:1px solid #00B4D8;border-radius:5px;
                    color:#00B4D8;font-size:12px;text-decoration:none;
                    display:flex;align-items:center;gap:5px;">
            <i class="fa fa-download"></i> Scarica
          </a>
          <button onclick="document.getElementById('doc-pdf-viewer-overlay').remove()"
                  style="padding:5px 12px;background:transparent;border:1px solid #1E3A5F;
                         border-radius:5px;color:#7BAFC4;cursor:pointer;font-size:18px;line-height:1;">&times;</button>
        </div>
      </div>
      <div id="doc-pdf-content" style="flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0D1B2A;">
        <div style="text-align:center;color:#7BAFC4;">
          <i class="fa fa-spinner fa-spin" style="font-size:28px;margin-bottom:10px;display:block;"></i>
          <span style="font-size:13px;">Caricamento documento...</span>
        </div>
      </div>
    </div>`;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      if (overlay._blobUrl) URL.revokeObjectURL(overlay._blobUrl);
      overlay.remove();
    }
  });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (overlay._blobUrl) URL.revokeObjectURL(overlay._blobUrl);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  try {
    const token = API.getToken ? API.getToken() : '';
    const resp = await fetch(downloadUrl, {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    overlay._blobUrl = blobUrl;

    const dlLink = document.getElementById('doc-pdf-dl-link');
    if (dlLink) { dlLink.href = blobUrl; dlLink.download = nomeFile; }

    const contentDiv = document.getElementById('doc-pdf-content');
    if (contentDiv) {
      contentDiv.innerHTML = `<iframe src="${blobUrl}" style="width:100%;height:100%;border:none;" title="${nomeFile}"></iframe>`;
    }
  } catch (err) {
    const contentDiv = document.getElementById('doc-pdf-content');
    if (contentDiv) {
      contentDiv.innerHTML = `<div style="text-align:center;color:#E74C3C;padding:30px;">
        <i class="fa fa-exclamation-triangle" style="font-size:28px;margin-bottom:10px;display:block;"></i>
        <div style="font-size:13px;">Impossibile caricare il documento.</div>
        <div style="font-size:11px;margin-top:6px;color:#7BAFC4;">${err.message}</div>
        <a href="${downloadUrl}" target="_blank"
           style="display:inline-block;margin-top:14px;padding:6px 16px;
                  background:rgba(0,180,216,0.15);border:1px solid #00B4D8;
                  border-radius:5px;color:#00B4D8;font-size:12px;text-decoration:none;">
          <i class="fa fa-external-link"></i> Apri in nuova scheda
        </a>
      </div>`;
    }
  }
}

// ── Elimina documento ─────────────────────────────────────────────────────────

async function eliminaDocumento(docId, nomeFile) {
  if (!confirm(`Eliminare il documento "${nomeFile}"?\nL'operazione non è reversibile.`)) return;
  try {
    await API.request('DELETE', `/api/documents/${docId}`);
    _tuttiDocs = _tuttiDocs.filter(d => d.id !== docId);
    applicaFiltri();
    // Aggiorna KPI
    document.getElementById('kpi-totale').textContent = _tuttiDocs.length;
    const nPdf = _tuttiDocs.filter(d => isPdf(d.tipo_mime, d.nome_file)).length;
    document.getElementById('kpi-pdf').textContent = nPdf;
  } catch (err) {
    alert('Errore durante l\'eliminazione: ' + err.message);
  }
}

// ── Export Excel ──────────────────────────────────────────────────────────────

document.getElementById('btn-export-excel')?.addEventListener('click', () => {
  window.location.href = '/api/export/documents/excel';
});

// ── Paginazione ───────────────────────────────────────────────────────────────

document.getElementById('pg-prev')?.addEventListener('click', () => {
  if (_paginaCorrente > 1) { _paginaCorrente--; renderTabella(); }
});
document.getElementById('pg-next')?.addEventListener('click', () => {
  const totalePagine = Math.ceil(_docsFiltrati.length / PAGE_SIZE);
  if (_paginaCorrente < totalePagine) { _paginaCorrente++; renderTabella(); }
});

// ── Event listener filtri ─────────────────────────────────────────────────────

let _searchTimer = null;
document.getElementById('search-input')?.addEventListener('input', () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(applicaFiltri, 280);
});
document.getElementById('filter-anno')?.addEventListener('change', applicaFiltri);
document.getElementById('filter-tipo')?.addEventListener('change', applicaFiltri);
document.getElementById('filter-caricato')?.addEventListener('change', applicaFiltri);

document.getElementById('btn-reset-filtri')?.addEventListener('click', () => {
  document.getElementById('search-input').value = '';
  document.getElementById('filter-anno').value = '';
  document.getElementById('filter-tipo').value = '';
  document.getElementById('filter-caricato').value = '';
  applicaFiltri();
});

// ── Avvio ─────────────────────────────────────────────────────────────────────

caricaStats();
caricaDocumenti();
