/**
 * WOFormModal — form creazione/modifica Work Order
 */
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { workOrders, assets } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { WO_STATO_LABEL, WO_PRIORITA_LABEL } from '@/lib/constants';
import { toast } from 'sonner';
import type { WorkOrder } from '@/lib/types';

interface WOFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder?: WorkOrder | null;
  defaultAssetId?: number;
  onSaved: () => void;
}

export function WOFormModal({ open, onOpenChange, workOrder, defaultAssetId, onSaved }: WOFormModalProps) {
  const isEdit = !!workOrder;

  const [form, setForm] = useState({
    asset_id: defaultAssetId ?? workOrder?.asset_id ?? '',
    titolo: workOrder?.titolo ?? '',
    descrizione: workOrder?.descrizione ?? '',
    stato: workOrder?.stato ?? 'aperto',
    priorita: workOrder?.priorita ?? 'media',
    assegnato_a: workOrder?.assegnato_a ?? '',
    data_apertura: workOrder?.data_apertura?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    if (workOrder) {
      setForm({
        asset_id: workOrder.asset_id,
        titolo: workOrder.titolo,
        descrizione: workOrder.descrizione ?? '',
        stato: workOrder.stato,
        priorita: workOrder.priorita,
        assegnato_a: workOrder.assegnato_a ?? '',
        data_apertura: workOrder.data_apertura?.slice(0, 10) ?? '',
      });
    }
  }, [workOrder]);

  const { data: assetList } = useApi(() => assets.list(), [], !defaultAssetId && !workOrder?.asset_id);

  const { mutate: createWO, loading: creating } = useApiMutation(workOrders.create);
  const { mutate: updateWO, loading: updating } = useApiMutation(
    (id: number, data: Partial<WorkOrder>) => workOrders.update(id, data),
  );

  const loading = creating || updating;

  function set(key: string, value: string | number) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titolo.trim()) { toast.error('Il titolo è obbligatorio'); return; }
    if (!form.asset_id) { toast.error('Seleziona un asset'); return; }
    try {
      if (isEdit && workOrder) {
        await updateWO(workOrder.id, form as Partial<WorkOrder>);
        toast.success('Work Order aggiornato');
      } else {
        await createWO(form as Partial<WorkOrder>);
        toast.success('Work Order creato');
      }
      onSaved();
    } catch (e) {
      toast.error('Errore salvataggio Work Order');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--gam-bg-secondary)] border-[var(--gam-border)] max-w-lg w-full p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--gam-border)]">
          <DialogTitle className="text-[var(--gam-text-primary)] font-display text-base">
            {isEdit ? 'Modifica Work Order' : 'Nuovo Work Order'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-3">
          {/* Asset (solo se non filtrato) */}
          {!defaultAssetId && !workOrder?.asset_id && (
            <div className="flex flex-col gap-1">
              <label className="gam-label">Asset *</label>
              <select
                className="gam-input"
                value={form.asset_id}
                onChange={e => set('asset_id', parseInt(e.target.value))}
                required
              >
                <option value="">Seleziona asset…</option>
                {(assetList ?? []).map(a => (
                  <option key={a.id} value={a.id}>{a.codice} — {a.nome}</option>
                ))}
              </select>
            </div>
          )}

          {/* Titolo */}
          <div className="flex flex-col gap-1">
            <label className="gam-label">Titolo *</label>
            <input
              type="text"
              className="gam-input"
              value={form.titolo}
              onChange={e => set('titolo', e.target.value)}
              placeholder="Descrizione breve del WO"
              required
            />
          </div>

          {/* Descrizione */}
          <div className="flex flex-col gap-1">
            <label className="gam-label">Descrizione</label>
            <textarea
              className="gam-input resize-none"
              rows={3}
              value={form.descrizione}
              onChange={e => set('descrizione', e.target.value)}
              placeholder="Dettagli aggiuntivi…"
            />
          </div>

          {/* Stato + Priorità */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="gam-label">Stato</label>
              <select className="gam-input" value={form.stato} onChange={e => set('stato', e.target.value)}>
                {Object.entries(WO_STATO_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="gam-label">Priorità</label>
              <select className="gam-input" value={form.priorita} onChange={e => set('priorita', e.target.value)}>
                {Object.entries(WO_PRIORITA_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Assegnato + Data apertura */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="gam-label">Assegnato a</label>
              <input
                type="text"
                className="gam-input"
                value={form.assegnato_a}
                onChange={e => set('assegnato_a', e.target.value)}
                placeholder="Nome tecnico"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="gam-label">Data apertura</label>
              <input
                type="date"
                className="gam-input"
                value={form.data_apertura}
                onChange={e => set('data_apertura', e.target.value)}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--gam-border)]">
            <button
              type="button"
              className="gam-input text-xs px-4 py-1.5"
              onClick={() => onOpenChange(false)}
            >
              Annulla
            </button>
            <button type="submit" className="gam-btn-primary" disabled={loading}>
              {loading ? 'Salvataggio…' : isEdit ? 'Aggiorna' : 'Crea WO'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
