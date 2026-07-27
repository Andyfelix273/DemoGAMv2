/**
 * DeadlinesModal — gestione scadenze GAM
 * Usata sia come pagina standalone che filtrata per asset (tab Scadenze).
 */
import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deadlines, exports } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSpinner, EmptyState, ErrorState, FilterBar, ConfirmDialog } from '@/components/shared/Primitives';
import { formatDate, daysUntil, truncate } from '@/lib/utils';
import { SCADENZA_TIPO_LABEL } from '@/lib/constants';
import { CalendarClock, Plus, Pencil, Trash2, ExternalLink, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { Scadenza } from '@/lib/types';
import { DeadlineFormModal } from './DeadlineFormModal';

interface DeadlinesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId?: number;
  assetNome?: string;
}

export function DeadlinesModal({ open, onOpenChange, assetId, assetNome }: DeadlinesModalProps) {
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterStato, setFilterStato] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Scadenza | null>(null);
  const [editTarget, setEditTarget] = useState<Scadenza | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetcher = useCallback(() =>
    assetId
      ? deadlines.byAsset(assetId)
      : deadlines.list({
          ...(filterTipo ? { tipo: filterTipo } : {}),
          ...(filterStato ? { stato: filterStato } : {}),
        }),
    [assetId, filterTipo, filterStato],
  );

  const { data, loading, error, refetch } = useApi(fetcher, [assetId, filterTipo, filterStato], open);
  const { mutate: deleteDeadline, loading: deleting } = useApiMutation(deadlines.delete);

  const filtered = (data ?? []).filter(d =>
    !search ||
    d.titolo.toLowerCase().includes(search.toLowerCase()) ||
    (d.note ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDeadline(deleteTarget.id);
      toast.success('Scadenza eliminata');
      setDeleteTarget(null);
      refetch();
    } catch {
      toast.error('Errore eliminazione scadenza');
    }
  }

  const title = assetNome ? `Scadenze — ${assetNome}` : 'Gestione Scadenze';
  const tipoOptions = Object.entries(SCADENZA_TIPO_LABEL).map(([v, l]) => ({ value: v, label: l }));
  const statoOptions = [
    { value: 'attiva', label: 'Attiva' },
    { value: 'scaduta', label: 'Scaduta' },
    { value: 'completata', label: 'Completata' },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[var(--gam-bg-secondary)] border-[var(--gam-border)] max-w-4xl w-full max-h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--gam-border)]">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[var(--gam-text-primary)] font-display text-base">
                <CalendarClock size={15} className="inline mr-2 text-[var(--gam-accent)]" />
                {title}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <button
                  className="gam-btn-primary flex items-center gap-1.5 text-xs"
                  onClick={() => { setEditTarget(null); setShowForm(true); }}
                >
                  <Plus size={12} />
                  Nuova scadenza
                </button>
                <a
                  href={exports.deadlinesExcel()}
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
              search={{ value: search, onChange: setSearch, placeholder: 'Cerca scadenza…' }}
              filters={[
                { key: 'tipo', label: 'Tipo', options: tipoOptions, value: filterTipo, onChange: setFilterTipo },
                { key: 'stato', label: 'Stato', options: statoOptions, value: filterStato, onChange: setFilterStato },
              ]}
            />
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {loading && <LoadingSpinner label="Caricamento scadenze…" />}
            {error && <ErrorState message={error} onRetry={refetch} />}
            {!loading && !error && filtered.length === 0 && (
              <EmptyState
                icon={<CalendarClock size={36} />}
                title="Nessuna scadenza"
                description={search ? 'Nessun risultato per la ricerca' : 'Non ci sono scadenze registrate'}
              />
            )}
            {!loading && !error && filtered.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--gam-border)]">
                    <th className="gam-label text-left py-2 pr-3">Titolo</th>
                    <th className="gam-label text-left py-2 pr-3">Tipo</th>
                    <th className="gam-label text-left py-2 pr-3">Stato</th>
                    <th className="gam-label text-left py-2 pr-3">Scadenza</th>
                    <th className="gam-label text-left py-2 pr-3">Giorni</th>
                    <th className="gam-label text-right py-2">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(sc => {
                    const days = daysUntil(sc.data_scadenza);
                    const isUrgent = sc.stato === 'attiva' && days != null && days <= 7;
                    const isOverdue = sc.stato === 'scaduta';
                    return (
                      <tr key={sc.id} className="border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50 transition-colors">
                        <td className="py-2 pr-3 text-[var(--gam-text-primary)]">
                          <div className="flex items-center gap-1.5">
                            {(isUrgent || isOverdue) && (
                              <AlertTriangle size={11} className={isOverdue ? 'text-[var(--gam-danger)]' : 'text-[var(--gam-warning)]'} />
                            )}
                            <span title={sc.titolo}>{truncate(sc.titolo, 40)}</span>
                          </div>
                          {sc.note && <p className="text-[var(--gam-text-muted)] text-[10px] mt-0.5">{truncate(sc.note, 50)}</p>}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge type="scadenza-tipo" value={sc.tipo} />
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge type="scadenza-stato" value={sc.stato} dot />
                        </td>
                        <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">
                          {formatDate(sc.data_scadenza)}
                        </td>
                        <td className="py-2 pr-3 font-mono" style={{
                          color: isOverdue ? 'var(--gam-danger)' : isUrgent ? 'var(--gam-warning)' : 'var(--gam-text-secondary)',
                        }}>
                          {days != null
                            ? days < 0
                              ? `${Math.abs(days)}g fa`
                              : days === 0 ? 'Oggi' : `${days}g`
                            : '–'}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => { setEditTarget(sc); setShowForm(true); }}
                              className="text-[var(--gam-text-muted)] hover:text-[var(--gam-accent)] transition-colors"
                              title="Modifica"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(sc)}
                              className="text-[var(--gam-text-muted)] hover:text-[var(--gam-danger)] transition-colors"
                              title="Elimina"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && data && (
            <div className="px-5 py-2 border-t border-[var(--gam-border)] text-[10px] text-[var(--gam-text-muted)]">
              {filtered.length} / {data.length} scadenze
            </div>
          )}
        </DialogContent>
      </Dialog>

      {showForm && (
        <DeadlineFormModal
          open={showForm}
          onOpenChange={setShowForm}
          scadenza={editTarget}
          defaultAssetId={assetId}
          onSaved={() => { setShowForm(false); refetch(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title="Elimina scadenza"
        description={`Eliminare "${deleteTarget?.titolo}"?`}
        confirmLabel={deleting ? 'Eliminazione…' : 'Elimina'}
        variant="danger"
        onConfirm={handleDelete}
      />
    </>
  );
}
