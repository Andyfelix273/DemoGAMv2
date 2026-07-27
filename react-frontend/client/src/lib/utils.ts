import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  COLOR_SUCCESS, COLOR_WARNING, COLOR_DANGER, COLOR_ACCENT,
  OCC_HIGH_THRESHOLD, OCC_MED_THRESHOLD,
  CO2_CRITICAL_PPM, CO2_WARNING_PPM,
  TEMP_MIN_C, TEMP_MAX_C,
  ENERGY_CLASS_COLOR,
} from './constants';

// ── Tailwind merge ───────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Formattazione numeri ─────────────────────────────────────────────
export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '–';
  return n.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatKwh(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '–';
  if (n >= 1_000_000) return `${formatNumber(n / 1_000_000, 2)} GWh`;
  if (n >= 1_000) return `${formatNumber(n / 1_000, 1)} MWh`;
  return `${formatNumber(n, decimals)} kWh`;
}

export function formatKw(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '–';
  return `${formatNumber(n, decimals)} kW`;
}

export function formatEur(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '–';
  return `€ ${formatNumber(n, decimals)}`;
}

export function formatPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '–';
  return `${formatNumber(n, decimals)}%`;
}

export function formatMq(n: number | null | undefined): string {
  if (n == null) return '–';
  return `${formatNumber(n)} m²`;
}

export function formatTemp(n: number | null | undefined): string {
  if (n == null) return '–';
  return `${formatNumber(n, 1)}°C`;
}

export function formatPpm(n: number | null | undefined): string {
  if (n == null) return '–';
  return `${formatNumber(n, 0)} ppm CO₂`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '–';
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(0)} KB`;
  return `${n} B`;
}

// ── Formattazione date ───────────────────────────────────────────────
export function formatDate(s: string | null | undefined): string {
  if (!s) return '–';
  return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(s: string | null | undefined): string {
  if (!s) return '–';
  return new Date(s).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatTimeAgo(s: string | null | undefined): string {
  if (!s) return '–';
  const diff = Date.now() - new Date(s).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'ora';
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h fa`;
  return formatDate(s);
}

export function formatWorkingHours(
  start: string | null | undefined,
  end: string | null | undefined,
  days: string | null | undefined,
): string {
  if (!start || !end) return '–';
  const dayMap: Record<string, string> = {
    MON: 'Lun', TUE: 'Mar', WED: 'Mer', THU: 'Gio', FRI: 'Ven', SAT: 'Sab', SUN: 'Dom',
  };
  const daysStr = days
    ? days.split(',').map(d => dayMap[d.trim()] ?? d).join(', ')
    : '';
  const timeStr = `${start.slice(0, 5)} – ${end.slice(0, 5)}`;
  return daysStr ? `${timeStr} · ${daysStr}` : timeStr;
}

// ── Colori semantici ─────────────────────────────────────────────────
export function getOccupancyColor(pct: number | null | undefined): string {
  if (pct == null) return COLOR_ACCENT;
  if (pct >= OCC_HIGH_THRESHOLD) return COLOR_DANGER;
  if (pct >= OCC_MED_THRESHOLD) return COLOR_WARNING;
  return COLOR_SUCCESS;
}

export function getCo2Color(ppm: number | null | undefined): string {
  if (ppm == null) return COLOR_ACCENT;
  if (ppm >= CO2_CRITICAL_PPM) return COLOR_DANGER;
  if (ppm >= CO2_WARNING_PPM) return COLOR_WARNING;
  return COLOR_SUCCESS;
}

export function getTempColor(temp: number | null | undefined): string {
  if (temp == null) return COLOR_ACCENT;
  if (temp < TEMP_MIN_C || temp > TEMP_MAX_C) return COLOR_WARNING;
  return COLOR_SUCCESS;
}

export function getEnergyClassColor(cls: string | null | undefined): string {
  if (!cls) return '#7BAFC4';
  return ENERGY_CLASS_COLOR[cls.toUpperCase()] ?? '#7BAFC4';
}

export function getAlarmGravitaColor(gravita: string): string {
  switch (gravita) {
    case 'critico': return COLOR_DANGER;
    case 'alto':    return '#E67E22';
    case 'medio':   return COLOR_WARNING;
    case 'basso':   return COLOR_ACCENT;
    default:        return COLOR_ACCENT;
  }
}

export function getWoPrioritaColor(priorita: string): string {
  switch (priorita) {
    case 'urgente': return COLOR_DANGER;
    case 'alta':    return COLOR_WARNING;
    case 'media':   return COLOR_ACCENT;
    case 'bassa':   return '#7BAFC4';
    default:        return '#7BAFC4';
  }
}

export function getScadenzaStatoColor(stato: string, dataScadenza: string): string {
  if (stato === 'completata') return COLOR_SUCCESS;
  if (stato === 'scaduta') return COLOR_DANGER;
  const daysLeft = Math.ceil((new Date(dataScadenza).getTime() - Date.now()) / 86_400_000);
  if (daysLeft <= 7) return COLOR_DANGER;
  if (daysLeft <= 30) return COLOR_WARNING;
  return COLOR_SUCCESS;
}

// ── Helpers ──────────────────────────────────────────────────────────
export function truncate(s: string | null | undefined, max = 40): string {
  if (!s) return '–';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function initials(nome: string | null | undefined): string {
  if (!nome) return '?';
  return nome.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

export function isOverdue(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  return new Date(dateStr).getTime() < Date.now();
}

export function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
