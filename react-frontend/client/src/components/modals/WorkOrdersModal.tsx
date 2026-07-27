/**
 * WorkOrdersModal — gestione work orders GAM
 * Usata sia come pagina standalone che filtrata per asset (tab WO).
 */
import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { workOrders, exports } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSpinner, EmptyState, ErrorState, FilterBar, ConfirmDialog, SectionTitle } from '@/components/shared/Primitives';
import { formatDate, formatDateTime, truncate } from '@/lib/utils';
import { WO_STATO_LABEL, WO_PRIORITA_LABEL } from '@/lib/constants';
import { Wrench, Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkOrder } from '@/lib/types';
import { WOFormModal } from './WOFormModal';

interface WorkOrdersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId?: number;
  assetNome?: string;
}

export function WorkOrdersModal({ open, onOpenChange, assetId, assetNome }: WorkOrdersModalProps) {
  const [search, setSearch] = useState('');
  const [filterStato, setFilterStato] = useState('');
  const [filterPriorita, setFilterPriorita] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);
  const [editTarget, setEditTarget] = useState<WorkOrder | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetcher = useCallback(() =>
    assetId
      ? workOrders.byAsset(assetId)
      : workOrders.list({
          ...(filterStato ? { stato: filterStato } : {}),
          ...(filterPriorita ? { priorita: filterPriorita } : {}),
        }),
    [assetId, filterStato, filterPriorita],
  );

  const { data, loading, error, refetch } = useApi(fetcher, [assetId, filterStato, filterPriorita], open);
  const { mutate: deleteWO, loading: deleting } = useApiMutation(workOrders.delete);

  const filtered = (data ?? []).filter(wo =>
    !search ||
    wo.titolo.toLowerCase().includes(search.toLowerCase()) ||
    (wo.descrizione ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (wo.assegnato_a ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteWO(deleteTarget.id);
      toast.success('Work Order eliminato');
      setDeleteTarget(null);
      refetch();
    } catch {
      toast.error('Errore eliminazione WO');
    }
  }

  const title = assetNome ? `Work Order — ${assetNome}` : 'Gestione Work Order';

  const statoOptions = Object.entries(WO_STATO_LABEL).map(([v, l]) => ({ value: v, label: l }));
  const prioritaOptions = Object.entries(WO_PRIORITA_LABEL).map(([v, l]) => ({ value: v, label: l }));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[var(--gam-bg-secondary)] border-[var(--gam-border)] max-w-4xl w-full max-h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--gam-border)]">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[var(--gam-text-primary)] font-display text-base">
                <Wrench size={15} className="inline mr-2 text-[var(--gam-accent)]" />
                {title}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <button
                  className="gam-btn-primary flex items-center gap-1.5 text-xs"
                  onClick={() => { setEditTarget(null); setShowForm(true); }}
                >
                  <Plus size={12} />
                  Nuovo WO
                </button>
                <a
                  href={exports.workordersExcel()}
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
              search={{ value: search, onChange: setSearch, placeholder: 'Cerca work order…' }}
              filters={[
                { key: 'stato', label: 'Stato', options: statoOptions, value: filterStato, onChange: setFilterStato },
                { key: 'priorita', label: 'Priorità', options: prioritaOptions, value: filterPriorita, onChange: setFilterPriorita },
              ]}
            />
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {loading && <LoadingSpinner label="Caricamento work orders…" />}
            {error && <ErrorState message={error} onRetry={refetch} />}
            {!loading && !error && filtered.length === 0 && (
              <EmptyState
                icon={<Wrench size={36} />}
                title="Nessun work order"
                description={search ? 'Nessun risultato per la ricerca' : 'Non ci sono work order aperti'}
              />
            )}
            {!loading && !error && filtered.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--gam-border)]">
                    <th className="gam-label text-left py-2 pr-3">Titolo</th>
                    <th className="gam-label text-left py-2 pr-3">Stato</th>
                    <th className="gam-label text-left py-2 pr-3">Priorità</th>
                    <th className="gam-label text-left py-2 pr-3">Assegnato</th>
                    <th className="gam-label text-left py-2 pr-3">Apertura</th>
                    <th className="gam-label text-right py-2">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(wo => (
                    <tr key={wo.id} className="border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50 transition-colors">
                      <td className="py-2 pr-3 text-[var(--gam-text-primary)]">
                        <p title={wo.titolo}>{truncate(wo.titolo, 40)}</p>
                        {wo.descrizione && (
                          <p className="text-[var(--gam-text-muted)] text-[10px] mt-0.5">{truncate(wo.descrizione, 50)}</p>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge type="wo-stato" value={wo.stato} dot />
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge type="wo-priorita" value={wo.priorita} />
                      </td>
                      <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">
                        {wo.assegnato_a ?? '–'}
                      </td>
                      <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">
                        {formatDate(wo.data_apertura)}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => { setEditTarget(wo); setShowForm(true); }}
                            className="text-[var(--gam-text-muted)] hover:text-[var(--gam-accent)] transition-colors"
                            title="Modifica"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(wo)}
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

          {!loading && data && (
            <div className="px-5 py-2 border-t border-[var(--gam-border)] text-[10px] text-[var(--gam-text-muted)]">
              {filtered.length} / {data.length} work orders
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Form creazione/modifica */}
      {showForm && (
        <WOFormModal
          open={showForm}
          onOpenChange={setShowForm}
          workOrder={editTarget}
          defaultAssetId={assetId}
          onSaved={() => { setShowForm(false); refetch(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title="Elimina Work Order"
        description={`Eliminare "${deleteTarget?.titolo}"? L'operazione non è reversibile.`}
        confirmLabel={deleting ? 'Eliminazione…' : 'Elimina'}
        variant="danger"
        onConfirm={handleDelete}
      />
    </>
  );
}
