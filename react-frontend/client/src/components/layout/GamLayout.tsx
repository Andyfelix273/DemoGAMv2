/**
 * GamLayout — Layout dimostratore GIS Asset Manager
 * Struttura HTML identica al vanilla map.html:
 *   - Topbar: logo + titolo + ricerca + filtri tipo + campanella + utente
 *   - Sidebar: #map-sidebar con icone FontAwesome identiche al vanilla
 *   - main-layout: flex row (mappa | side-panel)
 *
 * Usa le classi CSS di index.css estratte 1:1 dal vanilla.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useAlarmPolling } from '@/hooks/useAlarmPolling';
import { toast } from 'sonner';
import type { Allarme } from '@/lib/types';

// ── Voci sidebar GAM (identiche al vanilla renderSidebar modulo='gam') ──
const GAM_NAV = [
  { key: 'mappa',        href: '/gam/map',        icon: 'fa-map-marker',  label: 'Mappa' },
  { key: 'anagrafica',   href: '/gam/assets',      icon: 'fa-database',    label: 'Anagrafica asset' },
  { key: 'allarmi',      href: '/gam/alarms',      icon: 'fa-bell',        label: 'Allarmi', alarmDot: true },
  { key: 'workorders',   href: '/gam/workorders',  icon: 'fa-wrench',      label: 'Work Order' },
  { key: 'scadenze',     href: '/gam/deadlines',   icon: 'fa-calendar',    label: 'Scadenze' },
  { key: 'efficiency',   href: '/gam/efficiency',  icon: 'fa-bolt',        label: 'Asset Efficiency' },
  { key: 'documenti',    href: '/gam/documents',   icon: 'fa-file-lines',  label: 'Documenti' },
  { key: 'bim-manager',  href: '/gam/bim',         icon: 'fa-cube',        label: 'Gestione BIM' },
  { key: 'impostazioni', href: '/gam/settings',    icon: 'fa-cog',         label: 'Impostazioni' },
];

// ── Filtri tipo asset nella topbar (solo per la pagina mappa) ──
const TIPO_FILTERS = [
  { tipo: 'tutti',        icon: 'fa-layer-group', label: 'Tutti' },
  { tipo: 'stabilimento', icon: 'fa-industry',    label: 'Stabilimenti' },
  { tipo: 'ufficio',      icon: 'fa-building',    label: 'Uffici' },
  { tipo: 'magazzino',    icon: 'fa-archive',     label: 'Magazzini' },
  { tipo: 'deposito',     icon: 'fa-truck',       label: 'Depositi' },
];

// ── Props ────────────────────────────────────────────────────────────
interface GamLayoutProps {
  children: React.ReactNode;
  /** Se true mostra ricerca + filtri tipo (solo nella pagina mappa) */
  showMapControls?: boolean;
  /** Filtro tipo attivo (gestito dalla pagina mappa) */
  activeTipo?: string;
  onTipoChange?: (tipo: string) => void;
  /** Valore ricerca (gestito dalla pagina mappa) */
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchResults?: Array<{ id: number; nome: string; tipo: string; citta: string }>;
  onSearchSelect?: (id: number) => void;
}

// ── Sidebar ──────────────────────────────────────────────────────────
function GamSidebar({ alarmCount }: { alarmCount: number }) {
  const [location] = useLocation();
  const { logout, user } = useAuth();

  const activeKey = GAM_NAV.find(item => location === item.href || location.startsWith(item.href + '/'))?.key ?? '';

  const initials = user ? (user.nome ?? user.sub ?? '?').charAt(0).toUpperCase() : '?';

  return (
    <nav id="map-sidebar">
      {/* Logo */}
      <div className="sb-logo">
        <img src="/manus-storage/logodark_99cb9ce0.png" alt="GAM" />
      </div>
      <div className="sb-sep" />

      {/* Voci navigazione */}
      {GAM_NAV.map(item => (
        <Link key={item.key} href={item.href}>
          <a
            className={`sb-btn${activeKey === item.key ? ' active' : ''}`}
            title={item.label}
          >
            <i className={`fa ${item.icon}`} />
            {item.alarmDot && alarmCount > 0 && (
              <span className="sb-dot visible" />
            )}
          </a>
        </Link>
      ))}

      {/* Spacer */}
      <div className="sb-spacer" />

      {/* Avatar utente */}
      <div className="sb-user" title={user?.nome ?? user?.sub ?? ''}>
        {initials}
      </div>

      {/* Logout */}
      <button className="sb-btn" onClick={logout} title="Esci" style={{ marginBottom: 4 }}>
        <i className="fa fa-sign-out" />
      </button>
    </nav>
  );
}

