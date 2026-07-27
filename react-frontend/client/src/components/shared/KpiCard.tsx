/**
 * KpiCard — card KPI numerica standard GAM
 * Usata in tutti i moduli: Asset Management, Efficiency, BEMS.
 * Nessun inline style: tutto via classi CSS e CSS vars.
 */
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export type KpiTrend = 'up' | 'down' | 'flat';
export type KpiVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: KpiTrend;
  trendLabel?: string;
  variant?: KpiVariant;
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<KpiVariant, { value: string; icon: string; border: string }> = {
  default:  { value: 'text-[var(--gam-text-primary)]',   icon: 'text-[var(--gam-text-secondary)]', border: 'border-[var(--gam-border)]' },
  success:  { value: 'text-[var(--gam-success)]',         icon: 'text-[var(--gam-success)]',         border: 'border-[var(--gam-success)]/30' },
  warning:  { value: 'text-[var(--gam-warning)]',         icon: 'text-[var(--gam-warning)]',         border: 'border-[var(--gam-warning)]/30' },
  danger:   { value: 'text-[var(--gam-danger)]',          icon: 'text-[var(--gam-danger)]',          border: 'border-[var(--gam-danger)]/30' },
  info:     { value: 'text-[var(--gam-info)]',            icon: 'text-[var(--gam-info)]',            border: 'border-[var(--gam-info)]/30' },
  accent:   { value: 'text-[var(--gam-accent)]',          icon: 'text-[var(--gam-accent)]',          border: 'border-[var(--gam-accent)]/30' },
};

const TREND_ICON: Record<KpiTrend, React.ElementType> = {
  up: TrendingUp, down: TrendingDown, flat: Minus,
};

const TREND_COLOR: Record<KpiTrend, string> = {
  up: 'text-[var(--gam-success)]',
  down: 'text-[var(--gam-danger)]',
  flat: 'text-[var(--gam-text-muted)]',
};

export function KpiCard({
  label, value, unit, trend, trendLabel, variant = 'default',
  icon, onClick, className, loading = false,
}: KpiCardProps) {
  const v = VARIANT_CLASSES[variant];
  const TrendIcon = trend ? TREND_ICON[trend] : null;

  return (
    <div
      className={cn(
        'gam-card gam-card-hover p-4 flex flex-col gap-2',
        v.border,
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
    >
      {/* Header: label + icon */}
      <div className="flex items-center justify-between">
        <span className="gam-label">{label}</span>
        {icon && <span className={cn('text-base', v.icon)}>{icon}</span>}
      </div>

      {/* Value */}
      {loading ? (
        <div className="h-8 w-24 bg-[var(--gam-bg-tertiary)] rounded animate-pulse" />
      ) : (
        <div className="flex items-baseline gap-1">
          <span className={cn('gam-kpi-value', v.value)}>{value}</span>
          {unit && <span className="text-xs text-[var(--gam-text-muted)]">{unit}</span>}
        </div>
      )}

      {/* Trend */}
      {trend && TrendIcon && (
        <div className={cn('flex items-center gap-1 text-xs', TREND_COLOR[trend])}>
          <TrendIcon size={12} />
          {trendLabel && <span>{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}
