/**
 * AssetManagement — Modulo GIS Asset Manager
 * Layout: sidebar sinistra (filtri + lista) + mappa Leaflet destra
 * Apre AssetDetailModal al click su marker o card lista
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { assets, stats } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { AssetDetailModal } from '@/components/modals/AssetDetailModal';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { KpiCard } from '@/components/shared/KpiCard';
import { LoadingSpinner, EmptyState, SearchBar } from '@/components/shared/Primitives';
import { formatMq } from '@/lib/utils';
import {
  ASSET_TIPO_LABEL, ASSET_STATO_LABEL, MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM,
  JAWG_TOKEN,
} from '@/lib/constants';
import { Building2, MapPin, AlertTriangle, Wrench, CalendarClock } from 'lucide-react';
import type { Asset, AssetFeature } from '@/lib/types';

// Colori marker per stato
const MARKER_COLOR: Record<string, string> = {
  attivo: '#27AE60',
  manutenzione: '#F39C12',
  inattivo: '#E74C3C',
};

// ── Hook mappa Leaflet ───────────────────────────────────────────────
function useLeafletMap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onMarkerClick: (assetId: number) => void,
) {
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<Map<number, import('leaflet').Marker>>(new Map());
  const selectedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      zoomControl: true,
    });

    L.tileLayer(
      `https://tile.jawg.io/jawg-dark/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`,
      {
        attribution: '&copy; <a href="https://jawg.io">Jawg Maps</a>',
        maxZoom: 20,
      },
    ).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [containerRef]);

  const updateMarkers = useCallback(
    (features: AssetFeature[], selectedId: number | null) => {
      if (!mapRef.current) return;

      const map = mapRef.current;
      const existing = markersRef.current;

      features.forEach(f => {
        const { id, stato, tipo } = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const color = MARKER_COLOR[stato] ?? '#7BAFC4';
        const isSelected = id === selectedId;
        const size = isSelected ? 36 : 28;

        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:${size}px;height:${size}px;
            border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            background:${color};
            border:2px solid ${isSelected ? '#fff' : color};
            box-shadow:0 2px 8px rgba(0,0,0,0.4)${isSelected ? ',0 0 0 3px rgba(255,255,255,0.3)' : ''};
          "></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size],
        });

        if (existing.has(id)) {
          existing.get(id)!.setIcon(icon);
        } else {
          const marker = L.marker([lat, lon], { icon });
          marker.on('click', () => onMarkerClick(id));
          marker.bindTooltip(f.properties.nome, {
            permanent: false,
            direction: 'top',
            className: 'gam-tooltip',
          });
          marker.addTo(map);
          existing.set(id, marker);
        }
      });

      // Rimuovi marker non più presenti
      const ids = new Set(features.map(f => f.properties.id));
      existing.forEach((marker, id) => {
        if (!ids.has(id)) {
          marker.remove();
          existing.delete(id);
        }
      });
    },
    [onMarkerClick],
  );

  const flyTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.flyTo([lat, lng], 15, { duration: 0.8 });
  }, []);

  return { updateMarkers, flyTo, selectedRef };
}

// ── Componente card asset nella lista ────────────────────────────────
function AssetListCard({
  asset,
  selected,
  onClick,
}: {
  asset: Asset;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`w-full text-left p-3 rounded-lg border transition-all duration-150 ${
        selected
          ? 'border-[var(--gam-accent)] bg-[var(--gam-accent)]/10'
          : 'border-[var(--gam-border)] bg-[var(--gam-bg-tertiary)] hover:border-[var(--gam-accent)]/50 hover:bg-[var(--gam-bg-tertiary)]'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--gam-text-primary)] truncate">
            {asset.nome}
          </p>
          <p className="text-[10px] text-[var(--gam-text-muted)] truncate">
            {asset.codice} · {ASSET_TIPO_LABEL[asset.tipo] ?? asset.tipo}
          </p>
        </div>
        <StatusBadge type="asset-stato" value={asset.stato} dot />
      </div>
      <div className="flex items-center gap-1 text-[10px] text-[var(--gam-text-muted)]">
        <MapPin size={9} />
        <span className="truncate">{asset.citta}{asset.provincia ? ` (${asset.provincia})` : ''}</span>
        {asset.superficie_mq && (
          <span className="ml-auto shrink-0">{formatMq(asset.superficie_mq)}</span>
        )}
      </div>
    </button>
  );
}

// ── Pagina principale ────────────────────────────────────────────────
export default function AssetManagement() {
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStato, setFilterStato] = useState('tutti');
  const [filterTipo, setFilterTipo] = useState('tutti');

  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Dati
  const { data: geojson, loading: loadingGeo } = useApi(
    () => assets.geojson(),
    [],
  );
  const { data: globalStats } = useApi(() => stats.global(), [], true);

  // Lista asset flat dal geojson
  const allAssets: Asset[] = (geojson?.features ?? []).map(f => f.properties as unknown as Asset);

  // Filtri
  const filtered = allAssets.filter(a => {
    const matchSearch =
      !search ||
      a.nome.toLowerCase().includes(search.toLowerCase()) ||
      a.codice.toLowerCase().includes(search.toLowerCase()) ||
      a.citta.toLowerCase().includes(search.toLowerCase());
    const matchStato = filterStato === 'tutti' || a.stato === filterStato;
    const matchTipo = filterTipo === 'tutti' || a.tipo === filterTipo;
    return matchSearch && matchStato && matchTipo;
  });

  // Tipi unici per il filtro
  const tipiUnici = Array.from(new Set(allAssets.map(a => a.tipo))).sort();

  // Mappa
  const handleMarkerClick = useCallback((assetId: number) => {
    setSelectedAssetId(assetId);
    setModalOpen(true);
  }, []);

  const { updateMarkers, flyTo } = useLeafletMap(mapContainerRef, handleMarkerClick);

  // Aggiorna marker quando cambiano i dati o la selezione
  useEffect(() => {
    if (!geojson) return;
    const visibleIds = new Set(filtered.map(a => a.id));
    const visibleFeatures = geojson.features.filter(f => visibleIds.has(f.properties.id));
    updateMarkers(visibleFeatures, selectedAssetId);
  }, [geojson, filtered, selectedAssetId, updateMarkers]);

  // Vola all'asset selezionato
  useEffect(() => {
    if (!selectedAssetId || !geojson) return;
    const feat = geojson.features.find(f => f.properties.id === selectedAssetId);
    if (feat) {
      const [lon, lat] = feat.geometry.coordinates;
      flyTo(lat, lon);
    }
  }, [selectedAssetId, geojson, flyTo]);

  function openAsset(id: number) {
    setSelectedAssetId(id);
    setModalOpen(true);
  }

  return (
    <div className="flex flex-col h-full">
      {/* KPI bar */}
      {globalStats && (
        <div className="shrink-0 grid grid-cols-5 gap-3 px-4 py-3 border-b border-[var(--gam-border)]">
          <KpiCard
            label="Asset totali"
            value={globalStats.totale_asset}
            icon={<Building2 size={14} />}
            variant="default"
          />
          <KpiCard
            label="Asset attivi"
            value={Object.values(globalStats.per_tipo).reduce((s, v) => s + v, 0)}
            icon={<Building2 size={14} />}
            variant="success"
          />
          <KpiCard
            label="Allarmi attivi"
            value={globalStats.allarmi.totale_attivi}
            icon={<AlertTriangle size={14} />}
            variant={globalStats.allarmi.totale_attivi > 0 ? 'danger' : 'success'}
          />
          <KpiCard
            label="WO aperti"
            value={globalStats.wo_aperti ?? 0}
            icon={<Wrench size={14} />}
            variant={(globalStats.wo_aperti ?? 0) > 0 ? 'warning' : 'success'}
          />
          <KpiCard
            label="Scadenze"
            value={globalStats.scadenze_urgenti ?? 0}
            icon={<CalendarClock size={14} />}
            variant={(globalStats.scadenze_urgenti ?? 0) > 0 ? 'warning' : 'success'}
          />
        </div>
      )}

      {/* Layout principale: sidebar + mappa */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar sinistra */}
        <aside className="w-72 shrink-0 flex flex-col border-r border-[var(--gam-border)] bg-[var(--gam-bg-secondary)] overflow-hidden">
          {/* Filtri */}
          <div className="shrink-0 px-3 py-3 border-b border-[var(--gam-border)] flex flex-col gap-2">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Cerca asset…"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                className="gam-input text-xs"
                value={filterStato}
                onChange={e => setFilterStato(e.target.value)}
              >
                <option value="tutti">Tutti gli stati</option>
                {Object.entries(ASSET_STATO_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <select
                className="gam-input text-xs"
                value={filterTipo}
                onChange={e => setFilterTipo(e.target.value)}
              >
                <option value="tutti">Tutti i tipi</option>
                {tipiUnici.map(t => (
                  <option key={t} value={t}>{ASSET_TIPO_LABEL[t] ?? t}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-[var(--gam-text-muted)]">
              {filtered.length} asset{filtered.length !== allAssets.length ? ` di ${allAssets.length}` : ''}
            </p>
          </div>

          {/* Lista asset */}
          <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
            {loadingGeo && <LoadingSpinner />}
            {!loadingGeo && filtered.length === 0 && (
              <EmptyState
                icon={<Building2 size={28} />}
                title="Nessun asset trovato"
                description="Modifica i filtri di ricerca"
              />
            )}
            {!loadingGeo && filtered.map(a => (
              <AssetListCard
                key={a.id}
                asset={a}
                selected={a.id === selectedAssetId}
                onClick={() => openAsset(a.id)}
              />
            ))}
          </div>
        </aside>

        {/* Mappa */}
        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="absolute inset-0" />
          {loadingGeo && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--gam-bg-primary)]/60 z-10">
              <LoadingSpinner label="Caricamento mappa…" />
            </div>
          )}
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
