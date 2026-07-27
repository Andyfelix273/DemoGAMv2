/**
 * DeadlineFormModal — form creazione/modifica Scadenza
 */
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deadlines, assets } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { SCADENZA_TIPO_LABEL } from '@/lib/constants';
import { toast } from 'sonner';
import type { Scadenza } from '@/lib/types';

interface DeadlineFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scadenza?: Scadenza | null;
  defaultAssetId?: number;
  onSaved: () => void;
}

export function DeadlineFormModal({ open, onOpenChange, scadenza, defaultAssetId, onSaved }: DeadlineFormModalProps) {
  const isEdit = !!scadenza;

  const [form, setForm] = useState({
    asset_id: defaultAssetId ?? scadenza?.asset_id ?? '',
    titolo: scadenza?.titolo ?? '',
    tipo: scadenza?.tipo ?? 'manutenzione',
    stato: scadenza?.stato ?? 'attiva',
    data_scadenza: scadenza?.data_scadenza?.slice(0, 10) ?? '',
    note: scadenza?.note ?? '',
  });

  useEffect(() => {
    if (scadenza) {
      setForm({
        asset_id: scadenza.asset_id,
        titolo: scadenza.titolo,
        tipo: scadenza.tipo,
        stato: scadenza.stato,
        data_scadenza: scadenza.data_scadenza?.slice(0, 10) ?? '',
        note: scadenza.note ?? '',
      });
    }
  }, [scadenza]);

  const { data: assetList } = useApi(() => assets.list(), [], !defaultAssetId && !scadenza?.asset_id);

  const { mutate: createDeadline, loading: creating } = useApiMutation(deadlines.create);
  const { mutate: updateDeadline, loading: updating } = useApiMutation(
    (id: number, data: Partial<Scadenza>) => deadlines.update(id, data),
  );

  const loading = creating || updating;

  function set(key: string, value: string | number) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titolo.trim()) { toast.error('Il titolo è obbligatorio'); return; }
    if (!form.asset_id) { toast.error('Seleziona un asset'); return; }
    if (!form.data_scadenza) { toast.error('La data di scadenza è obbligatoria'); return; }
    try {
      if (isEdit && scadenza) {
        await updateDeadline(scadenza.id, form as Partial<Scadenza>);
        toast.success('Scadenza aggiornata');
      } else {
        await createDeadline(form as Partial<Scadenza>);
        toast.success('Scadenza creata');
      }
      onSaved();
    } catch {
      toast.error('Errore salvataggio scadenza');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--gam-bg-secondary)] border-[var(--gam-border)] max-w-lg w-full p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--gam-border)]">
          <DialogTitle className="text-[var(--gam-text-primary)] font-display text-base">
            {isEdit ? 'Modifica Scadenza' : 'Nuova Scadenza'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-3">
          {/* Asset */}
          {!defaultAssetId && !scadenza?.asset_id && (
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
              placeholder="Es. Revisione impianto antincendio"
              required
            />
          </div>

          {/* Tipo + Stato */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="gam-label">Tipo</label>
              <select className="gam-input" value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                {Object.entries(SCADENZA_TIPO_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="gam-label">Stato</label>
              <select className="gam-input" value={form.stato} onChange={e => set('stato', e.target.value)}>
                <option value="attiva">Attiva</option>
                <option value="completata">Completata</option>
                <option value="scaduta">Scaduta</option>
              </select>
            </div>
          </div>

          {/* Data scadenza */}
          <div className="flex flex-col gap-1">
            <label className="gam-label">Data scadenza *</label>
            <input
              type="date"
              className="gam-input"
              value={form.data_scadenza}
              onChange={e => set('data_scadenza', e.target.value)}
              required
            />
          </div>

          {/* Note */}
          <div className="flex flex-col gap-1">
            <label className="gam-label">Note</label>
            <textarea
              className="gam-input resize-none"
              rows={2}
              value={form.note}
              onChange={e => set('note', e.target.value)}
              placeholder="Note aggiuntive…"
            />
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
              {loading ? 'Salvataggio…' : isEdit ? 'Aggiorna' : 'Crea scadenza'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
