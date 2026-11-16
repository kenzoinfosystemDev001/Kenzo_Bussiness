'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/cn';

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
const monthLabel = (ym: string) => MONTH.format(new Date(`${ym}-01T00:00:00Z`));

interface Series {
  label: string;
  values: number[];
  className: string;
  swatch: string;
}

/**
 * Grouped column chart (SVG, no chart library). Every value is also present in
 * a visually-hidden table so screen readers get the exact numbers; hovering or
 * focusing a month reveals its values.
 */
export function GroupedColumnChart({ months, series, height = 180, title }: { months: string[]; series: Series[]; height?: number; title: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const width = 560;
  const pad = { l: 28, r: 8, t: 12, b: 24 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const groupW = plotW / months.length;
  const barW = Math.min(18, (groupW * 0.6) / series.length);
  const y = (v: number) => pad.t + plotH - (v / niceMax) * plotH;
  const ticks = [0, niceMax / 2, niceMax];

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted" aria-hidden>
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-sm', s.swatch)} />
            {s.label}
          </span>
        ))}
        {hover !== null && (
          <span className="ml-auto tabular text-fg">
            {monthLabel(months[hover]!)}: {series.map((s) => `${s.label.toLowerCase()} ${s.values[hover]}`).join(' · ')}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{title}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-fg-subtle text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const gx = pad.l + i * groupW;
          const totalW = barW * series.length + (series.length - 1) * 3;
          return (
            <g
              key={m}
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="outline-none"
              aria-label={`${monthLabel(m)}: ${series.map((s) => `${s.label} ${s.values[i]}`).join(', ')}`}
            >
              <rect
                x={gx}
                y={pad.t}
                width={groupW}
                height={plotH}
                className={cn('fill-transparent transition-colors duration-150', hover === i && 'fill-surface-muted')}
              />
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const x = gx + (groupW - totalW) / 2 + si * (barW + 3);
                return (
                  <rect
                    key={s.label}
                    x={x}
                    y={y(v)}
                    width={barW}
                    height={Math.max(0, pad.t + plotH - y(v))}
                    rx={2}
                    className={cn(s.className, 'transition-all duration-500 ease-out')}
                  />
                );
              })}
              <text x={gx + groupW / 2} y={height - 6} textAnchor="middle" className="fill-fg-subtle text-[10px]">
                {monthLabel(m)}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Month</th>
            {series.map((s) => (
              <th key={s.label}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={m}>
              <td>{monthLabel(m)}</td>
              {series.map((s) => (
                <td key={s.label}>{s.values[i]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  className: string;
  href?: string;
}

/** Horizontal stacked distribution bar with a legend of exact counts. */
export function DistributionBar({ segments, onSelect }: { segments: Segment[]; onSelect?: (s: Segment) => void }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted"
        role="img"
        aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}
      >
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.key}
                className={cn(s.className, 'h-full transition-[width] duration-500 ease-out first:rounded-l-full last:rounded-r-full')}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {segments.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(s)}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm transition-colors duration-150 enabled:hover:bg-surface-muted"
            >
              <span className={cn('size-2.5 shrink-0 rounded-sm', s.className)} aria-hidden />
              <span className="truncate text-fg-muted">{s.label}</span>
              <span className="tabular ml-auto font-medium text-fg">{s.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars (top categories / types). */
export function BarList({ items, onSelect }: { items: Array<{ key: string; label: string; value: number }>; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((i) => (
        <li key={i.key}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(i.key)}
            className="group relative flex w-full items-center gap-3 overflow-hidden rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-150 enabled:hover:bg-surface-muted"
          >
            <span
              aria-hidden
              className="absolute inset-y-1 left-0 rounded-r-md bg-primary/10 transition-[width] duration-500 ease-out group-enabled:group-hover:bg-primary/15"
              style={{ width: `${(i.value / max) * 100}%` }}
            />
            <span className="relative truncate text-fg">{i.label}</span>
            <span className="tabular relative ml-auto font-medium text-fg">{i.value}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
