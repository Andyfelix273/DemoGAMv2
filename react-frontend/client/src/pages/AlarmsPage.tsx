/**
 * AlarmsPage — Pagina standalone Allarmi
 * Lista allarmi attivi + storico allarmi acknowledged.
 * Filtri per gravità, asset. Azione acknowledge.
 */
import { useState, useCallback } from 'react';
import { alarms } from '@/lib/api';
import { useApi, useApiMutation } from '@/hooks/useApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { KpiCard } from '@/components/shared/KpiCard';
import { LoadingSpinner, EmptyState, ErrorState, FilterBar, SectionTitle } from '@/components/shared/Primitives';
import { formatDateTime, formatTimeAgo } from '@/lib/utils';
import { Bell, CheckCircle, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { Allarme } from '@/lib/types';

// ── Icona per livello allarme ────────────────────────────────────────
function AlarmIcon({ livello }: { livello: string }) {
  if (livello === 'alarm') return <AlertTriangle size={14} className="text-[var(--gam-danger)] shrink-0" />;
  if (livello === 'warning') return <AlertTriangle size={14} className="text-[var(--gam-warning)] shrink-0" />;
  return <Info size={14} className="text-[var(--gam-accent)] shrink-0" />;
}

// ── Mappa livello → label badge ──────────────────────────────────────
const LIVELLO_LABEL: Record<string, string> = {
  alarm: 'Alarm',
  warning: 'Warning',
  info: 'Info',
};

// ── Colore badge livello ─────────────────────────────────────────────
function LivelloBadge({ livello }: { livello: string }) {
  const colorMap: Record<string, string> = {
    alarm: 'var(--gam-danger)',
    warning: 'var(--gam-warning)',
    info: 'var(--gam-accent)',
  };
  const color = colorMap[livello] ?? 'var(--gam-text-muted)';
  return (
    <span
      className="gam-badge"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {LIVELLO_LABEL[livello] ?? livello}
    </span>
  );
}

// ── Pagina principale ────────────────────────────────────────────────
export default function AlarmsPage() {
  const [search, setSearch] = useState('');
  const [filterLivello, setFilterLivello] = useState('');
  const [tab, setTab] = useState<'attivi' | 'storico'>('attivi');

  const { data, loading, error, refetch } = useApi(
    () => alarms.list(),
    [],
  );

  const { mutate: ackAlarm, loading: acking } = useApiMutation(alarms.ack);

  const allAlarms: Allarme[] = data ?? [];
  const attivi = allAlarms.filter(a => !a.ack_at);
  const storico = allAlarms.filter(a => !!a.ack_at);

  // Contatori per KPI
  const nAlarm   = attivi.filter(a => a.livello === 'alarm').length;
  const nWarning = attivi.filter(a => a.livello === 'warning').length;
  const nInfo    = attivi.filter(a => a.livello === 'info').length;

  // Filtro sulla lista corrente
  const currentList = tab === 'attivi' ? attivi : storico;
  const filtered = currentList.filter(a => {
    const matchSearch =
      !search ||
      a.asset_nome.toLowerCase().includes(search.toLowerCase()) ||
      a.campo.toLowerCase().includes(search.toLowerCase());
    const matchLivello = !filterLivello || a.livello === filterLivello;
    return matchSearch && matchLivello;
  });

  // Ordina attivi: alarm prima, poi warning, poi info; per data desc
  const sorted = tab === 'attivi'
    ? [...filtered].sort((a, b) => {
        const order: Record<string, number> = { alarm: 0, warning: 1, info: 2 };
        const diff = (order[a.livello] ?? 3) - (order[b.livello] ?? 3);
        if (diff !== 0) return diff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
    : [...filtered].sort((a, b) =>
        new Date(b.ack_at ?? b.created_at).getTime() - new Date(a.ack_at ?? a.created_at).getTime(),
      );

  async function handleAck(id: number) {
    try {
      await ackAlarm(id);
      toast.success('Allarme confermato');
      refetch();
    } catch {
      toast.error('Errore nella conferma allarme');
    }
  }

  const livelloOptions = [
    { value: 'alarm', label: 'Alarm' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* KPI bar */}
      <div className="shrink-0 grid grid-cols-4 gap-3 px-4 py-3 border-b border-[var(--gam-border)]">
        <KpiCard
          label="Allarmi attivi"
          value={attivi.length}
          icon={<Bell size={14} />}
          variant={attivi.length > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Alarm"
          value={nAlarm}
          icon={<AlertTriangle size={14} />}
          variant={nAlarm > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Warning"
          value={nWarning}
          icon={<AlertTriangle size={14} />}
          variant={nWarning > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          label="Confermati"
          value={storico.length}
          icon={<CheckCircle size={14} />}
          variant="default"
        />
      </div>

      {/* Contenuto principale */}
      <div className="flex-1 overflow-hidden flex flex-col px-4 py-3 gap-3">
        {/* Header con tab + filtri */}
        <div className="shrink-0 flex items-center justify-between gap-3">
          {/* Tab */}
          <div className="flex items-center gap-1 bg-[var(--gam-bg-tertiary)] rounded p-0.5">
            <button
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                tab === 'attivi'
                  ? 'bg-[var(--gam-accent)] text-[var(--gam-bg-primary)]'
                  : 'text-[var(--gam-text-secondary)] hover:text-[var(--gam-text-primary)]'
              }`}
              onClick={() => setTab('attivi')}
            >
              Attivi
              {attivi.length > 0 && (
                <span className="ml-1.5 bg-[var(--gam-danger)] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {attivi.length}
                </span>
              )}
            </button>
            <button
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                tab === 'storico'
                  ? 'bg-[var(--gam-accent)] text-[var(--gam-bg-primary)]'
                  : 'text-[var(--gam-text-secondary)] hover:text-[var(--gam-text-primary)]'
              }`}
              onClick={() => setTab('storico')}
            >
              Storico
            </button>
          </div>

          {/* Filtri */}
          <div className="flex-1 max-w-xl">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Cerca per asset o campo…' }}
              filters={[
                { key: 'livello', label: 'Livello', options: livelloOptions, value: filterLivello, onChange: setFilterLivello },
              ]}
            />
          </div>

          {/* Refresh */}
          <button
            className="flex items-center gap-1.5 text-xs text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors"
            onClick={refetch}
            title="Aggiorna"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Aggiorna
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto gam-card">
          {loading && <LoadingSpinner label="Caricamento allarmi…" />}
          {error && <ErrorState message={error} onRetry={refetch} />}
          {!loading && !error && sorted.length === 0 && (
            <EmptyState
              icon={tab === 'attivi' ? <CheckCircle size={36} className="text-[var(--gam-success)]" /> : <Bell size={36} />}
              title={tab === 'attivi' ? 'Nessun allarme attivo' : 'Nessun allarme nello storico'}
              description={search || filterLivello ? 'Nessun risultato per i filtri applicati' : undefined}
            />
          )}
          {!loading && !error && sorted.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gam-border)]">
                  <th className="gam-label text-left py-2 px-4">Livello</th>
                  <th className="gam-label text-left py-2 pr-3">Asset</th>
                  <th className="gam-label text-left py-2 pr-3">Campo</th>
                  <th className="gam-label text-left py-2 pr-3">Valore</th>
                  <th className="gam-label text-left py-2 pr-3">
                    {tab === 'attivi' ? 'Rilevato' : 'Rilevato / Confermato'}
                  </th>
                  {tab === 'attivi' && (
                    <th className="gam-label text-right py-2 pr-4">Azioni</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map(a => (
                  <tr
                    key={a.id}
                    className={`border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50 transition-colors ${
                      a.livello === 'alarm' && tab === 'attivi' ? 'bg-[var(--gam-danger)]/5' : ''
                    }`}
                  >
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-1.5">
                        <AlarmIcon livello={a.livello} />
                        <LivelloBadge livello={a.livello} />
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <p className="text-[var(--gam-text-primary)] font-medium">{a.asset_nome}</p>
                      <p className="text-[var(--gam-text-muted)] text-[10px]">
                        {a.asset_tipo} · {a.citta}
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">
                      {a.campo.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[var(--gam-text-primary)]">
                      {a.valore ?? '–'}
                    </td>
                    <td className="py-2 pr-3 text-[var(--gam-text-muted)]">
                      <p>{formatTimeAgo(a.created_at)}</p>
                      {a.ack_at && (
                        <p className="text-[10px] text-[var(--gam-success)]">
                          Conf. {formatDateTime(a.ack_at)}
                        </p>
                      )}
                    </td>
                    {tab === 'attivi' && (
                      <td className="py-2 pr-4 text-right">
                        <button
                          onClick={() => handleAck(a.id)}
                          disabled={acking}
                          className="flex items-center gap-1 text-[var(--gam-text-muted)] hover:text-[var(--gam-success)] transition-colors disabled:opacity-50 ml-auto"
                          title="Conferma allarme"
                        >
                          <CheckCircle size={14} />
                          <span className="text-[10px]">Conferma</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        {!loading && data && (
          <div className="shrink-0 text-[10px] text-[var(--gam-text-muted)]">
            {sorted.length} / {currentList.length} allarmi
          </div>
        )}
      </div>
    </div>
  );
}
