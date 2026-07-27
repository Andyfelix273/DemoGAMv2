/**
 * AssetDetailModal — modale dettaglio asset GAM
 * 7 tab: Anagrafica | Consumi | Allarmi | Efficienza | Impianti | Zone & Occupancy | Tariffe & Bollette
 * Le tab Documenti, WO e Scadenze sono gestite tramite le modali condivise filtrate per asset.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { assets, alarms, bems, efficiency } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { KpiCard } from '@/components/shared/KpiCard';
import { ZoneCard } from '@/components/shared/ZoneCard';
import { ChartArea, ChartBar, ChartLine, ChartPie, ChartHeatmap } from '@/components/shared/Charts';
import { LoadingSpinner, EmptyState, ErrorState, DataRow, SectionTitle } from '@/components/shared/Primitives';
import { DocumentsModal } from './DocumentsModal';
import { WorkOrdersModal } from './WorkOrdersModal';
import { DeadlinesModal } from './DeadlinesModal';
import {
  formatDate, formatKwh, formatKw, formatEur, formatPct, formatMq,
  formatWorkingHours, getEnergyClassColor, formatNumber, groupBy,
} from '@/lib/utils';
import {
  ASSET_TIPO_LABEL, ZONA_TIPO_LABEL,
} from '@/lib/constants';
import {
  Info, Zap, Bell, Leaf, Settings, LayoutGrid, Receipt,
  FileText, Wrench, CalendarClock, MapPin,
} from 'lucide-react';
import type { Asset, Allarme, Zona, TelemetriaZona, Impianto, TelemetriaMap } from '@/lib/types';

// ── Mappa etichette impianto tipo ─────────────────────────────────────
const IMPIANTO_TIPO_LABEL: Record<string, string> = {
  elettrico: 'Elettrico',
  hvac: 'HVAC',
  illuminazione: 'Illuminazione',
  contatore_principale: 'Contatore principale',
};

// ── Mappa etichette categoria edificio ────────────────────────────────
const BUILDING_CATEGORY_LABEL: Record<string, string> = {
  OFFICE: 'Ufficio',
  INDUSTRIAL: 'Industriale',
  WAREHOUSE: 'Magazzino',
  RETAIL: 'Retail',
  MIXED: 'Misto',
  STORAGE: 'Deposito',
};

interface AssetDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: number | null;
}

// ── Tab Anagrafica ───────────────────────────────────────────────────
function TabAnagrafica({ asset }: { asset: Asset }) {
  const { data: referenti } = useApi(
    () => assets.referenti.list(asset.id),
    [asset.id],
  );

  const whLabel = formatWorkingHours(
    asset.working_hours_start,
    asset.working_hours_end,
    asset.working_days,
  );

  const catLabel = BUILDING_CATEGORY_LABEL[asset.building_category ?? ''] ?? asset.building_category ?? '–';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-6">
        <DataRow label="Codice" value={asset.codice} />
        <DataRow label="Tipo" value={ASSET_TIPO_LABEL[asset.tipo] ?? asset.tipo} />
        <DataRow label="Stato" value={<StatusBadge type="asset-stato" value={asset.stato} dot />} />
        <DataRow label="Indirizzo" value={asset.indirizzo} />
        <DataRow
          label="Città"
          value={`${asset.citta}${asset.provincia ? ` (${asset.provincia})` : ''}`}
        />
        <DataRow label="CAP" value={asset.cap} />
        <DataRow label="Superficie" value={formatMq(asset.superficie_mq)} />
        <DataRow label="Anno costruzione" value={asset.anno_costruzione ?? '–'} />
        <DataRow label="Orario lavorativo" value={whLabel} />
        <DataRow label="Categoria edificio" value={catLabel} />
        <DataRow
          label="Classe energetica"
          value={
            asset.energy_class ? (
              <span
                className="gam-badge font-bold"
                style={{
                  backgroundColor: `${getEnergyClassColor(asset.energy_class)}33`,
                  color: getEnergyClassColor(asset.energy_class),
                }}
              >
                {asset.energy_class}
              </span>
            ) : '–'
          }
        />
        <DataRow
          label="Budget energia annuo"
          value={
            asset.annual_energy_budget_eur
              ? `${formatEur(asset.annual_energy_budget_eur)} / anno`
              : '–'
          }
        />
        <DataRow
          label="Coordinate"
          value={`${(asset.lat ?? 0).toFixed(5)}, ${(asset.lng ?? 0).toFixed(5)}`}
        />
        {asset.note && <DataRow label="Note" value={asset.note} />}
      </div>

      {/* Referenti */}
      <div>
        <SectionTitle className="mb-2">Referenti</SectionTitle>
        {!referenti || (referenti as unknown[]).length === 0 ? (
          <p className="text-xs text-[var(--gam-text-muted)]">Nessun referente assegnato</p>
        ) : (
          <div className="flex flex-col gap-1">
            {(referenti as Array<{ id: number; nome: string; ruolo: string; email?: string; telefono?: string }>).map(r => (
              <div
                key={r.id}
                className="flex items-center justify-between py-1.5 border-b border-[var(--gam-border)]/40 last:border-0"
              >
                <div>
                  <p className="text-xs font-medium text-[var(--gam-text-primary)]">{r.nome}</p>
                  <p className="text-[10px] text-[var(--gam-text-muted)]">{r.ruolo}</p>
                </div>
                <div className="text-right">
                  {r.email && (
                    <p className="text-[10px] text-[var(--gam-text-secondary)]">{r.email}</p>
                  )}
                  {r.telefono && (
                    <p className="text-[10px] text-[var(--gam-text-muted)]">{r.telefono}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab Consumi ──────────────────────────────────────────────────────
function TabConsumi({ assetId }: { assetId: number }) {
  const [ore, setOre] = useState(168);

  const { data: rawTimeseries, loading, error, refetch } = useApi(
    () => bems.consumiTimeseries(assetId, ore),
    [assetId, ore],
  );
  const { data: rawVsOcc } = useApi(
    () => bems.consumiVsOccupancy(assetId, ore),
    [assetId, ore],
  );
  const { data: rawPerImpianto } = useApi(
    () => bems.consumiPerImpianto(assetId, ore),
    [assetId, ore],
  );

  const timeseries = rawTimeseries as Array<{ timestamp: string; power_kw: number }> | null;
  const vsOcc = rawVsOcc as Array<{ timestamp: string; power_kw: number; occupancy_pct: number }> | null;
  const perImpianto = rawPerImpianto as Array<{ nome: string; kwh_totale: number }> | null;

  const chartData = (timeseries ?? []).map(d => ({
    t: new Date(d.timestamp).toLocaleString('it-IT', {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }),
    kw: d.power_kw,
  }));

  const vsOccData = (vsOcc ?? []).map(d => ({
    t: new Date(d.timestamp).toLocaleString('it-IT', { day: '2-digit', hour: '2-digit' }),
    kw: d.power_kw,
    occ: d.occupancy_pct,
  }));

  const impiantoData = (perImpianto ?? []).map(d => ({
    name: d.nome,
    value: d.kwh_totale,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar ore */}
      <div className="flex items-center gap-2">
        <span className="gam-label">Periodo:</span>
        {[24, 72, 168, 720].map(h => (
          <button
            key={h}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              ore === h
                ? 'bg-[var(--gam-accent)] text-white'
                : 'text-[var(--gam-text-secondary)] hover:text-[var(--gam-text-primary)]'
            }`}
            onClick={() => setOre(h)}
          >
            {h === 24 ? '24h' : h === 72 ? '3g' : h === 168 ? '7g' : '30g'}
          </button>
        ))}
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && (
        <>
          <div>
            <SectionTitle className="mb-2">Andamento Consumi (kW)</SectionTitle>
            <ChartArea
              data={chartData}
              areas={[{ key: 'kw', label: 'Potenza kW', color: 'var(--gam-accent)' }]}
              xKey="t"
              height={180}
              formatter={(v: number) => `${v.toFixed(2)} kW`}
            />
          </div>

          {vsOccData.length > 0 && (
            <div>
              <SectionTitle className="mb-2">Consumi vs Occupancy</SectionTitle>
              <ChartLine
                data={vsOccData}
                lines={[
                  { key: 'kw', label: 'kW', color: 'var(--gam-accent)' },
                  { key: 'occ', label: 'Occupancy %', color: 'var(--gam-success)' },
                ]}
                xKey="t"
                height={160}
              />
            </div>
          )}

          {impiantoData.length > 0 && (
            <div>
              <SectionTitle className="mb-2">Consumi per Impianto (kWh)</SectionTitle>
              <ChartPie
                data={impiantoData}
                formatter={(v: number) => `${formatNumber(v, 1)} kWh`}
                height={180}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab Allarmi ──────────────────────────────────────────────────────
function TabAllarmi({ assetId }: { assetId: number }) {
  const { data, loading, error, refetch } = useApi(
    () => alarms.byAsset(assetId),
    [assetId],
  );

  return (
    <div className="flex flex-col gap-2">
      {loading && <LoadingSpinner />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && (!data || data.length === 0) && (
        <EmptyState icon={<Bell size={32} />} title="Nessun allarme attivo" />
      )}
      {!loading && !error && data && data.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--gam-border)]">
              <th className="gam-label text-left py-2 pr-3">Messaggio</th>
              <th className="gam-label text-left py-2 pr-3">Gravità</th>
              <th className="gam-label text-left py-2">Data</th>
            </tr>
          </thead>
          <tbody>
              {data.map((a: Allarme) => (
              <tr
                key={a.id}
                className="border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50"
              >
                <td className="py-2 pr-3 text-[var(--gam-text-primary)]">
                  {a.campo}{a.valore != null ? ` = ${a.valore}` : ''}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge type="allarme-gravita" value={a.livello} dot />
                </td>
                <td className="py-2 text-[var(--gam-text-muted)]">{formatDate(a.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Tab Efficienza energetica ────────────────────────────────────────
function TabEfficienza({ assetId }: { assetId: number }) {
  const { data: kpi, loading, error, refetch } = useApi(
    () => efficiency.kpi(assetId),
    [assetId],
  );
  const { data: rawTrend } = useApi(() => efficiency.trend(assetId), [assetId]);
  const { data: rawHeatmap } = useApi(() => efficiency.heatmap7d(assetId), [assetId]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!kpi) return null;

  const trend = rawTrend as Array<{ mese: string; kwh_totale: number }> | null;
  const heatmap = rawHeatmap as Array<{ giorno: number; ora: number; power_kw: number }> | null;

  const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const trendData = (trend ?? []).map(d => ({ mese: d.mese, kwh: d.kwh_totale }));
  const heatmapCells = (heatmap ?? []).map(d => ({
    day: DAYS[d.giorno] ?? String(d.giorno),
    hour: d.ora,
    value: d.power_kw,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* KPI grid */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label="EUI (kWh/m²/anno)"
          value={formatNumber(kpi.eui_kwh_mq, 1)}
          variant={
            kpi.eui_kwh_mq != null
              ? kpi.eui_kwh_mq > 200 ? 'danger' : kpi.eui_kwh_mq > 100 ? 'warning' : 'success'
              : 'default'
          }
        />
        <KpiCard
          label="Consumo YTD"
          value={formatKwh(kpi.consumo_ytd_kwh)}
          variant="accent"
        />
        <KpiCard
          label="Costo stimato"
          value={formatEur(kpi.costo_eur)}
          variant="default"
        />
        <KpiCard
          label="Budget YTD"
          value={formatKwh(kpi.budget_ytd_kwh)}
          variant="default"
        />
        <KpiCard
          label="Risparmio"
          value={formatPct(kpi.risparmio_pct)}
          variant={
            kpi.risparmio_pct != null
              ? kpi.risparmio_pct > 0 ? 'success' : 'danger'
              : 'default'
          }
        />
        <KpiCard
          label="CO₂ (ton)"
          value={kpi.co2_ton != null ? formatNumber(kpi.co2_ton, 2) : '–'}
          variant="default"
        />
      </div>

      {/* Trend mensile */}
      {trendData.length > 0 && (
        <div>
          <SectionTitle className="mb-2">Trend Mensile (kWh)</SectionTitle>
          <ChartBar
            data={trendData}
            bars={[{ key: 'kwh', label: 'kWh', color: 'var(--gam-accent)' }]}
            xKey="mese"
            height={160}
            formatter={(v: number) => `${formatNumber(v, 0)} kWh`}
          />
        </div>
      )}

      {/* Heatmap */}
      {heatmapCells.length > 0 && (
        <div>
          <SectionTitle className="mb-2">Heatmap Consumi (ultime 4 settimane)</SectionTitle>
          <ChartHeatmap
            data={heatmapCells}
            days={DAYS}
            formatter={(v: number) => `${v.toFixed(2)} kW`}
          />
        </div>
      )}
    </div>
  );
}

// ── Tab Impianti ─────────────────────────────────────────────────────
function TabImpianti({ assetId }: { assetId: number }) {
  const { data, loading, error, refetch } = useApi(
    () => bems.plants(assetId),
    [assetId],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data || data.length === 0) {
    return <EmptyState icon={<Settings size={32} />} title="Nessun impianto registrato" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {data.map((imp: Impianto) => (
        <div key={imp.plant_id} className="gam-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--gam-text-primary)]">{imp.nome}</p>
              <p className="text-[10px] text-[var(--gam-text-muted)]">
                {imp.plant_id} · {IMPIANTO_TIPO_LABEL[imp.tipo] ?? imp.tipo}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[var(--gam-text-muted)]">
                baseline: {formatKw(imp.energia_baseline_kw)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab Zone & Occupancy ─────────────────────────────────────────────
function TabZone({ assetId }: { assetId: number }) {
  const { data: zones, loading, error, refetch } = useApi(
    () => bems.zones(assetId),
    [assetId],
  );
  const { data: telRaw } = useApi(
    () => bems.telemetryLatest(assetId),
    [assetId],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!zones || zones.length === 0) {
    return <EmptyState icon={<LayoutGrid size={32} />} title="Nessuna zona BEMS registrata" />;
  }

  const telMap = telRaw as TelemetriaMap | null;
  const byFloor = groupBy(zones, (z: Zona) => z.floor_nome ?? 'Piano –');

  const totalPresenti = zones.reduce(
    (s: number, z: Zona) => s + (telMap?.[z.zone_id]?.persone_presenti ?? 0),
    0,
  );
  const totalCap = zones.reduce(
    (s: number, z: Zona) => s + (z.capacita_persone ?? 0),
    0,
  );
  const zoneAttive = zones.filter((z: Zona) => telMap?.[z.zone_id]?.occupancy).length;

  return (
    <div className="flex flex-col gap-4">
      {/* KPI sommario */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Presenti" value={totalPresenti} variant="accent" />
        <KpiCard label="Capienza max" value={totalCap} variant="default" />
        <KpiCard
          label="Zone attive"
          value={`${zoneAttive}/${zones.length}`}
          variant={zoneAttive > 0 ? 'success' : 'default'}
        />
      </div>

      {/* Zone per piano */}
      {Object.entries(byFloor).map(([piano, pianoZones]) => (
        <div key={piano}>
          <SectionTitle className="mb-2">{piano}</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(pianoZones as Zona[]).map((z: Zona) => (
              <ZoneCard
                key={z.zone_id}
                zona={z}
                tel={telMap?.[z.zone_id]}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab Tariffe & Bollette ───────────────────────────────────────────
function TabBollette({ assetId }: { assetId: number }) {
  const { data: rawData, loading, error, refetch } = useApi(
    () => bems.invoices(assetId),
    [assetId],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const data = rawData;
  const totaleAnno = (data ?? [])
    .filter(b => new Date(b.created_at).getFullYear() === new Date().getFullYear())
    .reduce((s, b) => s + (b.importo_eur ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Bollette registrate" value={(data ?? []).length} variant="default" />
        <KpiCard label="Totale anno corrente" value={formatEur(totaleAnno)} variant="accent" />
      </div>

      {/* Lista bollette */}
      <div>
        <SectionTitle className="mb-2">Bollette</SectionTitle>
        {(!data || data.length === 0) ? (
          <EmptyState icon={<Receipt size={32} />} title="Nessuna bolletta registrata" />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--gam-border)]">
                <th className="gam-label text-left py-2 pr-3">Fornitore</th>
                <th className="gam-label text-left py-2 pr-3">Commodity</th>
                <th className="gam-label text-left py-2 pr-3">Periodo</th>
                <th className="gam-label text-right py-2 pr-3">kWh</th>
                <th className="gam-label text-right py-2">Importo</th>
              </tr>
            </thead>
            <tbody>
              {data.map(b => (
                <tr
                  key={b.invoice_id}
                  className="border-b border-[var(--gam-border)]/40 hover:bg-[var(--gam-bg-tertiary)]/50"
                >
                  <td className="py-2 pr-3 text-[var(--gam-text-primary)]">
                    {b.fornitore ?? '–'}
                  </td>
                  <td className="py-2 pr-3 text-[var(--gam-text-secondary)]">{b.commodity}</td>
                  <td className="py-2 pr-3 text-[var(--gam-text-muted)]">
                    {formatDate(b.periodo_inizio)} – {formatDate(b.periodo_fine)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-[var(--gam-text-secondary)]">
                    {b.kwh != null ? formatNumber(b.kwh, 0) : '–'}
                  </td>
                  <td className="py-2 text-right font-mono text-[var(--gam-accent)]">
                    {formatEur(b.importo_eur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── AssetDetailModal principale ──────────────────────────────────────
export function AssetDetailModal({ open, onOpenChange, assetId }: AssetDetailModalProps) {
  const [showDocs, setShowDocs] = useState(false);
  const [showWO, setShowWO] = useState(false);
  const [showDeadlines, setShowDeadlines] = useState(false);

  const { data: asset, loading, error } = useApi(
    () => assets.get(assetId!),
    [assetId],
    open && assetId != null,
  );

  const { data: alarmCount } = useApi(
    () => alarms.byAsset(assetId!).then(l => l.filter(a => !a.acknowledged).length),
    [assetId],
    open && assetId != null,
  );

  const TABS = [
    { value: 'anagrafica', icon: <Info size={12} />, label: 'Anagrafica' },
    { value: 'consumi', icon: <Zap size={12} />, label: 'Consumi' },
    { value: 'allarmi', icon: <Bell size={12} />, label: 'Allarmi', badge: alarmCount ?? 0 },
    { value: 'esg', icon: <Leaf size={12} />, label: 'Efficienza' },
    { value: 'impianti', icon: <Settings size={12} />, label: 'Impianti' },
    { value: 'zone', icon: <LayoutGrid size={12} />, label: 'Zone & Occ.' },
    { value: 'bollette', icon: <Receipt size={12} />, label: 'Tariffe & Bollette' },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[var(--gam-bg-secondary)] border-[var(--gam-border)] max-w-5xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
          {/* Header */}
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-[var(--gam-border)] shrink-0">
            {loading ? (
              <div className="h-6 w-64 bg-[var(--gam-bg-tertiary)] rounded animate-pulse" />
            ) : asset ? (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <DialogTitle className="text-[var(--gam-text-primary)] font-display text-base leading-tight">
                    {asset.codice} — {asset.nome}
                  </DialogTitle>
                  <p className="text-xs text-[var(--gam-text-muted)] mt-0.5 flex items-center gap-1">
                    <MapPin size={11} />
                    {asset.tipo} · {asset.citta}
                    {asset.provincia ? ` (${asset.provincia})` : ''}
                  </p>
                </div>
                {/* Quick actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className="flex items-center gap-1 text-[10px] text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors px-2 py-1 rounded border border-[var(--gam-border)] hover:border-[var(--gam-accent)]"
                    onClick={() => setShowDocs(true)}
                  >
                    <FileText size={11} /> Documenti
                  </button>
                  <button
                    className="flex items-center gap-1 text-[10px] text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors px-2 py-1 rounded border border-[var(--gam-border)] hover:border-[var(--gam-accent)]"
                    onClick={() => setShowWO(true)}
                  >
                    <Wrench size={11} /> Work Order
                  </button>
                  <button
                    className="flex items-center gap-1 text-[10px] text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors px-2 py-1 rounded border border-[var(--gam-border)] hover:border-[var(--gam-accent)]"
                    onClick={() => setShowDeadlines(true)}
                  >
                    <CalendarClock size={11} /> Scadenze
                  </button>
                </div>
              </div>
            ) : null}
          </DialogHeader>

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {loading && <LoadingSpinner label="Caricamento asset…" className="flex-1" />}
            {error && <ErrorState message={error} className="flex-1" />}
            {!loading && !error && asset && (
              <Tabs defaultValue="anagrafica" className="flex flex-col flex-1 overflow-hidden">
                <TabsList className="shrink-0 px-5 pt-2 bg-transparent border-b border-[var(--gam-border)] rounded-none justify-start gap-0 h-auto">
                  {TABS.map(tab => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--gam-accent)] data-[state=active]:text-[var(--gam-accent)] text-[var(--gam-text-secondary)] hover:text-[var(--gam-text-primary)] transition-colors bg-transparent"
                    >
                      {tab.icon}
                      {tab.label}
                      {tab.badge != null && tab.badge > 0 && (
                        <span className="ml-0.5 bg-[var(--gam-danger)] text-white text-[9px] px-1 rounded-full">
                          {tab.badge}
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <TabsContent value="anagrafica" className="mt-0">
                    <TabAnagrafica asset={asset} />
                  </TabsContent>
                  <TabsContent value="consumi" className="mt-0">
                    <TabConsumi assetId={asset.id} />
                  </TabsContent>
                  <TabsContent value="allarmi" className="mt-0">
                    <TabAllarmi assetId={asset.id} />
                  </TabsContent>
                  <TabsContent value="esg" className="mt-0">
                    <TabEfficienza assetId={asset.id} />
                  </TabsContent>
                  <TabsContent value="impianti" className="mt-0">
                    <TabImpianti assetId={asset.id} />
                  </TabsContent>
                  <TabsContent value="zone" className="mt-0">
                    <TabZone assetId={asset.id} />
                  </TabsContent>
                  <TabsContent value="bollette" className="mt-0">
                    <TabBollette assetId={asset.id} />
                  </TabsContent>
                </div>
              </Tabs>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modali filtrate per asset */}
      {asset && (
        <>
          <DocumentsModal
            open={showDocs}
            onOpenChange={setShowDocs}
            assetId={asset.id}
            assetNome={asset.nome}
          />
          <WorkOrdersModal
            open={showWO}
            onOpenChange={setShowWO}
            assetId={asset.id}
            assetNome={asset.nome}
          />
          <DeadlinesModal
            open={showDeadlines}
            onOpenChange={setShowDeadlines}
            assetId={asset.id}
            assetNome={asset.nome}
          />
        </>
      )}
    </>
  );
}
