/**
 * StatusBadge — pill colorata per stati, tipi, priorità GAM
 * Componente unico per tutti i badge della piattaforma.
 */
import { cn } from '@/lib/utils';
import {
  ASSET_STATO_LABEL, WO_STATO_LABEL, WO_PRIORITA_LABEL,
  SCADENZA_TIPO_LABEL, DOCUMENTO_CATEGORIA_LABEL, ALLARME_GRAVITA_LABEL,
  ZONA_TIPO_LABEL, ENERGY_CLASS_COLOR,
} from '@/lib/constants';

export type BadgeType =
  | 'asset-stato'
  | 'wo-stato'
  | 'wo-priorita'
  | 'scadenza-stato'
  | 'scadenza-tipo'
  | 'documento-categoria'
  | 'allarme-gravita'
  | 'zona-tipo'
  | 'energy-class'
  | 'occupancy'
  | 'custom';

interface StatusBadgeProps {
  type: BadgeType;
  value: string;
  /** Solo per type='custom': colore hex del background */
  color?: string;
  /** Solo per type='custom': label da mostrare */
  label?: string;
  dot?: boolean;
  className?: string;
}

// Mappa type → { label, bg, text }
function resolveBadge(type: BadgeType, value: string, customLabel?: string, customColor?: string) {
  switch (type) {
    case 'asset-stato':
      return {
        label: ASSET_STATO_LABEL[value] ?? value,
        bg: value === 'attivo' ? 'bg-[var(--gam-success)]/15' : value === 'manutenzione' ? 'bg-[var(--gam-warning)]/15' : 'bg-[var(--gam-text-muted)]/15',
        text: value === 'attivo' ? 'text-[var(--gam-success)]' : value === 'manutenzione' ? 'text-[var(--gam-warning)]' : 'text-[var(--gam-text-muted)]',
      };
    case 'wo-stato':
      return {
        label: WO_STATO_LABEL[value] ?? value,
        bg: value === 'aperto' ? 'bg-[var(--gam-accent)]/15' : value === 'in_corso' ? 'bg-[var(--gam-warning)]/15' : value === 'chiuso' ? 'bg-[var(--gam-success)]/15' : 'bg-[var(--gam-text-muted)]/15',
        text: value === 'aperto' ? 'text-[var(--gam-accent)]' : value === 'in_corso' ? 'text-[var(--gam-warning)]' : value === 'chiuso' ? 'text-[var(--gam-success)]' : 'text-[var(--gam-text-muted)]',
      };
    case 'wo-priorita':
      return {
        label: WO_PRIORITA_LABEL[value] ?? value,
        bg: value === 'urgente' ? 'bg-[var(--gam-danger)]/15' : value === 'alta' ? 'bg-[var(--gam-warning)]/15' : value === 'media' ? 'bg-[var(--gam-accent)]/15' : 'bg-[var(--gam-text-muted)]/15',
        text: value === 'urgente' ? 'text-[var(--gam-danger)]' : value === 'alta' ? 'text-[var(--gam-warning)]' : value === 'media' ? 'text-[var(--gam-accent)]' : 'text-[var(--gam-text-muted)]',
      };
    case 'scadenza-stato':
      return {
        label: value === 'attiva' ? 'Attiva' : value === 'scaduta' ? 'Scaduta' : 'Completata',
        bg: value === 'attiva' ? 'bg-[var(--gam-accent)]/15' : value === 'scaduta' ? 'bg-[var(--gam-danger)]/15' : 'bg-[var(--gam-success)]/15',
        text: value === 'attiva' ? 'text-[var(--gam-accent)]' : value === 'scaduta' ? 'text-[var(--gam-danger)]' : 'text-[var(--gam-success)]',
      };
    case 'scadenza-tipo':
      return {
        label: SCADENZA_TIPO_LABEL[value] ?? value,
        bg: 'bg-[var(--gam-text-muted)]/15',
        text: 'text-[var(--gam-text-secondary)]',
      };
    case 'documento-categoria':
      return {
        label: DOCUMENTO_CATEGORIA_LABEL[value] ?? value,
        bg: 'bg-[var(--gam-accent)]/10',
        text: 'text-[var(--gam-text-secondary)]',
      };
    case 'allarme-gravita':
      return {
        label: ALLARME_GRAVITA_LABEL[value] ?? value,
        bg: value === 'critico' ? 'bg-[var(--gam-danger)]/15' : value === 'alto' ? 'bg-orange-500/15' : value === 'medio' ? 'bg-[var(--gam-warning)]/15' : 'bg-[var(--gam-accent)]/15',
        text: value === 'critico' ? 'text-[var(--gam-danger)]' : value === 'alto' ? 'text-orange-400' : value === 'medio' ? 'text-[var(--gam-warning)]' : 'text-[var(--gam-accent)]',
      };
    case 'zona-tipo':
      return {
        label: ZONA_TIPO_LABEL[value] ?? value,
        bg: 'bg-[var(--gam-bg-tertiary)]',
        text: 'text-[var(--gam-text-secondary)]',
      };
    case 'energy-class': {
      const color = ENERGY_CLASS_COLOR[value?.toUpperCase()] ?? '#7BAFC4';
      return {
        label: value?.toUpperCase() ?? '–',
        bg: '',
        text: '',
        style: { backgroundColor: `${color}22`, color },
      };
    }
    case 'occupancy': {
      const pct = parseFloat(value);
      const color = pct >= 80 ? 'var(--gam-danger)' : pct >= 50 ? 'var(--gam-warning)' : 'var(--gam-success)';
      return { label: `${pct.toFixed(0)}%`, bg: '', text: '', style: { backgroundColor: `${color}22`, color } };
    }
    case 'custom':
      return {
        label: customLabel ?? value,
        bg: '',
        text: '',
        style: customColor ? { backgroundColor: `${customColor}22`, color: customColor } : undefined,
      };
    default:
      return { label: value, bg: 'bg-[var(--gam-text-muted)]/15', text: 'text-[var(--gam-text-secondary)]' };
  }
}

export function StatusBadge({ type, value, color, label, dot = false, className }: StatusBadgeProps) {
  const { label: resolvedLabel, bg, text, style } = resolveBadge(type, value, label, color);

  return (
    <span
      className={cn('gam-badge', bg, text, className)}
      style={style}
    >
      {dot && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: style?.color ?? 'currentColor' }}
        />
      )}
      {resolvedLabel}
    </span>
  );
}
