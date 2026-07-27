/**
 * DocumentsModal — gestione documenti GAM
 * Usata sia come pagina standalone che filtrata per asset (tab Documenti).
 * Props:
 *   assetId?  → se presente, mostra solo i documenti di quell'asset
 *   assetNome? → usato nel titolo quando filtrata per asset
 */
import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { documents, exports } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSpinner, EmptyState, ErrorState, FilterBar, ConfirmDialog } from '@/components/shared/Primitives';
import { formatDate, formatBytes, truncate } from '@/lib/utils';
import { DOCUMENTO_CATEGORIA_LABEL } from '@/lib/constants';
import { Download, Trash2, Upload, FileText, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { Documento } from '@/lib/types';

interface DocumentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se presente, filtra per asset */
  assetId?: number;
  assetNome?: string;
}

export function DocumentsModal({ open, onOpenChange, assetId, assetNome }: DocumentsModalProps) {
  const [search, setSearch] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Documento | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const fetcher = useCallback(() =>
    assetId
      ? documents.byAsset(assetId)
      : documents.list(filterCategoria ? { categoria: filterCategoria } : undefined),
    [assetId, filterCategoria],
  );

  const { data, loading, error, refetch } = useApi(fetcher, [assetId, filterCategoria], open);

  const { mutate: deleteDoc, loading: deleting } = useApiMutation(documents.delete);

  const filtered = (data ?? []).filter(d =>
    !search ||
    d.nome.toLowerCase().includes(search.toLowerCase()) ||
    (d.note ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDoc(deleteTarget.id);
      toast.success('Documento eliminato');
      setDeleteTarget(null);
      refetch();
    } catch (e) {
      toast.error('Errore eliminazione documento');
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !assetId) return;
    setUploading(true);
    try {
      await documents.upload(assetId, file);
      toast.success('Documento caricato');
      refetch();
    } catch {
      toast.error('Errore caricamento documento');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const title = assetNome
    ? `Documenti — ${assetNome}`
    : 'Gestione Documenti';

  const categorieOptions = Object.entries(DOCUMENTO_CATEGORIA_LABEL).map(([v, l]) => ({ value: v, label: l }));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[var(--gam-bg-secondary)] border-[var(--gam-border)] max-w-3xl w-full max-h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--gam-border)]">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[var(--gam-text-primary)] font-display text-base">
                <FileText size={15} className="inline mr-2 text-[var(--gam-accent)]" />
                {title}
              </DialogTitle>
              <div className="flex items-center gap-2">
                {assetId && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={handleUpload}
                    />
                    <button
                      className="gam-btn-primary flex items-center gap-1.5 text-xs"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      <Upload size={12} />
                      {uploading ? 'Caricamento…' : 'Carica'}
                    </button>
                  </>
                )}
                <a
                  href={exports.documentsExcel()}
                  className="flex items-center gap-1.5 text-xs text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors"
                  title="Esporta Excel"
                >
                  <ExternalLink size={13} />
                  Excel
                </a>
              </div>
            </div>
          </DialogHeader>

          {/* Filtri */}
          <div className="px-5 py-3 border-b border-[var(--gam-border)]">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Cerca documento…' }}
              filters={[
                {
                  key: 'categoria',
                  label: 'Categoria',
                  options: categorieOptions,
                  value: filterCategoria,
                  onChange: setFilterCategoria,
                },
              ]}
            />
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
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
                    <th className="gam-label text-left py-2 pr-3">Nome</th>
                    <th className="gam-label text-left py-2 pr-3">Categoria</th>
                    <th className="gam-label text-left py-2 pr-3">Dimensione</th>
                    <th className="gam-label text-left py-2 pr-3">Data</th>
                    <th className="gam-label text-right py-2">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(doc => (
                    <tr key={doc.id} className="border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50 transition-colors">
                      <td className="py-2 pr-3 text-[var(--gam-text-primary)]">
                        <div className="flex items-center gap-1.5">
                          <FileText size={12} className="text-[var(--gam-text-muted)] shrink-0" />
                          <span title={doc.nome}>{truncate(doc.nome, 35)}</span>
                        </div>
                        {doc.note && <p className="text-[var(--gam-text-muted)] text-[10px] mt-0.5">{truncate(doc.note, 50)}</p>}
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
                      <td className="py-2 text-right">
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
            <div className="px-5 py-2 border-t border-[var(--gam-border)] text-[10px] text-[var(--gam-text-muted)]">
              {filtered.length} / {data.length} documenti
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title="Elimina documento"
        description={`Eliminare "${deleteTarget?.nome}"? L'operazione non è reversibile.`}
        confirmLabel={deleting ? 'Eliminazione…' : 'Elimina'}
        variant="danger"
        onConfirm={handleDelete}
      />
    </>
  );
}
