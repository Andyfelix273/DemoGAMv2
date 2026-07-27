/**
 * EfficiencyLayout — Layout dimostratore Asset Efficiency
 * Struttura HTML identica al vanilla efficiency-map.html:
 *   - Topbar: logo + "Asset Efficiency" + ricerca + filtri tipo + campanella + utente
 *   - Sidebar: #map-sidebar con icone FontAwesome identiche al vanilla modulo='efficiency'
 *   - main-layout: flex row (mappa | side-panel)
 */
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useAlarmPolling } from '@/hooks/useAlarmPolling';
import { toast } from 'sonner';
import type { Allarme } from '@/lib/types';

// ── Voci sidebar Efficiency (identiche al vanilla renderSidebar modulo='efficiency') ──
const EFF_NAV = [
  { key: 'eff-mappa',          href: '/efficiency/map',      icon: 'fa-map-marker',          label: 'Mappa efficienza' },
  { key: 'eff-anagrafica',     href: '/efficiency/assets',   icon: 'fa-database',            label: 'Anagrafica asset' },
  { key: 'eff-allarmi',        href: '/efficiency/alarms',   icon: 'fa-bell',                label: 'Allarmi energetici', alarmDot: true },
  { key: 'eff-anomaly',        href: '/efficiency/anomaly',  icon: 'fa-triangle-exclamation', label: 'Anomaly Detection' },
  { key: 'eff-energy-summary', href: '/efficiency/energy',   icon: 'fa-chart-line',          label: 'Energy Summary' },
  { key: 'eff-occupancy',      href: '/efficiency/occupancy', icon: 'fa-users',              label: 'Occupancy' },
  { key: 'eff-bollette',       href: '/efficiency/invoices', icon: 'fa-file-invoice-dollar', label: 'Tariffe & Bollette' },
  { key: 'eff-impostazioni',   href: '/efficiency/settings', icon: 'fa-cog',                 label: 'Impostazioni' },
];

const TIPO_FILTERS = [
  { tipo: 'tutti',        icon: 'fa-layer-group', label: 'Tutti' },
  { tipo: 'stabilimento', icon: 'fa-industry',    label: 'Stabilimenti' },
  { tipo: 'ufficio',      icon: 'fa-building',    label: 'Uffici' },
  { tipo: 'magazzino',    icon: 'fa-archive',     label: 'Magazzini' },
  { tipo: 'deposito',     icon: 'fa-truck',       label: 'Depositi' },
];

interface EfficiencyLayoutProps {
  children: React.ReactNode;
  showMapControls?: boolean;
  activeTipo?: string;
  onTipoChange?: (tipo: string) => void;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchResults?: Array<{ id: number; nome: string; tipo: string; citta: string }>;
  onSearchSelect?: (id: number) => void;
}

function EffSidebar({ alarmCount }: { alarmCount: number }) {
  const [location] = useLocation();
  const { logout, user } = useAuth();
  const activeKey = EFF_NAV.find(item => location === item.href || location.startsWith(item.href + '/'))?.key ?? '';
  const initials = user ? (user.nome ?? user.sub ?? '?').charAt(0).toUpperCase() : '?';

  return (
    <nav id="map-sidebar">
      <div className="sb-logo">
        <img src="/manus-storage/logodark_99cb9ce0.png" alt="GAM" />
      </div>
      <div className="sb-sep" />
      {EFF_NAV.map(item => (
        <Link key={item.key} href={item.href}>
          <a className={`sb-btn${activeKey === item.key ? ' active' : ''}`} title={item.label}>
            <i className={`fa ${item.icon}`} />
            {item.alarmDot && alarmCount > 0 && <span className="sb-dot visible" />}
          </a>
        </Link>
      ))}
      <div className="sb-spacer" />
      <div className="sb-user" title={user?.nome ?? user?.sub ?? ''}>{initials}</div>
      <button className="sb-btn" onClick={logout} title="Esci" style={{ marginBottom: 4 }}>
        <i className="fa fa-sign-out" />
      </button>
    </nav>
  );
}

function EffTopbar({
  alarmCount, showMapControls, activeTipo, onTipoChange,
  searchValue, onSearchChange, searchResults, onSearchSelect,
}: Omit<EfficiencyLayoutProps, 'children'> & { alarmCount: number }) {
  const { user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setSearchOpen((searchValue?.length ?? 0) > 0 && (searchResults?.length ?? 0) > 0);
  }, [searchResults, searchValue]);

  return (
    <div className="topbar" id="topbar-root">
      <img src="/manus-storage/logodark_99cb9ce0.png" alt="Metamorphosis" className="topbar-logo" />
      <div className="topbar-sep" />
      <span className="topbar-title">Asset Efficiency</span>

      {showMapControls && (
        <div className="search-wrap">
          <i className="fas fa-search search-icon-fa" />
          <input
            type="text"
            className="search-input"
            placeholder="Cerca asset..."
            value={searchValue ?? ''}
            onChange={e => { onSearchChange?.(e.target.value); setSearchOpen(e.target.value.length > 0 && (searchResults?.length ?? 0) > 0); }}
            onFocus={() => setSearchOpen((searchResults?.length ?? 0) > 0)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
            autoComplete="off"
          />
          <div className={`search-results${searchOpen ? ' open' : ''}`}>
            {searchResults?.map(r => (
              <div key={r.id} className="search-result-item" onMouseDown={() => { onSearchSelect?.(r.id); setSearchOpen(false); }}>
                {r.nome}
                <div className="search-result-sub">{r.citta} — {r.tipo}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showMapControls && (
        <div className="topbar-filters">
          {TIPO_FILTERS.map(f => (
            <button key={f.tipo} className={`filter-btn${activeTipo === f.tipo ? ' active' : ''}`} onClick={() => onTipoChange?.(f.tipo)}>
              <i className={`fas ${f.icon}`} style={{ fontSize: 10 }} /> {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="topbar-controls">
        <Link href="/efficiency/alarms">
          <a className="topbar-alarm-wrap" title="Vai agli allarmi energetici">
            <i className="fa fa-bell" style={{ fontSize: 16, color: 'var(--text-secondary)' }} />
            {alarmCount > 0 && <span className="topbar-alarm-badge">{alarmCount > 99 ? '99+' : alarmCount}</span>}
          </a>
        </Link>
        {user && (
          <div className="topbar-user">
            <span>{user.nome ?? user.sub}</span>
            <span className={`badge-role${user.role === 'admin' ? ' admin' : ''}`}>{user.role}</span>
          </div>
        )}
        <button className="btn-logout" title="Esci" onClick={() => useAuth().logout?.()}>
          <i className="fas fa-sign-out-alt" />
        </button>
      </div>
    </div>
  );
}

export function EfficiencyLayout({
  children, showMapControls = false, activeTipo, onTipoChange,
  searchValue, onSearchChange, searchResults, onSearchSelect,
}: EfficiencyLayoutProps) {
  const { totale: alarmCount, nuovi: newAlarms } = useAlarmPolling();

  useEffect(() => {
    newAlarms.slice(0, 3).forEach((a: Allarme) => {
      const msg = a.campo ? `${a.campo}: ${a.valore ?? ''}` : (a.messaggio ?? 'Allarme');
      toast.error(msg, { description: a.asset_nome, duration: 5000 });
    });
  }, [newAlarms]);

  return (
    <>
      <EffSidebar alarmCount={alarmCount} />
      <EffTopbar
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

export function EfficiencyPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <EfficiencyLayout>
      <div className="sidebar-content">
        <div className="gam-page">
          {children}
        </div>
      </div>
    </EfficiencyLayout>
  );
}
