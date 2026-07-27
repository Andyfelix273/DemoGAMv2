/**
 * ZoneCard — card zona BEMS standard GAM
 * Usata nella tab Zone & Occupancy della modale asset e nel floorplan.
 */
import { cn, formatKw, formatTemp, formatPpm, getOccupancyColor, getCo2Color, getTempColor } from '@/lib/utils';
import { ZONA_TIPO_LABEL } from '@/lib/constants';
import { Users, Zap, Thermometer, Wind } from 'lucide-react';
import type { Zona, TelemetriaZona } from '@/lib/types';

interface ZoneCardProps {
  zona: Zona;
  tel?: TelemetriaZona;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

export function ZoneCard({ zona, tel, onClick, selected, className }: ZoneCardProps) {
  const hasCapacity = zona.capacita_persone > 0;
  const persone = tel?.persone_presenti ?? null;
  const pct = hasCapacity && persone != null ? (persone / zona.capacita_persone) * 100 : null;
  const isOccupied = tel?.occupancy ?? (persone != null && persone > 0);
  const occColor = pct != null ? getOccupancyColor(pct) : 'var(--gam-text-muted)';

  return (
    <div
      className={cn(
        'gam-card p-3 flex flex-col gap-2 text-xs',
        onClick && 'cursor-pointer gam-card-hover',
        selected && 'border-[var(--gam-accent)]',
        className,
      )}
      onClick={onClick}
    >
      {/* Header: nome + tipo */}
      <div className="flex items-start justify-between gap-1">
        <div>
          <p className="font-semibold text-[var(--gam-text-primary)] text-[11px] leading-tight">{zona.nome}</p>
          <p className="text-[var(--gam-text-muted)] text-[10px]">{ZONA_TIPO_LABEL[zona.tipo] ?? zona.tipo}</p>
        </div>
        {/* Indicatore occupancy */}
        <div className="flex items-center gap-1 shrink-0">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: isOccupied ? 'var(--gam-success)' : 'var(--gam-text-muted)' }}
          />
          <span style={{ color: isOccupied ? 'var(--gam-success)' : 'var(--gam-text-muted)' }}>
            {isOccupied ? 'Occupata' : 'Libera'}
          </span>
        </div>
      </div>

      {/* Metriche */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {/* Superficie */}
        {zona.superficie_mq != null && (
          <div className="flex items-center gap-1 text-[var(--gam-text-secondary)]">
            <span>📐</span>
            <span>{zona.superficie_mq} m²</span>
          </div>
        )}
        {/* Potenza */}
        {tel?.power_kw != null && (
          <div className="flex items-center gap-1 text-[var(--gam-text-secondary)]">
            <Zap size={10} />
            <span>{formatKw(tel.power_kw)}</span>
          </div>
        )}
        {/* Temperatura */}
        {tel?.temp_c != null && (
          <div className="flex items-center gap-1" style={{ color: getTempColor(tel.temp_c) }}>
            <Thermometer size={10} />
            <span>{formatTemp(tel.temp_c)}</span>
          </div>
        )}
        {/* CO2 */}
        {tel?.co2_ppm != null && (
          <div className="flex items-center gap-1" style={{ color: getCo2Color(tel.co2_ppm) }}>
            <Wind size={10} />
            <span>{formatPpm(tel.co2_ppm)}</span>
          </div>
        )}
      </div>

      {/* Persone presenti */}
      {hasCapacity && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1" style={{ color: occColor }}>
            <Users size={10} />
            <span>
              {persone != null
                ? `${persone} / ${zona.capacita_persone} pers.`
                : `Cap. ${zona.capacita_persone} pers.`}
            </span>
          </div>
          {/* Progress bar occupancy */}
          {pct != null && (
            <div className="w-16 h-1.5 bg-[var(--gam-bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: occColor }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
