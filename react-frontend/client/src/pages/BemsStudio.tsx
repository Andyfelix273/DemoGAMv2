/**
 * BemsStudio — Modulo BEMS Studio
 * Layout: header (asset selector + floor tabs + mode) + main (floorplan SVG + sidebar KPI)
 * Modalità: Occupancy | Energia | Temperatura | CO₂
 * Sidebar: KPI piano + lista zone + grafici impianti
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { assets, bems } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { ZoneCard } from '@/components/shared/ZoneCard';
import { KpiCard } from '@/components/shared/KpiCard';
import { ChartLine } from '@/components/shared/Charts';
import { LoadingSpinner, EmptyState, SectionTitle } from '@/components/shared/Primitives';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatKw, formatNumber, groupBy } from '@/lib/utils';
import {
  ZONA_TIPO_LABEL, ZONA_TIPO_ICON,
  CO2_CRITICAL_PPM, CO2_WARNING_PPM, TEMP_MIN_C, TEMP_MAX_C,
  OCC_HIGH_THRESHOLD, LIVE_REFRESH_INTERVAL,
} from '@/lib/constants';
import {
  Users, Zap, Thermometer, Wind, ChevronRight, RefreshCw,
} from 'lucide-react';
import type { Asset, Zona, TelemetriaMap, TelemetriaZona, Impianto } from '@/lib/types';

// ── Tipi ─────────────────────────────────────────────────────────────
type FloorplanMode = 'occupancy' | 'energy' | 'temp' | 'co2';

interface Floor {
  floor_id: string;
  nome: string;
  level: number;
  svg_file: string | null;
}

// ── Configurazione modalità ──────────────────────────────────────────
const MODE_CONFIG: Record<FloorplanMode, {
  label: string;
  icon: React.ReactNode;
  legendTitle: string;
  legendMin: string;
  legendMax: string;
  gradient: string;
}> = {
  occupancy: {
    label: 'Occupancy',
    icon: <Users size={12} />,
    legendTitle: 'Occupancy',
    legendMin: 'Libera',
    legendMax: 'Piena',
    gradient: 'linear-gradient(to right, #95A5A6, #27AE60)',
  },
  energy: {
    label: 'Energia',
    icon: <Zap size={12} />,
    legendTitle: 'Potenza (kW)',
    legendMin: '0 kW',
    legendMax: '> 3 kW',
    gradient: 'linear-gradient(to right, #27AE60, #F39C12, #E74C3C)',
  },
  temp: {
    label: 'Temperatura',
    icon: <Thermometer size={12} />,
    legendTitle: 'Temperatura',
    legendMin: '< 19°C',
    legendMax: '> 24°C',
    gradient: 'linear-gradient(to right, #3498DB, #27AE60, #F39C12, #E74C3C)',
  },
  co2: {
    label: 'CO₂',
    icon: <Wind size={12} />,
    legendTitle: 'CO₂ (ppm)',
    legendMin: '< 600',
    legendMax: '> 900',
    gradient: 'linear-gradient(to right, #27AE60, #F39C12, #E74C3C)',
  },
};

// ── Calcola colore zona per modalità ────────────────────────────────
function getZoneColor(tel: TelemetriaZona | undefined, zona: Zona, mode: FloorplanMode): string {
  if (!tel) return 'rgba(100,130,160,0.3)';

  switch (mode) {
    case 'occupancy': {
      if (zona.capacita_persone === 0) return 'rgba(100,130,160,0.2)';
      if (tel.occupancy === null) return 'rgba(100,130,160,0.3)';
      const pct = tel.persone_presenti != null && zona.capacita_persone > 0
        ? (tel.persone_presenti / zona.capacita_persone) * 100
        : (tel.occupancy_pct ?? 0);
      if (pct >= OCC_HIGH_THRESHOLD) return 'rgba(231,76,60,0.5)';
      if (pct >= 50) return 'rgba(243,156,18,0.5)';
      return tel.occupancy ? 'rgba(39,174,96,0.4)' : 'rgba(149,165,166,0.3)';
    }
    case 'energy': {
      const kw = tel.power_kw ?? 0;
      if (kw >= 3) return 'rgba(231,76,60,0.5)';
      if (kw >= 1) return 'rgba(243,156,18,0.5)';
      if (kw > 0) return 'rgba(39,174,96,0.4)';
      return 'rgba(100,130,160,0.2)';
    }
    case 'temp': {
      const t = tel.temp_c;
      if (t == null) return 'rgba(100,130,160,0.2)';
      if (t > TEMP_MAX_C) return 'rgba(231,76,60,0.5)';
      if (t < TEMP_MIN_C) return 'rgba(52,152,219,0.5)';
      return 'rgba(39,174,96,0.4)';
    }
    case 'co2': {
      const co2 = tel.co2_ppm;
      if (co2 == null) return 'rgba(100,130,160,0.2)';
      if (co2 >= CO2_CRITICAL_PPM) return 'rgba(231,76,60,0.5)';
      if (co2 >= CO2_WARNING_PPM) return 'rgba(243,156,18,0.5)';
      return 'rgba(39,174,96,0.4)';
    }
  }
}

// ── Hook floorplan SVG ───────────────────────────────────────────────
function useFloorplanSvg(
  containerRef: React.RefObject<HTMLDivElement | null>,
  zones: Zona[],
  telMap: TelemetriaMap | null,
  mode: FloorplanMode,
  onZoneClick: (zoneId: string) => void,
) {
  const listenersRef = useRef<Array<() => void>>([]);

  const colorizeZones = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const zoneMap = new Map(zones.map(z => [z.zone_id, z]));

    // Colora elementi SVG con data-zone-id
    container.querySelectorAll<SVGElement>('[data-zone-id]').forEach(el => {
      const zoneId = el.getAttribute('data-zone-id');
      if (!zoneId) return;
      const zona = zoneMap.get(zoneId);
      const tel = telMap?.[zoneId];
      const color = getZoneColor(tel, zona ?? { capacita_persone: 0 } as Zona, mode);
      el.style.fill = color;
      el.style.cursor = 'pointer';
    });
  }, [containerRef, zones, telMap, mode]);

  const attachEvents = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Rimuovi listener precedenti
    listenersRef.current.forEach(cleanup => cleanup());
    listenersRef.current = [];

    container.querySelectorAll<SVGElement>('[data-zone-id]').forEach(el => {
      const zoneId = el.getAttribute('data-zone-id');
      if (!zoneId) return;

      const handleClick = () => onZoneClick(zoneId);
      el.addEventListener('click', handleClick);
      listenersRef.current.push(() => el.removeEventListener('click', handleClick));
    });
  }, [containerRef, onZoneClick]);

  // Ricolorazione quando cambiano dati o modalità
  useEffect(() => {
    colorizeZones();
  }, [colorizeZones]);

  return { colorizeZones, attachEvents };
}

// ── Componente principale ────────────────────────────────────────────
export default function BemsStudio() {
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [mode, setMode] = useState<FloorplanMode>('occupancy');
  const [svgLoading, setSvgLoading] = useState(false);
  const [svgError, setSvgError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const svgContainerRef = useRef<HTMLDivElement>(null);

  // Carica lista asset
  const { data: assetList } = useApi(() => assets.list(), []);

  // Carica floors dell'asset selezionato
  const { data: floors } = useApi(
    () => bems.floors(selectedAssetId!),
    [selectedAssetId],
    selectedAssetId != null,
  );

  // Carica zone e telemetria
  const { data: rawZones, refetch: refetchZones } = useApi(
    () => bems.zones(selectedAssetId!),
    [selectedAssetId],
    selectedAssetId != null,
  );
  const zones: Zona[] = rawZones ?? [];

  const { data: telMap, refetch: refetchTel } = useApi(
    () => bems.telemetryLatest(selectedAssetId!),
    [selectedAssetId],
    selectedAssetId != null,
  );

  // Carica impianti
  const { data: rawPlants } = useApi(
    () => bems.plants(selectedAssetId!),
    [selectedAssetId],
    selectedAssetId != null,
  );
  const plants: Impianto[] = rawPlants ?? [];

  // Carica storico telemetria per grafici
  const { data: rawHistory } = useApi(
    () => bems.consumiTimeseries(selectedAssetId!, 24),
    [selectedAssetId],
    selectedAssetId != null,
  );

  const historyData = (rawHistory ?? []).map(d => ({
    t: new Date(d.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    kw: d.power_kw,
  }));

  // Zone del piano corrente
  const floorZones: Zona[] = selectedFloorId
    ? zones.filter(z => z.floor_id === selectedFloorId)
    : zones;

  // KPI piano
  const totalPresenti = floorZones.reduce(
    (s, z) => s + (telMap?.[z.zone_id]?.persone_presenti ?? 0), 0,
  );
  const zoneOccupate = floorZones.filter(z => telMap?.[z.zone_id]?.occupancy).length;
  const avgTemp = (() => {
    const vals = floorZones.map(z => telMap?.[z.zone_id]?.temp_c).filter(v => v != null) as number[];
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  })();
  const avgCo2 = (() => {
    const vals = floorZones.map(z => telMap?.[z.zone_id]?.co2_ppm).filter(v => v != null) as number[];
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  })();
  const totalPower = floorZones.reduce(
    (s, z) => s + (telMap?.[z.zone_id]?.power_kw ?? 0), 0,
  );

  // Zona selezionata
  const selectedZone = zones.find(z => z.zone_id === selectedZoneId);
  const selectedZoneTel = selectedZoneId ? telMap?.[selectedZoneId] : undefined;

  // Hook SVG
  const { colorizeZones, attachEvents } = useFloorplanSvg(
    svgContainerRef,
    floorZones,
    telMap ?? null,
    mode,
    (zoneId) => setSelectedZoneId(prev => prev === zoneId ? null : zoneId),
  );

  // Carica SVG quando cambia piano
  useEffect(() => {
    if (!selectedFloorId || !floors) return;
    const floor = floors.find(f => f.floor_id === selectedFloorId);
    if (!floor?.svg_file) {
      setSvgError('Nessuna planimetria disponibile per questo piano');
      return;
    }

    setSvgLoading(true);
    setSvgError(null);

    const token = localStorage.getItem('gam_token');
    fetch(`/static/${floor.svg_file}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => {
        if (!r.ok) throw new Error(`SVG non trovato: ${floor.svg_file}`);
        return r.text();
      })
      .then(svgText => {
        if (!svgContainerRef.current) return;
        svgContainerRef.current.innerHTML = svgText;
        const svg = svgContainerRef.current.querySelector('svg');
        if (svg) {
          svg.removeAttribute('width');
          svg.removeAttribute('height');
          svg.style.maxWidth = '100%';
          svg.style.maxHeight = '100%';
        }
        attachEvents();
        colorizeZones();
        setSvgLoading(false);
      })
      .catch(err => {
        setSvgError(err.message);
        setSvgLoading(false);
      });
  }, [selectedFloorId, floors]);

  // Ricolorazione quando cambiano dati o modalità
  useEffect(() => {
    colorizeZones();
  }, [telMap, mode, colorizeZones]);

  // Auto-refresh telemetria
  useEffect(() => {
    if (!selectedAssetId) return;
    const interval = setInterval(() => {
      refetchTel();
      setLastUpdate(new Date());
    }, LIVE_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [selectedAssetId, refetchTel]);

  // Selezione primo asset e primo piano
  useEffect(() => {
    if (assetList && assetList.length > 0 && !selectedAssetId) {
      setSelectedAssetId(assetList[0].id);
    }
  }, [assetList, selectedAssetId]);

  useEffect(() => {
    if (floors && floors.length > 0 && !selectedFloorId) {
      setSelectedFloorId(floors[0].floor_id);
    }
  }, [floors, selectedFloorId]);

  const modeConfig = MODE_CONFIG[mode];

  return (
    <div className="flex flex-col h-full">
      {/* Header toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--gam-border)] bg-[var(--gam-bg-secondary)]">
        {/* Asset selector */}
        <select
          className="gam-input text-xs max-w-48"
          value={selectedAssetId ?? ''}
          onChange={e => {
            setSelectedAssetId(Number(e.target.value));
            setSelectedFloorId(null);
            setSelectedZoneId(null);
          }}
        >
          {!assetList && <option value="">Caricamento…</option>}
          {assetList?.map(a => (
            <option key={a.id} value={a.id}>{a.nome}</option>
          ))}
        </select>

        {/* Floor tabs */}
        <div className="flex items-center gap-1">
          {(floors ?? []).map(f => (
            <button
              key={f.floor_id}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                selectedFloorId === f.floor_id
                  ? 'bg-[var(--gam-accent)] text-white'
                  : 'text-[var(--gam-text-secondary)] hover:text-[var(--gam-text-primary)] border border-[var(--gam-border)]'
              }`}
              onClick={() => { setSelectedFloorId(f.floor_id); setSelectedZoneId(null); }}
            >
              {f.nome}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-[var(--gam-border)]" />

        {/* Mode buttons */}
        {(Object.entries(MODE_CONFIG) as [FloorplanMode, typeof MODE_CONFIG[FloorplanMode]][]).map(([m, cfg]) => (
          <button
            key={m}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors ${
              mode === m
                ? 'bg-[var(--gam-accent)] text-white'
                : 'text-[var(--gam-text-secondary)] hover:text-[var(--gam-text-primary)] border border-[var(--gam-border)]'
            }`}
            onClick={() => setMode(m)}
          >
            {cfg.icon}
            {cfg.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {lastUpdate && (
            <span className="text-[10px] text-[var(--gam-text-muted)]">
              Aggiornato: {lastUpdate.toLocaleTimeString('it-IT')}
            </span>
          )}
          <button
            className="flex items-center gap-1 text-[10px] text-[var(--gam-text-secondary)] hover:text-[var(--gam-accent)] transition-colors"
            onClick={() => { refetchTel(); setLastUpdate(new Date()); }}
          >
            <RefreshCw size={11} /> Aggiorna
          </button>
        </div>
      </div>

      {/* KPI bar */}
      {selectedAssetId && (
        <div className="shrink-0 grid grid-cols-5 gap-3 px-4 py-2 border-b border-[var(--gam-border)]">
          <KpiCard label="Presenti" value={totalPresenti} icon={<Users size={12} />} variant="accent" />
          <KpiCard
            label="Zone occupate"
            value={`${zoneOccupate}/${floorZones.length}`}
            icon={<Users size={12} />}
            variant={zoneOccupate > 0 ? 'success' : 'default'}
          />
          <KpiCard label="Potenza totale" value={formatKw(totalPower)} icon={<Zap size={12} />} variant="warning" />
          <KpiCard
            label="Temp. media"
            value={avgTemp != null ? `${avgTemp.toFixed(1)}°C` : '–'}
            icon={<Thermometer size={12} />}
            variant={avgTemp != null && (avgTemp > TEMP_MAX_C || avgTemp < TEMP_MIN_C) ? 'danger' : 'default'}
          />
          <KpiCard
            label="CO₂ media"
            value={avgCo2 != null ? `${Math.round(avgCo2)} ppm` : '–'}
            icon={<Wind size={12} />}
            variant={avgCo2 != null && avgCo2 >= CO2_CRITICAL_PPM ? 'danger' : avgCo2 != null && avgCo2 >= CO2_WARNING_PPM ? 'warning' : 'default'}
          />
        </div>
      )}

      {/* Main: floorplan + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Floorplan */}
        <div className="flex-1 relative bg-[var(--gam-bg-primary)] overflow-hidden">
          {!selectedAssetId && (
            <div className="absolute inset-0 flex items-center justify-center">
              <EmptyState
                icon={<Zap size={32} />}
                title="Seleziona un asset"
                description="Scegli un edificio per visualizzare la planimetria BEMS"
              />
            </div>
          )}

          {selectedAssetId && svgLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <LoadingSpinner label="Caricamento planimetria…" />
            </div>
          )}

          {selectedAssetId && svgError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <EmptyState
                icon={<Zap size={32} />}
                title="Planimetria non disponibile"
                description={svgError}
              />
            </div>
          )}

          {/* SVG container */}
          <div
            ref={svgContainerRef}
            className="absolute inset-0 flex items-center justify-center p-4"
            style={{ visibility: svgLoading || svgError ? 'hidden' : 'visible' }}
          />

          {/* Legenda */}
          <div className="absolute bottom-4 left-4 z-10 bg-[var(--gam-bg-secondary)]/90 backdrop-blur-sm border border-[var(--gam-border)] rounded-lg p-3">
            <p className="text-[10px] font-semibold text-[var(--gam-text-secondary)] mb-2">
              {modeConfig.legendTitle}
            </p>
            <div
              className="h-2 w-32 rounded"
              style={{ background: modeConfig.gradient }}
            />
            <div className="flex justify-between text-[9px] text-[var(--gam-text-muted)] mt-1">
              <span>{modeConfig.legendMin}</span>
              <span>{modeConfig.legendMax}</span>
            </div>
          </div>
        </div>

        {/* Sidebar destra */}
        <aside className="w-72 shrink-0 flex flex-col border-l border-[var(--gam-border)] bg-[var(--gam-bg-secondary)] overflow-hidden">
          {/* Zona selezionata */}
          {selectedZone && (
            <div className="shrink-0 px-3 py-3 border-b border-[var(--gam-border)] bg-[var(--gam-bg-tertiary)]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[var(--gam-text-primary)]">{selectedZone.nome}</p>
                <StatusBadge
                  type="occupancy"
                  value={selectedZoneTel?.occupancy ? 'occupata' : 'libera'}
                  dot
                />
              </div>
              <p className="text-[10px] text-[var(--gam-text-muted)] mb-2">
                {ZONA_TIPO_LABEL[selectedZone.tipo] ?? selectedZone.tipo} · {selectedZone.zone_id}
              </p>
              {selectedZoneTel && (
                <div className="grid grid-cols-2 gap-1.5">
                  {selectedZoneTel.power_kw != null && (
                    <div className="gam-card p-2 text-center">
                      <p className="text-[10px] text-[var(--gam-text-muted)]">Potenza</p>
                      <p className="text-xs font-mono text-[var(--gam-accent)]">{formatKw(selectedZoneTel.power_kw)}</p>
                    </div>
                  )}
                  {selectedZoneTel.temp_c != null && (
                    <div className="gam-card p-2 text-center">
                      <p className="text-[10px] text-[var(--gam-text-muted)]">Temp.</p>
                      <p className="text-xs font-mono text-[var(--gam-text-primary)]">{selectedZoneTel.temp_c.toFixed(1)}°C</p>
                    </div>
                  )}
                  {selectedZoneTel.co2_ppm != null && (
                    <div className="gam-card p-2 text-center">
                      <p className="text-[10px] text-[var(--gam-text-muted)]">CO₂</p>
                      <p className="text-xs font-mono text-[var(--gam-text-primary)]">{Math.round(selectedZoneTel.co2_ppm)} ppm</p>
                    </div>
                  )}
                  {selectedZoneTel.persone_presenti != null && selectedZone.capacita_persone > 0 && (
                    <div className="gam-card p-2 text-center">
                      <p className="text-[10px] text-[var(--gam-text-muted)]">Persone</p>
                      <p className="text-xs font-mono text-[var(--gam-text-primary)]">
                        {selectedZoneTel.persone_presenti}/{selectedZone.capacita_persone}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Lista zone */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <SectionTitle className="mb-2">Zone piano</SectionTitle>
            {floorZones.length === 0 && (
              <EmptyState icon={<Zap size={24} />} title="Nessuna zona" />
            )}
            <div className="flex flex-col gap-1">
              {floorZones.map(z => (
                <button
                  key={z.zone_id}
                  className={`w-full text-left transition-all ${
                    selectedZoneId === z.zone_id ? 'ring-1 ring-[var(--gam-accent)] rounded-lg' : ''
                  }`}
                  onClick={() => setSelectedZoneId(prev => prev === z.zone_id ? null : z.zone_id)}
                >
                  <ZoneCard
                    zona={z}
                    tel={telMap?.[z.zone_id]}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Impianti */}
          {plants.length > 0 && (
            <div className="shrink-0 px-3 py-3 border-t border-[var(--gam-border)]">
              <SectionTitle className="mb-2">Impianti</SectionTitle>
              <div className="flex flex-col gap-1">
                {plants.map((p: Impianto) => (
                  <div key={p.plant_id} className="flex items-center justify-between py-1 border-b border-[var(--gam-border)]/40 last:border-0">
                    <div>
                      <p className="text-[10px] font-medium text-[var(--gam-text-primary)]">{p.nome}</p>
                      <p className="text-[9px] text-[var(--gam-text-muted)]">{p.plant_id}</p>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--gam-accent)]">
                      {formatKw(p.energia_baseline_kw)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grafico storico */}
          {historyData.length > 0 && (
            <div className="shrink-0 px-3 py-3 border-t border-[var(--gam-border)]">
              <SectionTitle className="mb-2 text-[10px]">Consumi ultime 24h</SectionTitle>
              <ChartLine
                data={historyData}
                lines={[{ key: 'kw', label: 'kW', color: 'var(--gam-accent)' }]}
                xKey="t"
                height={100}
                formatter={(v: number) => `${v.toFixed(2)} kW`}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
