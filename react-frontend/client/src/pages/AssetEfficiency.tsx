/**
 * AssetEfficiency — Modulo Asset Efficiency
 * Layout: sidebar sinistra (KPI portfolio + ranking) + mappa efficienza destra
 * I marker sono colorati per efficiency_score (verde/arancio/rosso)
 * Apre AssetDetailModal al click su marker o card ranking
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { energy, efficiency } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { AssetDetailModal } from '@/components/modals/AssetDetailModal';
import { KpiCard } from '@/components/shared/KpiCard';
import { ChartBar } from '@/components/shared/Charts';
import { LoadingSpinner, EmptyState, SectionTitle } from '@/components/shared/Primitives';
import { formatKwh, formatNumber } from '@/lib/utils';
import {
  MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, JAWG_TOKEN,
  COLOR_SUCCESS, COLOR_WARNING, COLOR_DANGER,
} from '@/lib/constants';
import { Zap, TrendingDown, TrendingUp, AlertTriangle, Leaf } from 'lucide-react';

// ── Tipi locali ──────────────────────────────────────────────────────
interface EnergyHeatmapItem {
  asset_id: number;
  nome: string;
  tipo: string;
  lat: number;
  lon: number;
  kwh_oggi: number;
  kwh_m2_oggi: number;
  efficiency_score: number;
  efficiency_level: 'alta' | 'media' | 'bassa';
}

interface EnergySummaryItem {
  asset_id: number;
  nome: string;
  tipo: string;
  kwh_m2_oggi: number;
  kwh_giorno: number;
  co2_kg_giorno: number;
  rating_esg: string | null;
  kwh_mq: number;
}

interface EnergyAnomalyItem {
  asset_id: number;
  nome: string;
  tipo: string;
  variazione_pct: number;
  kwh_recenti: number;
  kwh_storici: number;
}

// ── Colori efficienza ────────────────────────────────────────────────
const EFFICIENCY_COLOR: Record<string, string> = {
  alta: COLOR_SUCCESS,
  media: COLOR_WARNING,
  bassa: COLOR_DANGER,
};

// ── Hook mappa Leaflet efficienza ────────────────────────────────────
function useEfficiencyMap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onMarkerClick: (assetId: number) => void,
) {
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<Map<number, import('leaflet').Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
    });

    L.tileLayer(
      `https://tile.jawg.io/jawg-dark/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`,
      { attribution: '&copy; <a href="https://jawg.io">Jawg Maps</a>', maxZoom: 20 },
    ).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [containerRef]);

  const updateMarkers = useCallback(
    (items: EnergyHeatmapItem[], selectedId: number | null) => {
      if (!mapRef.current) return;
      const map = mapRef.current;
      const existing = markersRef.current;

      items.forEach(item => {
        const color = EFFICIENCY_COLOR[item.efficiency_level] ?? '#7BAFC4';
        const isSelected = item.asset_id === selectedId;
        const size = isSelected ? 36 : 28;

        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:${size}px;height:${size}px;
            border-radius:50% 50% 50% 0;transform:rotate(-45deg);
            background:${color};border:2px solid ${isSelected ? '#fff' : color};
            box-shadow:0 2px 8px rgba(0,0,0,0.4)${isSelected ? ',0 0 0 3px rgba(255,255,255,0.3)' : ''};
          "></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size],
        });

        const tooltipHtml = `
          <div style="font-size:11px;line-height:1.4;">
            <strong>${item.nome}</strong><br/>
            Score: ${item.efficiency_score.toFixed(0)} · ${item.kwh_m2_oggi.toFixed(3)} kWh/m²
          </div>`;

        if (existing.has(item.asset_id)) {
          const m = existing.get(item.asset_id)!;
          m.setIcon(icon);
        } else {
          const marker = L.marker([item.lat, item.lon], { icon });
          marker.on('click', () => onMarkerClick(item.asset_id));
          marker.bindTooltip(tooltipHtml, {
            permanent: false, direction: 'top', className: 'gam-tooltip',
          });
          marker.addTo(map);
          existing.set(item.asset_id, marker);
        }
      });

      // Rimuovi marker non più presenti
      const ids = new Set(items.map(i => i.asset_id));
      existing.forEach((marker, id) => {
        if (!ids.has(id)) { marker.remove(); existing.delete(id); }
      });
    },
    [onMarkerClick],
  );

  const flyTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.flyTo([lat, lng], 15, { duration: 0.8 });
  }, []);

  return { updateMarkers, flyTo };
}

// ── Badge efficienza ─────────────────────────────────────────────────
function EfficiencyBadge({ level }: { level: string }) {
  const color = EFFICIENCY_COLOR[level] ?? '#7BAFC4';
  const label = level === 'alta' ? 'Alta' : level === 'media' ? 'Media' : 'Bassa';
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {label}
    </span>
  );
}

// ── Card ranking asset ───────────────────────────────────────────────
function RankingCard({
  item,
  selected,
  onClick,
}: {
  item: EnergyHeatmapItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`w-full text-left p-2.5 rounded-lg border transition-all duration-150 ${
        selected
          ? 'border-[var(--gam-accent)] bg-[var(--gam-accent)]/10'
          : 'border-[var(--gam-border)] bg-[var(--gam-bg-tertiary)] hover:border-[var(--gam-accent)]/50'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-xs font-semibold text-[var(--gam-text-primary)] truncate">{item.nome}</p>
        <EfficiencyBadge level={item.efficiency_level} />
      </div>
      <div className="flex items-center gap-3 text-[10px] text-[var(--gam-text-muted)]">
        <span>Score: <span className="font-mono" style={{ color: EFFICIENCY_COLOR[item.efficiency_level] }}>
          {item.efficiency_score.toFixed(0)}
        </span></span>
        <span>{item.kwh_m2_oggi.toFixed(3)} kWh/m²</span>
      </div>
    </button>
  );
}

// ── Pagina principale ────────────────────────────────────────────────
export default function AssetEfficiency() {
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filterLevel, setFilterLevel] = useState<'tutti' | 'alta' | 'media' | 'bassa'>('tutti');

  const mapContainerRef = useRef<HTMLDivElement>(null);

  const { data: rawHeatmap, loading: loadingHeatmap } = useApi(
    () => energy.heatmap() as Promise<EnergyHeatmapItem[]>,
    [],
  );
  const { data: rawSummary } = useApi(
    () => energy.summary() as Promise<EnergySummaryItem[]>,
    [],
  );
  const { data: rawAnomalies } = useApi(
    () => energy.anomalies() as Promise<EnergyAnomalyItem[]>,
    [],
  );
  const { data: rawPortfolio } = useApi(
    () => efficiency.portfolioSummary() as Promise<unknown>,
    [],
  );

  const heatmap = rawHeatmap ?? [];
  const summary = rawSummary ?? [];
  const anomalies = rawAnomalies ?? [];

  // KPI portfolio
  const alta = heatmap.filter(i => i.efficiency_level === 'alta').length;
  const media = heatmap.filter(i => i.efficiency_level === 'media').length;
  const bassa = heatmap.filter(i => i.efficiency_level === 'bassa').length;
  const totalKwh = heatmap.reduce((s, i) => s + (i.kwh_oggi ?? 0), 0);
  const avgScore = heatmap.length > 0
    ? heatmap.reduce((s, i) => s + i.efficiency_score, 0) / heatmap.length
    : 0;

  // Filtro ranking
  const filtered = filterLevel === 'tutti'
    ? heatmap
    : heatmap.filter(i => i.efficiency_level === filterLevel);

  // Mappa
  const handleMarkerClick = useCallback((assetId: number) => {
    setSelectedAssetId(assetId);
    setModalOpen(true);
  }, []);

  const { updateMarkers, flyTo } = useEfficiencyMap(mapContainerRef, handleMarkerClick);

  useEffect(() => {
    if (heatmap.length === 0) return;
    updateMarkers(heatmap, selectedAssetId);
  }, [heatmap, selectedAssetId, updateMarkers]);

  useEffect(() => {
    if (!selectedAssetId) return;
    const item = heatmap.find(i => i.asset_id === selectedAssetId);
    if (item) flyTo(item.lat, item.lon);
  }, [selectedAssetId, heatmap, flyTo]);

  function openAsset(id: number) {
    setSelectedAssetId(id);
    setModalOpen(true);
  }

  // Dati grafico consumi per asset (top 8)
  const chartData = [...summary]
    .sort((a, b) => (b.kwh_giorno ?? 0) - (a.kwh_giorno ?? 0))
    .slice(0, 8)
    .map(s => ({ nome: s.nome.length > 12 ? s.nome.slice(0, 12) + '…' : s.nome, kwh: s.kwh_giorno ?? 0 }));

  return (
    <div className="flex flex-col h-full">
      {/* KPI bar */}
      <div className="shrink-0 grid grid-cols-5 gap-3 px-4 py-3 border-b border-[var(--gam-border)]">
        <KpiCard
          label="Alta efficienza"
          value={alta}
          icon={<Leaf size={14} />}
          variant="success"
        />
        <KpiCard
          label="Media efficienza"
          value={media}
          icon={<Zap size={14} />}
          variant="warning"
        />
        <KpiCard
          label="Bassa efficienza"
          value={bassa}
          icon={<AlertTriangle size={14} />}
          variant={bassa > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="kWh oggi (totale)"
          value={formatKwh(totalKwh)}
          icon={<Zap size={14} />}
          variant="accent"
        />
        <KpiCard
          label="Score medio"
          value={`${avgScore.toFixed(0)}/100`}
          icon={<TrendingUp size={14} />}
          variant={avgScore >= 70 ? 'success' : avgScore >= 40 ? 'warning' : 'danger'}
        />
      </div>

      {/* Layout principale */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar sinistra */}
        <aside className="w-72 shrink-0 flex flex-col border-r border-[var(--gam-border)] bg-[var(--gam-bg-secondary)] overflow-hidden">
          {/* Filtro livello */}
          <div className="shrink-0 px-3 py-3 border-b border-[var(--gam-border)] flex flex-col gap-2">
            <div className="flex gap-1">
              {(['tutti', 'alta', 'media', 'bassa'] as const).map(l => (
                <button
                  key={l}
                  className={`flex-1 text-[10px] py-1 rounded transition-colors capitalize ${
                    filterLevel === l
                      ? 'bg-[var(--gam-accent)] text-white'
                      : 'text-[var(--gam-text-secondary)] hover:text-[var(--gam-text-primary)] border border-[var(--gam-border)]'
                  }`}
                  onClick={() => setFilterLevel(l)}
                >
                  {l === 'tutti' ? 'Tutti' : l.charAt(0).toUpperCase() + l.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--gam-text-muted)]">
              {filtered.length} asset
            </p>
          </div>

          {/* Ranking */}
          <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
            {loadingHeatmap && <LoadingSpinner />}
            {!loadingHeatmap && filtered.length === 0 && (
              <EmptyState icon={<Leaf size={28} />} title="Nessun dato disponibile" />
            )}
            {!loadingHeatmap && filtered
              .sort((a, b) => b.efficiency_score - a.efficiency_score)
              .map(item => (
                <RankingCard
                  key={item.asset_id}
                  item={item}
                  selected={item.asset_id === selectedAssetId}
                  onClick={() => openAsset(item.asset_id)}
                />
              ))}
          </div>

          {/* Grafico consumi */}
          {chartData.length > 0 && (
            <div className="shrink-0 px-3 py-3 border-t border-[var(--gam-border)]">
              <SectionTitle className="mb-2 text-[10px]">kWh oggi per asset</SectionTitle>
              <ChartBar
                data={chartData}
                bars={[{ key: 'kwh', label: 'kWh', color: 'var(--gam-accent)' }]}
                xKey="nome"
                height={120}
                formatter={(v: number) => `${formatNumber(v, 0)} kWh`}
              />
            </div>
          )}

          {/* Anomalie */}
          {anomalies.length > 0 && (
            <div className="shrink-0 px-3 py-3 border-t border-[var(--gam-border)]">
              <SectionTitle className="mb-2 text-[10px] flex items-center gap-1">
                <AlertTriangle size={11} className="text-[var(--gam-warning)]" />
                Anomalie rilevate
              </SectionTitle>
              {anomalies.slice(0, 3).map(a => (
                <div key={a.asset_id} className="flex items-center justify-between py-1 border-b border-[var(--gam-border)]/40 last:border-0">
                  <p className="text-[10px] text-[var(--gam-text-secondary)] truncate">{a.nome}</p>
                  <span
                    className="text-[10px] font-mono flex items-center gap-0.5"
                    style={{ color: a.variazione_pct > 0 ? 'var(--gam-danger)' : 'var(--gam-success)' }}
                  >
                    {a.variazione_pct > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {Math.abs(a.variazione_pct).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Mappa */}
        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="absolute inset-0" />
          {loadingHeatmap && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--gam-bg-primary)]/60 z-10">
              <LoadingSpinner label="Caricamento dati efficienza…" />
            </div>
          )}
          {/* Legenda */}
          <div className="absolute bottom-4 right-4 z-10 bg-[var(--gam-bg-secondary)]/90 backdrop-blur-sm border border-[var(--gam-border)] rounded-lg p-3 text-xs">
            <p className="gam-label mb-2">Efficienza energetica</p>
            {[
              { level: 'alta', label: 'Alta (score ≥ 70)' },
              { level: 'media', label: 'Media (40–70)' },
              { level: 'bassa', label: 'Bassa (< 40)' },
            ].map(({ level, label }) => (
              <div key={level} className="flex items-center gap-2 mb-1 last:mb-0">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: EFFICIENCY_COLOR[level] }}
                />
                <span className="text-[var(--gam-text-secondary)]">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modale dettaglio */}
      <AssetDetailModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        assetId={selectedAssetId}
      />
    </div>
  );
}
