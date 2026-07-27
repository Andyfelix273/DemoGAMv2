/**
 * AssetManagement — Mappa GIS Asset Manager
 * Layout identico al vanilla map.html:
 *   - .main-layout (flex row, fixed sotto topbar+sidebar)
 *   - #map (flex:1, Leaflet con tile Jawg Dark + filtro hue-rotate)
 *   - .side-panel (width:420px, pannello destro)
 *     - .panel-header (QUADRO SINOTTICO + live dot)
 *     - .overview-panel (kpi-group WO/Scadenze/Asset + gauges + alert)
 *   - .marker-legend (overlay basso-sinistra)
 *   - Modale dettaglio asset (click marker)
 *
 * Marker: custom-marker circolari con icona FA per tipo asset,
 * colorati per stato operativo (critico/warning/ok/inattivo).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { assets, stats } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { AssetDetailModal } from '@/components/modals/AssetDetailModal';
import { JAWG_TOKEN } from '@/lib/constants';
import type { AssetFeature } from '@/lib/types';

// ── Costanti marker (identiche a map-core.js) ────────────────────────
const ICONE_TIPO: Record<string, string> = {
  stabilimento: 'fa-industry',
  ufficio:      'fa-building',
  magazzino:    'fa-archive',
  deposito:     'fa-truck',
};
const COLORE_MARKER   = '#7BAFC4';
const COLORE_SELECTED = '#F39C12';
const COLORI_STATO: Record<string, string> = {
  critico:  '#E74C3C',
  warning:  '#F39C12',
  ok:       '#27AE60',
  inattivo: '#95A5A6',
};

// ── Tipi per stats operational ───────────────────────────────────────
interface OperationalStats {
  wo_urgenti: number;
  wo_aperti: number;
  wo_completati_mese: number;
  scadenze_7gg: number;
  scadenze_ritardo: number;
  scadenze_totali_aperte: number;
  asset_con_allarmi: number;
  asset_manutenzione: number;
  asset_inattivi: number;
  asset_stati: Record<number, string>;
  da_monitorare?: Array<{ id: number; nome: string; tipo: string; citta: string; livello_max: string }>;
}

// ── Crea icona marker identica a creaIcona() in map-core.js ─────────
function creaIcona(tipo: string, selected: boolean, stato?: string): L.DivIcon {
  const fa = ICONE_TIPO[tipo] ?? 'fa-map-pin';
  let c: string;
  if (selected) {
    c = COLORE_SELECTED;
  } else {
    c = stato ? (COLORI_STATO[stato] ?? COLORI_STATO.ok) : COLORE_MARKER;
  }
  const sc = selected ? ' selected' : '';
  const size = (!selected && stato === 'critico') ? 30 : 26;
  const pulse = (!selected && stato === 'critico')
    ? ' box-shadow:0 0 0 4px rgba(231,76,60,0.3),0 0 0 8px rgba(231,76,60,0.1);animation:pulse-red 1.5s ease-in-out infinite;'
    : '';
  return L.divIcon({
    className: '',
    html: `<div class="custom-marker${sc}" style="color:${c};border-color:${c};width:${size}px;height:${size}px;${pulse}">
             <i class="fa ${fa}" style="color:${c};"></i>
           </div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -15],
  });
}

// ── Gauge SVG semicerchio ────────────────────────────────────────────
function GaugeSvg({ value, max, color }: { value: number; max: number; color: string }) {
  const R = 40;
  const CIRC = Math.PI * R; // ~125.66
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = CIRC * (1 - pct);
  const bc = color === '#27AE60' ? 'ok' : color === '#F39C12' ? 'warn' : 'danger';
  return (
    <svg className="gauge-svg" viewBox="0 0 100 60">
      <path
        className="gauge-track"
        d="M 10,54 A 40,40 0 0,1 90,54"
        strokeDasharray={CIRC.toFixed(2)}
        strokeDashoffset="0"
      />
      <path
        className={`gauge-fill ${bc}`}
        d="M 10,54 A 40,40 0 0,1 90,54"
        strokeDasharray={CIRC.toFixed(2)}
        strokeDashoffset={offset.toFixed(2)}
      />
      <text className="gauge-value" x="50" y="46">
        {value > 0 ? `${Math.round(pct * 100)}%` : '—'}
      </text>
    </svg>
  );
}

// ── Quadro sinottico (pannello destro) ───────────────────────────────
function QuadroSinottico({
  globalStats,
  opStats,
  onGaugeClick,
}: {
  globalStats: any;
  opStats: OperationalStats | null;
  onGaugeClick?: (tipo: string) => void;
}) {
  const ora = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const totale = globalStats?.totale_asset ?? 0;

  const woUrgClass  = (opStats?.wo_urgenti ?? 0) > 0 ? '#E74C3C' : '#27AE60';
  const woApertiClr = (opStats?.wo_aperti ?? 0) > 3 ? '#E67E22' : ((opStats?.wo_aperti ?? 0) > 0 ? 'var(--accent)' : '#27AE60');
  const scad7Clr    = (opStats?.scadenze_7gg ?? 0) > 0 ? '#E67E22' : '#27AE60';
  const scadRitClr  = (opStats?.scadenze_ritardo ?? 0) > 0 ? '#E74C3C' : '#27AE60';
  const allarmiClr  = (opStats?.asset_con_allarmi ?? 0) > 0 ? '#E74C3C' : '#27AE60';
  const manClr      = (opStats?.asset_manutenzione ?? 0) > 0 ? '#E67E22' : '#27AE60';
  const compClr     = (opStats?.wo_completati_mese ?? 0) > 0 ? '#27AE60' : 'var(--text-secondary)';
  const scadTotClr  = (opStats?.scadenze_totali_aperte ?? 0) > 0 ? 'var(--accent)' : 'var(--text-secondary)';
  const inattClr    = (opStats?.asset_inattivi ?? 0) > 0 ? 'var(--text-secondary)' : '#27AE60';

  // Tachimetri per tipo asset
  const perTipo = globalStats?.per_tipo ?? {};
  const tipiKpi = [
    { key: 'uffici',       fa: 'fa-building',  label: 'Uffici',       tipo: 'ufficio'      },
    { key: 'stabilimenti', fa: 'fa-industry',  label: 'Stabilimenti', tipo: 'stabilimento' },
    { key: 'magazzini',    fa: 'fa-archive',   label: 'Magazzini',    tipo: 'magazzino'    },
    { key: 'depositi',     fa: 'fa-truck',     label: 'Depositi',     tipo: 'deposito'     },
  ];

  return (
    <>
      {/* Header pannello */}
      <div className="panel-header">
        <div className="panel-header-title">
          <i className="fas fa-chart-bar" />
          Quadro Sinottico
        </div>
        <div className="panel-header-meta">
          <div className="meta-dot" />
          <span id="panel-header-ts">Live — {ora} &nbsp;·&nbsp; {totale} asset</span>
        </div>
      </div>

      {/* Panoramica scrollabile */}
      <div className="overview-panel">
        {/* KPI Manutenzione */}
        <div className="kpi-group group-wo">
          <div className="kpi-group-header">
            <i className="fas fa-wrench" /> Manutenzione
          </div>
          <div className="op-kpi-grid" id="op-kpi-wo">
            <a href="/gam/workorders" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: woUrgClass }}>{opStats?.wo_urgenti ?? '—'}</div>
              <div className="op-kpi-label">WO Urgenti</div>
              <div className="op-kpi-desc">Priorità critica/alta aperti</div>
            </a>
            <a href="/gam/workorders" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: woApertiClr }}>{opStats?.wo_aperti ?? '—'}</div>
              <div className="op-kpi-label">WO Aperti</div>
              <div className="op-kpi-desc">Work order non completati</div>
            </a>
            <a href="/gam/workorders" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: compClr }}>{opStats?.wo_completati_mese ?? '—'}</div>
              <div className="op-kpi-label">Completati/mese</div>
              <div className="op-kpi-desc">WO chiusi nel mese corrente</div>
            </a>
          </div>
        </div>

        {/* KPI Scadenze */}
        <div className="kpi-group group-scad">
          <div className="kpi-group-header">
            <i className="fas fa-calendar-alt" /> Scadenze
          </div>
          <div className="op-kpi-grid" id="op-kpi-scad">
            <a href="/gam/deadlines" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: scad7Clr }}>{opStats?.scadenze_7gg ?? '—'}</div>
              <div className="op-kpi-label">Scad. 7 gg</div>
              <div className="op-kpi-desc">In scadenza nei prossimi 7 gg</div>
            </a>
            <a href="/gam/deadlines" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: scadRitClr }}>{opStats?.scadenze_ritardo ?? '—'}</div>
              <div className="op-kpi-label">In Ritardo</div>
              <div className="op-kpi-desc">Scadenze superate non chiuse</div>
            </a>
            <a href="/gam/deadlines" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: scadTotClr }}>{opStats?.scadenze_totali_aperte ?? '—'}</div>
              <div className="op-kpi-label">Tot. Aperte</div>
              <div className="op-kpi-desc">Scadenze non ancora chiuse</div>
            </a>
          </div>
        </div>

        {/* KPI Asset */}
        <div className="kpi-group group-asset">
          <div className="kpi-group-header">
            <i className="fas fa-building" /> Asset
          </div>
          <div className="op-kpi-grid" id="op-kpi-asset">
            <a href="/gam/alarms" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: allarmiClr }}>{opStats?.asset_con_allarmi ?? '—'}</div>
              <div className="op-kpi-label">Con Allarmi</div>
              <div className="op-kpi-desc">Asset con allarmi attivi</div>
            </a>
            <a href="/gam/assets" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: manClr }}>{opStats?.asset_manutenzione ?? '—'}</div>
              <div className="op-kpi-label">In Manutenzione</div>
              <div className="op-kpi-desc">Asset con stato manutenzione</div>
            </a>
            <a href="/gam/assets" className="op-kpi-card" style={{ textDecoration: 'none' }}>
              <div className="op-kpi-val" style={{ color: inattClr }}>{opStats?.asset_inattivi ?? '—'}</div>
              <div className="op-kpi-label">Inattivi</div>
              <div className="op-kpi-desc">Asset con stato inattivo</div>
            </a>
          </div>
        </div>

        {/* Panoramica Operativa — tachimetri per tipo */}
        <div className="kpi-group-header" style={{ marginTop: 14 }}>
          Panoramica Operativa
        </div>
        <div className="gauges-grid">
          {tipiKpi.map(t => {
            const cnt = perTipo[t.tipo] ?? 0;
            const bc = cnt === 0 ? 'ok' : 'ok';
            return (
              <div
                key={t.tipo}
                className={`gauge-card ${bc}`}
                data-tipo={t.tipo}
                onClick={() => onGaugeClick?.(t.tipo)}
              >
                <GaugeSvg value={cnt} max={totale} color="#27AE60" />
                <div className="gauge-label">
                  <i className={`fas ${t.fa}`} style={{ color: COLORE_MARKER, marginRight: 3 }} />
                  {t.label} <span style={{ opacity: 0.55 }}>({cnt})</span>
                </div>
                <div className="gauge-sub">{t.key}</div>
              </div>
            );
          })}
        </div>

        {/* Situazioni da monitorare */}
        {(opStats?.da_monitorare ?? globalStats?.da_monitorare ?? []).length > 0 && (
          <>
            <div className="kpi-group-header" style={{ marginTop: 10 }}>Da Monitorare</div>
            {(opStats?.da_monitorare ?? globalStats?.da_monitorare ?? []).slice(0, 4).map((a: any) => (
              <div
                key={a.id}
                className={`alert-item${a.livello_max !== 'alarm' ? ' warning' : ''}`}
              >
                <i className="fas fa-exclamation-triangle alert-icon" />
                <div>
                  <div className="alert-nome">{a.nome}</div>
                  <div className="alert-msg">{a.citta} — {a.tipo}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Allarmi totali */}
        {globalStats?.allarmi && (
          <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-secondary)' }}>
            <i
              className="fas fa-bell"
              style={{
                marginRight: 5,
                color: globalStats.allarmi.totale_attivi > 0 ? 'var(--stato-inattivo)' : 'var(--stato-attivo)',
              }}
            />
            {globalStats.allarmi.totale_attivi} allarmi attivi ({globalStats.allarmi.livello_alarm} critici)
            &nbsp;·&nbsp;
            <a href="/gam/alarms" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Gestisci</a>
          </div>
        )}
      </div>
    </>
  );
}

// ── Pagina principale ────────────────────────────────────────────────
export default function AssetManagement({
  activeTipo = 'tutti',
  onTipoChange,
  searchValue = '',
  onSearchChange,
  onSearchSelect,
}: {
  activeTipo?: string;
  onTipoChange?: (tipo: string) => void;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  onSearchSelect?: (id: number) => void;
}) {
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [assetStati, setAssetStati] = useState<Record<number, string>>({});

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const selectedMkrRef = useRef<L.Marker | null>(null);

  // Dati
  const { data: geojson, loading: loadingGeo } = useApi(() => assets.geojson(), []);
  const { data: globalStats } = useApi(() => stats.global(), [], true);
  const { data: opStatsRaw } = useApi(() => stats.operational() as Promise<OperationalStats>, [], true);
  const opStats = opStatsRaw as OperationalStats | null;

  // Risultati ricerca per topbar
  const searchResults = searchValue.length >= 2
    ? (geojson?.features ?? [])
        .filter(f =>
          f.properties.nome.toLowerCase().includes(searchValue.toLowerCase()) ||
          f.properties.citta?.toLowerCase().includes(searchValue.toLowerCase()),
        )
        .slice(0, 8)
        .map(f => ({
          id: f.properties.id,
          nome: f.properties.nome,
          tipo: f.properties.tipo,
          citta: f.properties.citta ?? '',
        }))
    : [];

  // Esponi risultati ricerca al layout padre
  useEffect(() => {
    onSearchChange?.(searchValue);
  }, [searchValue]);

  // Aggiorna stati asset da stats operational
  useEffect(() => {
    if (opStats?.asset_stati) {
      const stati: Record<number, string> = {};
      Object.entries(opStats.asset_stati).forEach(([id, stato]) => {
        stati[parseInt(id)] = stato as string;
      });
      setAssetStati(stati);
    }
  }, [opStats]);

  // Inizializza mappa Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [44.5, 11.3],
      zoom: 6,
      zoomControl: true,
    });

    L.tileLayer(
      `https://tile.jawg.io/jawg-dark/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`,
      { attribution: '&copy; <a href="https://jawg.io">Jawg Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 20 },
    ).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Aggiorna marker
  const updateMarkers = useCallback(() => {
    if (!mapRef.current || !geojson) return;
    const map = mapRef.current;
    const existing = markersRef.current;

    const features = geojson.features.filter(f => {
      if (activeTipo !== 'tutti' && f.properties.tipo !== activeTipo) return false;
      return true;
    });

    features.forEach(f => {
      const { id, tipo } = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      const stato = assetStati[id];
      const isSelected = id === selectedAssetId;
      const icon = creaIcona(tipo, isSelected, stato);

      if (existing.has(id)) {
        existing.get(id)!.setIcon(icon);
      } else {
        const marker = L.marker([lat, lon], { icon });
        marker.on('click', () => {
          setSelectedAssetId(id);
          setModalOpen(true);
        });
        marker.bindTooltip(f.properties.nome, { permanent: false, direction: 'top' });
        marker.addTo(map);
        existing.set(id, marker);
      }
    });

    // Rimuovi marker non più visibili
    const ids = new Set(features.map(f => f.properties.id));
    existing.forEach((marker, id) => {
      if (!ids.has(id)) { marker.remove(); existing.delete(id); }
    });
  }, [geojson, activeTipo, assetStati, selectedAssetId]);

  useEffect(() => { updateMarkers(); }, [updateMarkers]);

  // Vola all'asset selezionato
  useEffect(() => {
    if (!selectedAssetId || !geojson || !mapRef.current) return;
    const feat = geojson.features.find(f => f.properties.id === selectedAssetId);
    if (feat) {
      const [lon, lat] = feat.geometry.coordinates;
      mapRef.current.flyTo([lat, lon], 15, { duration: 0.8 });
    }
  }, [selectedAssetId, geojson]);

  // Fly to da ricerca
  useEffect(() => {
    if (onSearchSelect) return; // gestito dal padre
  }, [onSearchSelect]);

  function handleSearchSelect(id: number) {
    setSelectedAssetId(id);
    setModalOpen(true);
    onSearchSelect?.(id);
    const feat = geojson?.features.find(f => f.properties.id === id);
    if (feat && mapRef.current) {
      const [lon, lat] = feat.geometry.coordinates;
      mapRef.current.flyTo([lat, lon], 15, { duration: 0.8 });
    }
  }

  return (
    <>
      {/* Layout principale: mappa + pannello dx */}
      <div className="main-layout">
        {/* Mappa */}
        <div id="map">
          <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />

          {/* Loading overlay */}
          {loadingGeo && (
            <div className="loading-overlay">
              <div className="spinner" />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Caricamento mappa…</span>
            </div>
          )}

          {/* Legenda marker stato operativo */}
          <div className="marker-legend" id="marker-legend">
            <div className="marker-legend-title">Stato operativo</div>
            <div className="marker-legend-item">
              <div className="marker-legend-dot" style={{ color: '#E74C3C' }} />
              <span>Critico</span>
              <span>WO critico o allarme grave</span>
            </div>
            <div className="marker-legend-item">
              <div className="marker-legend-dot" style={{ color: '#F39C12' }} />
              <span>Attenzione</span>
              <span>WO alta priorità o scadenza</span>
            </div>
            <div className="marker-legend-item">
              <div className="marker-legend-dot" style={{ color: '#27AE60' }} />
              <span>Operativo</span>
              <span>Nessun problema aperto</span>
            </div>
            <div className="marker-legend-item">
              <div className="marker-legend-dot" style={{ color: '#95A5A6' }} />
              <span>Inattivo</span>
              <span>Asset dismesso</span>
            </div>
          </div>
        </div>

        {/* Pannello laterale destro */}
        <div className="side-panel">
          <QuadroSinottico
            globalStats={globalStats}
            opStats={opStats}
            onGaugeClick={onTipoChange}
          />
        </div>
      </div>

      {/* Modale dettaglio asset */}
      <AssetDetailModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        assetId={selectedAssetId}
      />
    </>
  );
}
