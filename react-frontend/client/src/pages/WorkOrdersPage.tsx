/**
 * WorkOrdersPage — Pagina standalone Work Order
 * Riusa la logica di WorkOrdersModal in un layout a pagina intera.
 */
import { useState, useCallback } from 'react';
import { workOrders, exports } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { KpiCard } from '@/components/shared/KpiCard';
import { LoadingSpinner, EmptyState, ErrorState, FilterBar, SectionTitle, ConfirmDialog } from '@/components/shared/Primitives';
import { formatDate } from '@/lib/utils';
import { WO_STATO_LABEL, WO_PRIORITA_LABEL } from '@/lib/constants';
import { Wrench, Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkOrder } from '@/lib/types';
import { WOFormModal } from '@/components/modals/WOFormModal';

export default function WorkOrdersPage() {
  const [search, setSearch] = useState('');
  const [filterStato, setFilterStato] = useState('');
  const [filterPriorita, setFilterPriorita] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);
  const [editTarget, setEditTarget] = useState<WorkOrder | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetcher = useCallback(() =>
    workOrders.list({
      ...(filterStato ? { stato: filterStato } : {}),
      ...(filterPriorita ? { priorita: filterPriorita } : {}),
    }),
    [filterStato, filterPriorita],
  );

  const { data, loading, error, refetch } = useApi(fetcher, [filterStato, filterPriorita]);
  const { mutate: deleteWO, loading: deleting } = useApiMutation(workOrders.delete);

  const allWO: WorkOrder[] = data ?? [];

  // KPI
  const nAperti   = allWO.filter(w => w.stato === 'aperto').length;
  const nInCorso  = allWO.filter(w => w.stato === 'in_corso').length;
  const nUrgenti  = allWO.filter(w => w.priorita === 'urgente').length;
  const nChiusi   = allWO.filter(w => w.stato === 'chiuso').length;

  const filtered = allWO.filter(wo =>
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

  const statoOptions   = Object.entries(WO_STATO_LABEL).map(([v, l]) => ({ value: v, label: l }));
  const prioritaOptions = Object.entries(WO_PRIORITA_LABEL).map(([v, l]) => ({ value: v, label: l }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* KPI bar */}
      <div className="shrink-0 grid grid-cols-4 gap-3 px-4 py-3 border-b border-[var(--gam-border)]">
        <KpiCard
          label="Aperti"
          value={nAperti}
          icon={<Wrench size={14} />}
          variant={nAperti > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          label="In corso"
          value={nInCorso}
          icon={<Wrench size={14} />}
          variant={nInCorso > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Urgenti"
          value={nUrgenti}
          icon={<Wrench size={14} />}
          variant={nUrgenti > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Chiusi"
          value={nChiusi}
          icon={<Wrench size={14} />}
          variant="success"
        />
      </div>

      {/* Contenuto principale */}
      <div className="flex-1 overflow-hidden flex flex-col px-4 py-3 gap-3">
        {/* Header azioni + filtri */}
        <div className="shrink-0 flex items-center gap-3">
          <div className="flex-1">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Cerca work order…' }}
              filters={[
                { key: 'stato', label: 'Stato', options: statoOptions, value: filterStato, onChange: setFilterStato },
                { key: 'priorita', label: 'Priorità', options: prioritaOptions, value: filterPriorita, onChange: setFilterPriorita },
              ]}
            />
          </div>
          <button
            className="gam-btn-primary flex items-center gap-1.5 text-xs shrink-0"
            onClick={() => { setEditTarget(null); setShowForm(true); }}
          >
            <Plus size={12} />
            Nuovo WO
          </button>
          <a
            href={exports.workordersExcel()}
            className="flex items-center gap-1.5 text-xs text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors shrink-0"
            title="Esporta Excel"
          >
            <ExternalLink size={13} />
            Excel
          </a>
        </div>

        {/* Tabella */}
        <div className="flex-1 overflow-y-auto gam-card">
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
                  <th className="gam-label text-left py-2 px-4">Titolo</th>
                  <th className="gam-label text-left py-2 pr-3">Asset</th>
                  <th className="gam-label text-left py-2 pr-3">Stato</th>
                  <th className="gam-label text-left py-2 pr-3">Priorità</th>
                  <th className="gam-label text-left py-2 pr-3">Assegnato</th>
                  <th className="gam-label text-left py-2 pr-3">Apertura</th>
                  <th className="gam-label text-right py-2 pr-4">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(wo => (
                  <tr
                    key={wo.id}
                    className="border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50 transition-colors"
                  >
                    <td className="py-2 px-4 text-[var(--gam-text-primary)]">
                      <p title={wo.titolo} className="font-medium">{wo.titolo}</p>
                      {wo.descrizione && (
                        <p className="text-[var(--gam-text-muted)] text-[10px] mt-0.5 max-w-xs truncate">
                          {wo.descrizione}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">
                      {wo.asset_nome ?? '–'}
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
                    <td className="py-2 pr-4 text-right">
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

        {/* Footer count */}
        {!loading && data && (
          <div className="shrink-0 text-[10px] text-[var(--gam-text-muted)]">
            {filtered.length} / {allWO.length} work orders
          </div>
        )}
      </div>

      {/* Form creazione/modifica */}
      {showForm && (
        <WOFormModal
          open={showForm}
          onOpenChange={setShowForm}
          workOrder={editTarget}
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
    </div>
  );
}
