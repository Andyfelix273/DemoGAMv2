/**
 * DeadlinesPage — Pagina standalone Scadenze
 * Riusa la logica di DeadlinesModal in un layout a pagina intera.
 */
import { useState, useCallback } from 'react';
import { deadlines, exports } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { KpiCard } from '@/components/shared/KpiCard';
import { LoadingSpinner, EmptyState, ErrorState, FilterBar, ConfirmDialog } from '@/components/shared/Primitives';
import { formatDate, daysUntil } from '@/lib/utils';
import { SCADENZA_TIPO_LABEL } from '@/lib/constants';
import { CalendarClock, Plus, Pencil, Trash2, ExternalLink, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { Scadenza } from '@/lib/types';
import { DeadlineFormModal } from '@/components/modals/DeadlineFormModal';

export default function DeadlinesPage() {
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterStato, setFilterStato] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Scadenza | null>(null);
  const [editTarget, setEditTarget] = useState<Scadenza | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetcher = useCallback(() =>
    deadlines.list({
      ...(filterTipo ? { tipo: filterTipo } : {}),
      ...(filterStato ? { stato: filterStato } : {}),
    }),
    [filterTipo, filterStato],
  );

  const { data, loading, error, refetch } = useApi(fetcher, [filterTipo, filterStato]);
  const { mutate: deleteDeadline, loading: deleting } = useApiMutation(deadlines.delete);

  const allDeadlines: Scadenza[] = data ?? [];

  // KPI
  const nAttive     = allDeadlines.filter(d => d.stato === 'attiva').length;
  const nScadute    = allDeadlines.filter(d => d.stato === 'scaduta').length;
  const nUrgenti    = allDeadlines.filter(d => {
    if (d.stato !== 'attiva') return false;
    const days = daysUntil(d.data_scadenza);
    return days != null && days <= 30;
  }).length;
  const nCompletate = allDeadlines.filter(d => d.stato === 'completata').length;

  const filtered = allDeadlines.filter(d =>
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

  const tipoOptions  = Object.entries(SCADENZA_TIPO_LABEL).map(([v, l]) => ({ value: v, label: l }));
  const statoOptions = [
    { value: 'attiva', label: 'Attiva' },
    { value: 'scaduta', label: 'Scaduta' },
    { value: 'completata', label: 'Completata' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* KPI bar */}
      <div className="shrink-0 grid grid-cols-4 gap-3 px-4 py-3 border-b border-[var(--gam-border)]">
        <KpiCard
          label="Attive"
          value={nAttive}
          icon={<CalendarClock size={14} />}
          variant={nAttive > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          label="Urgenti (≤30g)"
          value={nUrgenti}
          icon={<AlertTriangle size={14} />}
          variant={nUrgenti > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Scadute"
          value={nScadute}
          icon={<AlertTriangle size={14} />}
          variant={nScadute > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Completate"
          value={nCompletate}
          icon={<CalendarClock size={14} />}
          variant="success"
        />
      </div>

      {/* Contenuto principale */}
      <div className="flex-1 overflow-hidden flex flex-col px-4 py-3 gap-3">
        {/* Header azioni + filtri */}
        <div className="shrink-0 flex items-center gap-3">
          <div className="flex-1">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Cerca scadenza…' }}
              filters={[
                { key: 'tipo', label: 'Tipo', options: tipoOptions, value: filterTipo, onChange: setFilterTipo },
                { key: 'stato', label: 'Stato', options: statoOptions, value: filterStato, onChange: setFilterStato },
              ]}
            />
          </div>
          <button
            className="gam-btn-primary flex items-center gap-1.5 text-xs shrink-0"
            onClick={() => { setEditTarget(null); setShowForm(true); }}
          >
            <Plus size={12} />
            Nuova scadenza
          </button>
          <a
            href={exports.deadlinesExcel()}
            className="flex items-center gap-1.5 text-xs text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors shrink-0"
            title="Esporta Excel"
          >
            <ExternalLink size={13} />
            Excel
          </a>
        </div>

        {/* Tabella */}
        <div className="flex-1 overflow-y-auto gam-card">
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
                  <th className="gam-label text-left py-2 px-4">Titolo</th>
                  <th className="gam-label text-left py-2 pr-3">Asset</th>
                  <th className="gam-label text-left py-2 pr-3">Tipo</th>
                  <th className="gam-label text-left py-2 pr-3">Stato</th>
                  <th className="gam-label text-left py-2 pr-3">Scadenza</th>
                  <th className="gam-label text-left py-2 pr-3">Giorni</th>
                  <th className="gam-label text-right py-2 pr-4">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(sc => {
                  const days = daysUntil(sc.data_scadenza);
                  const isUrgent = sc.stato === 'attiva' && days != null && days <= 7;
                  const isOverdue = sc.stato === 'scaduta';
                  return (
                    <tr
                      key={sc.id}
                      className={`border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50 transition-colors ${
                        isOverdue ? 'bg-[var(--gam-danger)]/5' : isUrgent ? 'bg-[var(--gam-warning)]/5' : ''
                      }`}
                    >
                      <td className="py-2 px-4 text-[var(--gam-text-primary)]">
                        <div className="flex items-center gap-1.5">
                          {(isUrgent || isOverdue) && (
                            <AlertTriangle
                              size={11}
                              className={isOverdue ? 'text-[var(--gam-danger)]' : 'text-[var(--gam-warning)]'}
                            />
                          )}
                          <span title={sc.titolo} className="font-medium">{sc.titolo}</span>
                        </div>
                        {sc.note && (
                          <p className="text-[var(--gam-text-muted)] text-[10px] mt-0.5 max-w-xs truncate">{sc.note}</p>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">
                        {sc.asset_nome ?? '–'}
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
                      <td
                        className="py-2 pr-3 font-mono"
                        style={{
                          color: isOverdue
                            ? 'var(--gam-danger)'
                            : isUrgent
                            ? 'var(--gam-warning)'
                            : 'var(--gam-text-secondary)',
                        }}
                      >
                        {days != null
                          ? days < 0
                            ? `${Math.abs(days)}g fa`
                            : days === 0
                            ? 'Oggi'
                            : `${days}g`
                          : '–'}
                      </td>
                      <td className="py-2 pr-4 text-right">
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

        {/* Footer count */}
        {!loading && data && (
          <div className="shrink-0 text-[10px] text-[var(--gam-text-muted)]">
            {filtered.length} / {allDeadlines.length} scadenze
          </div>
        )}
      </div>

      {/* Form creazione/modifica */}
      {showForm && (
        <DeadlineFormModal
          open={showForm}
          onOpenChange={setShowForm}
          scadenza={editTarget}
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
    </div>
  );
}
