/**
 * Charts — componenti grafici condivisi GAM
 * Wrapper Recharts con tema dark GAM.
 * ChartLine, ChartBar, ChartHeatmap, ChartArea, ChartPie
 */
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import { COLOR_ACCENT, COLOR_SUCCESS, COLOR_WARNING, COLOR_DANGER } from '@/lib/constants';

// ── Tema colori GAM ──────────────────────────────────────────────────
const CHART_COLORS = [COLOR_ACCENT, COLOR_SUCCESS, COLOR_WARNING, COLOR_DANGER, '#9B59B6', '#1ABC9C'];
const GRID_COLOR = '#1E3A5F';
const AXIS_COLOR = '#4A7A9B';
const BG_TOOLTIP = '#132338';
const BORDER_TOOLTIP = '#1E3A5F';
const TEXT_TOOLTIP = '#E8F4FD';

// ── Tooltip custom ───────────────────────────────────────────────────
function GamTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  formatter?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: BG_TOOLTIP, border: `1px solid ${BORDER_TOOLTIP}`, borderRadius: 4, padding: '8px 12px' }}>
      {label && <p style={{ color: AXIS_COLOR, fontSize: 11, marginBottom: 4 }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: 12, margin: '2px 0' }}>
          <span style={{ color: TEXT_TOOLTIP }}>{p.name}: </span>
          {formatter ? formatter(p.value, p.name) : p.value}
        </p>
      ))}
    </div>
  );
}

// ── ChartLine ────────────────────────────────────────────────────────
interface ChartLineProps {
  data: Record<string, unknown>[];
  lines: { key: string; label: string; color?: string }[];
  xKey: string;
  height?: number;
  formatter?: (v: number, name: string) => string;
  className?: string;
}

export function ChartLine({ data, lines, xKey, height = 200, formatter, className }: ChartLineProps) {
  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={xKey} tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<GamTooltip formatter={formatter} />} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: AXIS_COLOR }} />}
          {lines.map((l, i) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── ChartArea ────────────────────────────────────────────────────────
interface ChartAreaProps {
  data: Record<string, unknown>[];
  areas: { key: string; label: string; color?: string }[];
  xKey: string;
  height?: number;
  formatter?: (v: number, name: string) => string;
  className?: string;
}

export function ChartArea({ data, areas, xKey, height = 200, formatter, className }: ChartAreaProps) {
  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            {areas.map((a, i) => {
              const color = a.color ?? CHART_COLORS[i % CHART_COLORS.length];
              return (
                <linearGradient key={a.key} id={`grad-${a.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={xKey} tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<GamTooltip formatter={formatter} />} />
          {areas.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: AXIS_COLOR }} />}
          {areas.map((a, i) => {
            const color = a.color ?? CHART_COLORS[i % CHART_COLORS.length];
            return (
              <Area
                key={a.key}
                type="monotone"
                dataKey={a.key}
                name={a.label}
                stroke={color}
                strokeWidth={2}
                fill={`url(#grad-${a.key})`}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── ChartBar ─────────────────────────────────────────────────────────
interface ChartBarProps {
  data: Record<string, unknown>[];
  bars: { key: string; label: string; color?: string }[];
  xKey: string;
  height?: number;
  stacked?: boolean;
  formatter?: (v: number, name: string) => string;
  className?: string;
}

export function ChartBar({ data, bars, xKey, height = 200, stacked = false, formatter, className }: ChartBarProps) {
  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey={xKey} tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<GamTooltip formatter={formatter} />} />
          {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: AXIS_COLOR }} />}
          {bars.map((b, i) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.label}
              fill={b.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              stackId={stacked ? 'stack' : undefined}
              radius={stacked ? [0, 0, 0, 0] : [2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── ChartPie ─────────────────────────────────────────────────────────
interface ChartPieProps {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  innerRadius?: number;
  formatter?: (v: number) => string;
  className?: string;
}

export function ChartPie({ data, height = 180, innerRadius = 40, formatter, className }: ChartPieProps) {
  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={innerRadius + 30}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number) => formatter ? formatter(v) : v}
            contentStyle={{ background: BG_TOOLTIP, border: `1px solid ${BORDER_TOOLTIP}`, borderRadius: 4, fontSize: 12, color: TEXT_TOOLTIP }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: AXIS_COLOR }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── ChartHeatmap ─────────────────────────────────────────────────────
/**
 * Heatmap 7×24 (giorni × ore) per occupancy/energia.
 * data: array di { day: string, hour: number, value: number }
 */
interface HeatmapCell {
  day: string;
  hour: number;
  value: number | null;
}

interface ChartHeatmapProps {
  data: HeatmapCell[];
  days: string[];
  minColor?: string;
  maxColor?: string;
  formatter?: (v: number) => string;
  className?: string;
}

export function ChartHeatmap({
  data, days,
  minColor = '#132338',
  maxColor = COLOR_ACCENT,
  formatter,
  className,
}: ChartHeatmapProps) {
  const values = data.map(d => d.value ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);

  function interpolateColor(t: number): string {
    // Interpolazione lineare tra minColor e maxColor
    const parse = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const [r1, g1, b1] = parse(minColor.startsWith('#') ? minColor : '#132338');
    const [r2, g2, b2] = parse(maxColor.startsWith('#') ? maxColor : '#00A3E0');
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  }

  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const cellMap = new Map(data.map(d => [`${d.day}-${d.hour}`, d.value]));

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(24, 1fr)`, gap: 2, minWidth: 600 }}>
        {/* Header ore */}
        <div />
        {HOURS.map(h => (
          <div key={h} style={{ fontSize: 9, color: AXIS_COLOR, textAlign: 'center' }}>
            {h % 4 === 0 ? `${h}h` : ''}
          </div>
        ))}
        {/* Righe giorni */}
        {days.map(day => (
          <>
            <div key={`label-${day}`} style={{ fontSize: 10, color: AXIS_COLOR, display: 'flex', alignItems: 'center' }}>
              {day}
            </div>
            {HOURS.map(h => {
              const val = cellMap.get(`${day}-${h}`) ?? null;
              const t = (val != null && max > min) ? (val - min) / (max - min) : 0;
              return (
                <div
                  key={`${day}-${h}`}
                  title={val != null ? (formatter ? formatter(val) : String(val)) : '–'}
                  style={{
                    height: 16,
                    borderRadius: 2,
                    backgroundColor: val != null ? interpolateColor(t) : '#0D1B2A',
                    cursor: val != null ? 'default' : 'default',
                  }}
                />
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
