/**
 * AppLayout — Layout principale GAM Platform
 * Sidebar verticale iconica + topbar + area contenuto
 * Replica fedele del layout vanilla HTML/JS
 */
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useAlarmPolling } from '@/hooks/useAlarmPolling';
import { toast } from 'sonner';
import {
  MapPin, Database, Bell, Wrench, Calendar, Zap,
  FileText, Settings, LogOut,
  Users, BarChart2, Receipt,
  Building2, Box,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Tipi ─────────────────────────────────────────────────────────────
interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  alarmDot?: boolean;
  module: 'gam' | 'efficiency' | 'bems';
  dividerAfter?: boolean;
}

// ── Voci di navigazione ──────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  // GAM
  { key: 'mappa',        href: '/map',         icon: MapPin,        label: 'Mappa Asset',       module: 'gam' },
  { key: 'anagrafica',   href: '/assets',       icon: Database,      label: 'Anagrafica Asset',  module: 'gam' },
  { key: 'allarmi',      href: '/alarms',       icon: Bell,          label: 'Allarmi',           module: 'gam', alarmDot: true },
  { key: 'workorders',   href: '/workorders',   icon: Wrench,        label: 'Work Order',        module: 'gam' },
  { key: 'scadenze',     href: '/deadlines',    icon: Calendar,      label: 'Scadenze',          module: 'gam' },
  { key: 'documenti',    href: '/documents',    icon: FileText,      label: 'Documenti',         module: 'gam', dividerAfter: true },
  // Efficiency
  { key: 'efficiency',   href: '/efficiency',   icon: Zap,           label: 'Asset Efficiency',  module: 'efficiency' },
  { key: 'occupancy',    href: '/occupancy',    icon: Users,         label: 'Occupancy',         module: 'efficiency' },
  { key: 'energy',       href: '/energy',       icon: BarChart2,     label: 'Energy Summary',    module: 'efficiency' },
  { key: 'bollette',     href: '/invoices',     icon: Receipt,       label: 'Tariffe & Bollette', module: 'efficiency', dividerAfter: true },
  // BEMS
  { key: 'bems',         href: '/bems',         icon: Building2,     label: 'BEMS Floorplan',    module: 'bems' },
  { key: 'bems-studio',  href: '/bems-studio',  icon: Settings,      label: 'BEMS Studio',       module: 'bems', dividerAfter: true },
  // Gestione
  { key: 'bim-manager',  href: '/bim',          icon: Box,           label: 'Gestione BIM',      module: 'gam' },
  { key: 'impostazioni', href: '/settings',     icon: Settings,      label: 'Impostazioni',      module: 'gam' },
];

// ── Componente sidebar ───────────────────────────────────────────────
function Sidebar({ alarmCount }: { alarmCount: number }) {
  const [location] = useLocation();
  const { logout, user } = useAuth();

  // Determina la voce attiva
  const activeKey = NAV_ITEMS.find(item => {
    if (item.href === '/') return location === '/';
    return location.startsWith(item.href);
  })?.key ?? '';

  return (
    <nav className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <img src="/manus-storage/logodark_99cb9ce0.png" alt="GAM" className="sidebar-logo-img" />
      </div>

      {/* Voci di navigazione */}
      <div className="sidebar-nav">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const isActive = activeKey === item.key;
          return (
            <div key={item.key}>
              <Link href={item.href}>
                <a
                  className={`sb-btn${isActive ? ' active' : ''}`}
                  title={item.label}
                >
                  <Icon size={18} />
                  {item.alarmDot && alarmCount > 0 && (
                    <span className="sb-dot visible" />
                  )}
                </a>
              </Link>
              {item.dividerAfter && <div className="sb-divider" />}
            </div>
          );
        })}
      </div>

      {/* Spacer + logout */}
      <div className="sidebar-footer">
        {user && (
          <div className="sb-user-avatar" title={user.nome ?? user.sub}>
            {(user.nome ?? user.sub).charAt(0).toUpperCase()}
          </div>
        )}
        <button className="sb-btn" onClick={logout} title="Esci">
          <LogOut size={18} />
        </button>
      </div>
    </nav>
  );
}

// ── Topbar ───────────────────────────────────────────────────────────
function Topbar({ alarmCount }: { alarmCount: number }) {
  const [location] = useLocation();
  const { user } = useAuth();

  const currentItem = NAV_ITEMS.find(item => {
    if (item.href === '/') return location === '/';
    return location.startsWith(item.href);
  });

  const pageTitle = currentItem?.label ?? 'GAM Platform';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <img src="/manus-storage/logodark_99cb9ce0.png" alt="GAM" className="topbar-logo" />
        <span className="topbar-title">{pageTitle}</span>
      </div>

      <div className="topbar-right">
        {/* Campanella allarmi */}
        <Link href="/alarms">
          <a className="topbar-alarm-btn" title="Allarmi">
            <Bell size={16} />
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
            <span className="topbar-nome">{user.nome ?? user.sub}</span>
            <span className={`topbar-badge ${user.role === 'admin' ? 'admin' : 'user'}`}>
              {user.role}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

// ── Layout principale ────────────────────────────────────────────────
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { totale: alarmCount, nuovi: newAlarms } = useAlarmPolling();

  // Toast per nuovi allarmi
  useEffect(() => {
    newAlarms.slice(0, 3).forEach((a: import('@/lib/types').Allarme) => {
      const msg = a.campo ? `${a.campo}: ${a.valore ?? ''}` : (a.messaggio ?? 'Allarme');
      toast.error(msg, {
        description: a.asset_nome,
        duration: 5000,
      });
    });
  }, [newAlarms]);

  return (
    <div className="app-layout">
      <Sidebar alarmCount={alarmCount} />
      <div className="app-main">
        <Topbar alarmCount={alarmCount} />
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