// ── Topbar ───────────────────────────────────────────────────────────
function GamTopbar({
  alarmCount,
  showMapControls,
  activeTipo,
  onTipoChange,
  searchValue,
  onSearchChange,
  searchResults,
  onSearchSelect,
}: Omit<GamLayoutProps, 'children'> & { alarmCount: number }) {
  const { user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
    setSearchOpen(e.target.value.length > 0 && (searchResults?.length ?? 0) > 0);
  };

  useEffect(() => {
    setSearchOpen((searchValue?.length ?? 0) > 0 && (searchResults?.length ?? 0) > 0);
  }, [searchResults, searchValue]);

  return (
    <div className="topbar" id="topbar-root">
      {/* Logo + titolo */}
      <img src="/manus-storage/logodark_99cb9ce0.png" alt="Metamorphosis" className="topbar-logo" />
      <div className="topbar-sep" />
      <span className="topbar-title">GIS Asset Manager</span>

      {/* Ricerca asset (solo mappa) */}
      {showMapControls && (
        <div className="search-wrap">
          <i className="fas fa-search search-icon-fa" />
          <input
            type="text"
            id="search-input"
            className="search-input"
            placeholder="Cerca asset..."
            value={searchValue ?? ''}
            onChange={handleSearchChange}
            onFocus={() => setSearchOpen((searchResults?.length ?? 0) > 0)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
            autoComplete="off"
          />
          <div className={`search-results${searchOpen ? ' open' : ''}`} id="search-results">
            {searchResults?.map(r => (
              <div
                key={r.id}
                className="search-result-item"
                onMouseDown={() => { onSearchSelect?.(r.id); setSearchOpen(false); }}
              >
                {r.nome}
                <div className="search-result-sub">{r.citta} — {r.tipo}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtri tipo asset (solo mappa) */}
      {showMapControls && (
        <div className="topbar-filters">
          {TIPO_FILTERS.map(f => (
            <button
              key={f.tipo}
              className={`filter-btn${activeTipo === f.tipo ? ' active' : ''}`}
              data-tipo={f.tipo}
              onClick={() => onTipoChange?.(f.tipo)}
            >
              <i className={`fas ${f.icon}`} style={{ fontSize: 10 }} />
              {' '}{f.label}
            </button>
          ))}
        </div>
      )}

      {/* Controlli destra */}
      <div className="topbar-controls">
        {/* Campanella allarmi */}
        <Link href="/gam/alarms">
          <a className="topbar-alarm-wrap" title="Vai agli allarmi">
            <i className="fa fa-bell" style={{ fontSize: 16, color: 'var(--text-secondary)' }} />
            {alarmCount > 0 && (
              <span className="topbar-alarm-badge">
                {alarmCount > 99 ? '99+' : alarmCount}
              </span>
            )}
          </a>
        </Link>

        {/* Utente */}
        {user && (
          <div className="topbar-user">
            <span id="topbar-nome">{user.nome ?? user.sub}</span>
            <span id="topbar-badge" className={`badge-role${user.role === 'admin' ? ' admin' : ''}`}>
              {user.role}
            </span>
          </div>
        )}

        {/* Logout */}
        <button className="btn-logout" id="btn-logout" title="Esci" onClick={() => useAuth().logout?.()}>
          <i className="fas fa-sign-out-alt" />
        </button>
      </div>
    </div>
  );
}

// ── Layout principale ────────────────────────────────────────────────
export function GamLayout({
  children,
  showMapControls = false,
  activeTipo,
  onTipoChange,
  searchValue,
  onSearchChange,
  searchResults,
  onSearchSelect,
}: GamLayoutProps) {
  const { totale: alarmCount, nuovi: newAlarms } = useAlarmPolling();

  // Toast per nuovi allarmi
  useEffect(() => {
    newAlarms.slice(0, 3).forEach((a: Allarme) => {
      const msg = a.campo ? `${a.campo}: ${a.valore ?? ''}` : (a.messaggio ?? 'Allarme');
      toast.error(msg, { description: a.asset_nome, duration: 5000 });
    });
  }, [newAlarms]);

  return (
    <>
      <GamSidebar alarmCount={alarmCount} />
      <GamTopbar
        alarmCount={alarmCount}
        showMapControls={showMapControls}
        activeTipo={activeTipo}
        onTipoChange={onTipoChange}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchResults={searchResults}
        onSearchSelect={onSearchSelect}
      />
      {children}
    </>
  );
}

// ── Layout per pagine interne GAM (non-mappa) ────────────────────────
export function GamPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <GamLayout>
      <div className="sidebar-content">
        <div className="gam-page">
          {children}
        </div>
      </div>
    </GamLayout>
  );
}
