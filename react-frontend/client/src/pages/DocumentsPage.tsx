/**
 * DocumentsPage — Pagina standalone Documenti
 * Riusa la logica di DocumentsModal in un layout a pagina intera.
 * In modalità standalone non è possibile caricare documenti senza selezionare un asset.
 */
import { useState, useRef } from 'react';
import { documents, exports } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { KpiCard } from '@/components/shared/KpiCard';
import { LoadingSpinner, EmptyState, ErrorState, FilterBar, ConfirmDialog } from '@/components/shared/Primitives';
import { formatDate, formatBytes } from '@/lib/utils';
import { DOCUMENTO_CATEGORIA_LABEL } from '@/lib/constants';
import { FileText, Download, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { Documento } from '@/lib/types';

export default function DocumentsPage() {
  const [search, setSearch] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Documento | null>(null);

  const { data, loading, error, refetch } = useApi(
    () => documents.list(filterCategoria ? { categoria: filterCategoria } : undefined),
    [filterCategoria],
  );

  const { mutate: deleteDoc, loading: deleting } = useApiMutation(documents.delete);

  const allDocs: Documento[] = data ?? [];

  // KPI per categoria
  const nContratti    = allDocs.filter(d => d.categoria === 'contratto').length;
  const nCertificati  = allDocs.filter(d => d.categoria === 'certificato').length;
  const nPlanimetrie  = allDocs.filter(d => d.categoria === 'planimetria').length;
  const nAltri        = allDocs.filter(d => !['contratto', 'certificato', 'planimetria'].includes(d.categoria)).length;

  const filtered = allDocs.filter(d =>
    !search ||
    d.nome.toLowerCase().includes(search.toLowerCase()) ||
    (d.note ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (d.asset_nome ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDoc(deleteTarget.id);
      toast.success('Documento eliminato');
      setDeleteTarget(null);
      refetch();
    } catch {
      toast.error('Errore eliminazione documento');
    }
  }

  const categorieOptions = Object.entries(DOCUMENTO_CATEGORIA_LABEL).map(([v, l]) => ({ value: v, label: l }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* KPI bar */}
      <div className="shrink-0 grid grid-cols-4 gap-3 px-4 py-3 border-b border-[var(--gam-border)]">
        <KpiCard
          label="Totale documenti"
          value={allDocs.length}
          icon={<FileText size={14} />}
          variant="default"
        />
        <KpiCard
          label="Contratti"
          value={nContratti}
          icon={<FileText size={14} />}
          variant="default"
        />
        <KpiCard
          label="Certificati"
          value={nCertificati}
          icon={<FileText size={14} />}
          variant="default"
        />
        <KpiCard
          label="Planimetrie"
          value={nPlanimetrie}
          icon={<FileText size={14} />}
          variant="default"
        />
      </div>

      {/* Contenuto principale */}
      <div className="flex-1 overflow-hidden flex flex-col px-4 py-3 gap-3">
        {/* Header azioni + filtri */}
        <div className="shrink-0 flex items-center gap-3">
          <div className="flex-1">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Cerca documento…' }}
              filters={[
                { key: 'categoria', label: 'Categoria', options: categorieOptions, value: filterCategoria, onChange: setFilterCategoria },
              ]}
            />
          </div>
          <a
            href={exports.documentsExcel()}
            className="flex items-center gap-1.5 text-xs text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors shrink-0"
            title="Esporta Excel"
          >
            <ExternalLink size={13} />
            Excel
          </a>
        </div>

        {/* Tabella */}
        <div className="flex-1 overflow-y-auto gam-card">
          {loading && <LoadingSpinner label="Caricamento documenti…" />}
          {error && <ErrorState message={error} onRetry={refetch} />}
          {!loading && !error && filtered.length === 0 && (
            <EmptyState
              icon={<FileText size={36} />}
              title="Nessun documento"
              description={search ? 'Nessun risultato per la ricerca' : 'Non ci sono documenti caricati'}
            />
          )}
          {!loading && !error && filtered.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gam-border)]">
                  <th className="gam-label text-left py-2 px-4">Nome</th>
                  <th className="gam-label text-left py-2 pr-3">Asset</th>
                  <th className="gam-label text-left py-2 pr-3">Categoria</th>
                  <th className="gam-label text-left py-2 pr-3">Dimensione</th>
                  <th className="gam-label text-left py-2 pr-3">Data</th>
                  <th className="gam-label text-right py-2 pr-4">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(doc => (
                  <tr
                    key={doc.id}
                    className="border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50 transition-colors"
                  >
                    <td className="py-2 px-4 text-[var(--gam-text-primary)]">
                      <div className="flex items-center gap-1.5">
                        <FileText size={12} className="text-[var(--gam-text-muted)] shrink-0" />
                        <span title={doc.nome} className="font-medium">{doc.nome}</span>
                      </div>
                      {doc.note && (
                        <p className="text-[var(--gam-text-muted)] text-[10px] mt-0.5 max-w-xs truncate">{doc.note}</p>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">
                      {doc.asset_nome ?? '–'}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge type="documento-categoria" value={doc.categoria} />
                    </td>
                    <td className="py-2 pr-3 text-[var(--gam-text-secondary)] font-mono">
                      {formatBytes(doc.dimensione_bytes)}
                    </td>
                    <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={documents.downloadUrl(doc.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--gam-accent)] hover:text-[var(--gam-accent-hover)] transition-colors"
                          title="Scarica"
                        >
                          <Download size={13} />
                        </a>
                        <button
                          onClick={() => setDeleteTarget(doc)}
                          className="text-[var(--gam-text-muted)] hover:text-[var(--gam-danger)] transition-colors"
                          title="Elimina"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        {!loading && data && (
          <div className="shrink-0 text-[10px] text-[var(--gam-text-muted)]">
            {filtered.length} / {allDocs.length} documenti
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title="Elimina documento"
        description={`Eliminare "${deleteTarget?.nome}"? L'operazione non è reversibile.`}
        confirmLabel={deleting ? 'Eliminazione…' : 'Elimina'}
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
