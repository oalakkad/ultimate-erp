import { Direction } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { cn } from '../lib/cn.js';

// Charts (docs/modules/shell-dashboard.md §4; dataviz method): thin marks, fixed categorical
// order (--series-1…8, validated in both themes), legend for 2+ series, selective direct
// labels, hover/focus tooltips that never gate (a table view always exists), RTL-aware.

export interface ChartSeries {
  key: string;
  label: string;
}

export interface ChartDatum {
  /** Category or time label on the x axis (already translated/formatted). */
  label: string;
  values: Record<string, number>;
}

interface ChartProps {
  title: string;
  description?: string;
  series: ChartSeries[];
  data: ChartDatum[];
  /** Formats values for labels, ticks, tooltips and the table (e.g. KWD with 3 decimals). */
  format: (value: number) => string;
  /** Short tick format (compact); defaults to `format`. */
  formatTick?: (value: number) => string;
  showTableLabel: string;
  showChartLabel: string;
  /**
   * Translated name for the highest value of the first series (e.g. "Best month"). When set, a
   * callout pops in over that point once the chart has drawn — taken from the data, never made up.
   */
  highlight?: string;
}

const W = 640;
const H = 260;
const PAD = { top: 22, bottom: 34, axis: 52, edge: 16 };
const PLOT_H = H - PAD.top - PAD.bottom;
const MAX_SERIES = 8;

const color = (index: number) => `var(--series-${(index % MAX_SERIES) + 1})`;

/** A clean axis maximum and 4 tick steps (0, ¼, ½, ¾, max) — 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceScale(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  return [0, 1, 2, 3, 4].map((i) => Number((i * step).toPrecision(12)));
}

function useGeometry() {
  const rtl = Direction.useDirection() === 'rtl';
  // Plot runs from the axis side to the far edge; in Arabic the axis sits on the right.
  const left = rtl ? PAD.edge : PAD.axis;
  const right = rtl ? W - PAD.axis : W - PAD.edge;
  const mirror = (x: number) => (rtl ? left + right - x : x);
  return { rtl, left, right, plotW: right - left, mirror };
}

function Frame({
  title,
  description,
  series,
  table,
  showTableLabel,
  showChartLabel,
  legendShape,
  children,
}: {
  title: string;
  description?: string | undefined;
  series: ChartSeries[];
  table: ReactNode;
  showTableLabel: string;
  showChartLabel: string;
  legendShape: 'rect' | 'line';
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="grid min-w-0 gap-3">
      <figcaption className="flex flex-wrap items-start gap-2">
        <div className="grid gap-0.5">
          <b className="text-[14px] font-bold">{title}</b>
          {description && <small className="text-[12.5px] text-ink-3">{description}</small>}
        </div>
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => {
            setAsTable((v) => !v);
          }}
          className="ms-auto rounded-ctl px-2 py-1 text-[12.5px] font-semibold text-ink-2 hover:bg-frame hover:text-ink"
        >
          {asTable ? showChartLabel : showTableLabel}
        </button>
      </figcaption>
      {series.length >= 2 && !asTable && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={
                  legendShape === 'rect' ? 'size-2.5 rounded-[3px]' : 'h-0.5 w-3.5 rounded-full'
                }
                style={{ background: color(i) }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {asTable ? table : children}
    </figure>
  );
}

function DataTable({
  title,
  series,
  data,
  format,
}: Pick<ChartProps, 'title' | 'series' | 'data' | 'format'>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">{title}</caption>
        <thead className="text-ink-3">
          <tr>
            <th scope="col" className="py-1.5 text-start font-semibold">
              <span className="sr-only">{title}</span>
            </th>
            {series.map((s) => (
              <th key={s.key} scope="col" className="py-1.5 text-end font-semibold">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label} className="border-t border-line">
              <th scope="row" className="py-1.5 text-start font-medium">
                {d.label}
              </th>
              {series.map((s) => (
                <td key={s.key} className="py-1.5 text-end tabular-nums">
                  {format(d.values[s.key] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Axis({
  ticks,
  scaleY,
  geometry,
  formatTick,
}: {
  ticks: number[];
  scaleY: (v: number) => number;
  geometry: ReturnType<typeof useGeometry>;
  formatTick: (v: number) => string;
}) {
  const { rtl, left, right } = geometry;
  return (
    <g aria-hidden>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={left}
            x2={right}
            y1={scaleY(tick)}
            y2={scaleY(tick)}
            stroke="var(--line)"
            strokeWidth={1}
          />
          <text
            x={rtl ? right + 8 : left - 8}
            y={scaleY(tick) + 4}
            textAnchor={rtl ? 'start' : 'end'}
            className="fill-ink-3 text-[11px] tabular-nums"
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Tooltip box placed over the chart (values lead, labels follow). */
function Tooltip({
  x,
  y,
  rtl,
  heading,
  rows,
}: {
  x: number;
  y: number;
  rtl: boolean;
  heading: string;
  rows: { key: string; label: string; value: string; color: string }[];
}) {
  // x is a chart coordinate measured from the physical left edge (already mirrored in RTL);
  // convert it to a distance from the inline start so only logical CSS is used.
  const fromLeft = Math.min(Math.max((x / W) * 100, 12), 88);
  const fromStart = rtl ? 100 - fromLeft : fromLeft;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 grid min-w-[120px] gap-1 rounded-ctl ui-glass-pop px-2.5 py-2 text-[12.5px] shadow-pop"
      style={{
        insetInlineStart: `${fromStart}%`,
        top: `${(y / H) * 100}%`,
        transform: `translate(${rtl ? '50%' : '-50%'}, calc(-100% - 10px))`,
      }}
    >
      <span className="text-ink-3">{heading}</span>
      {rows.map((row) => (
        <span key={row.key} className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: row.color }} />
          <b className="font-semibold tabular-nums">{row.value}</b>
          <span className="text-ink-2">{row.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Pop-in bubble pinned to the peak (decorative: the same value is in the table view). */
function Callout({
  x,
  y,
  rtl,
  text,
  value,
}: {
  x: number;
  y: number;
  rtl: boolean;
  text: string;
  value: string;
}) {
  const fromLeft = Math.min(Math.max((x / W) * 100, 14), 86);
  const fromStart = rtl ? 100 - fromLeft : fromLeft;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-[5]"
      style={{
        insetInlineStart: `${fromStart}%`,
        top: `${(y / H) * 100}%`,
        transform: `translate(${rtl ? '50%' : '-50%'}, calc(-100% - 12px))`,
      }}
    >
      <div
        className="ui-callout grid justify-items-center gap-0.5 rounded-ctl ui-glass-pop px-2 py-1 text-[11.5px] leading-tight whitespace-nowrap shadow-pop"
        style={{ animationDelay: '900ms' }}
      >
        <span className="text-ink-3">{text}</span>
        <b className="text-[12.5px] font-bold tabular-nums">{value}</b>
      </div>
    </div>
  );
}

/** Index of the largest value of a series (first one on ties), or null when all are 0. */
function peakOf(data: ChartDatum[], key: string | undefined): number | null {
  let best: number | null = null;
  data.forEach((d, i) => {
    const v = d.values[key ?? ''] ?? 0;
    if (v > 0 && (best === null || v > (data[best]?.values[key ?? ''] ?? 0))) best = i;
  });
  return best;
}

/** Column path: 4px rounded data-end, square at the baseline. */
function columnPath(x: number, y: number, w: number, base: number): string {
  // Pill-shaped columns (design-system.md v0.4): fully rounded top, flat on the baseline.
  const r = Math.min(w / 2, Math.max(0, base - y));
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/** Vertical columns, grouped when there are several series (magnitude per category). */
export function BarChart(props: ChartProps) {
  const { title, description, series, data, format, formatTick = format } = props;
  const geometry = useGeometry();
  const [hover, setHover] = useState<{ d: number; s: number } | null>(null);
  const shown = series.slice(0, MAX_SERIES);
  const max = Math.max(0, ...data.flatMap((d) => shown.map((s) => d.values[s.key] ?? 0)));
  const ticks = niceScale(max);
  const top = ticks.at(-1) ?? 1;
  const base = PAD.top + PLOT_H;
  const scaleY = (v: number) => base - (v / top) * PLOT_H;
  const band = geometry.plotW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(22, (band * 0.62 - 4 * (shown.length - 1)) / shown.length));
  const groupW = shown.length * barW + (shown.length - 1) * 4;

  const bar = (di: number, si: number) => {
    const xStart = geometry.left + di * band + (band - groupW) / 2 + si * (barW + 4);
    const x = geometry.rtl ? geometry.mirror(xStart) - barW : xStart;
    const value = data[di]?.values[shown[si]?.key ?? ''] ?? 0;
    return { x, y: scaleY(value), value };
  };
  const tip = hover && data[hover.d] && shown[hover.s] ? bar(hover.d, hover.s) : null;
  const peak = props.highlight ? peakOf(data, shown[0]?.key) : null;

  return (
    <Frame
      title={title}
      description={description}
      series={shown}
      legendShape="rect"
      showTableLabel={props.showTableLabel}
      showChartLabel={props.showChartLabel}
      table={<DataTable title={title} series={shown} data={data} format={format} />}
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          // Text anchors are physical: x positions are already mirrored for RTL in code.
          direction="ltr"
          role="group"
          aria-label={title}
        >
          <defs>
            <pattern
              id="ui-bar-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--frame)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line-2)" strokeWidth="2" />
            </pattern>
          </defs>
          <Axis ticks={ticks} scaleY={scaleY} geometry={geometry} formatTick={formatTick} />
          {data.map((d, di) => (
            <g key={d.label}>
              {/* Each period sits in a soft capsule track; the best one is tinted. */}
              {(() => {
                const first = bar(di, 0).x;
                const last = bar(di, shown.length - 1).x;
                const x0 = Math.min(first, last) - 6;
                const w = groupW + 12;
                return (
                  <rect
                    aria-hidden
                    x={x0}
                    y={PAD.top}
                    width={w}
                    height={PLOT_H}
                    rx={w / 2}
                    fill={peak === di ? 'var(--lilac)' : 'url(#ui-bar-hatch)'}
                  />
                );
              })()}
              {shown.map((s, si) => {
                const { x, y, value } = bar(di, si);
                const active = hover?.d === di && hover.s === si;
                return (
                  <g key={s.key}>
                    <path
                      d={columnPath(x, y, barW, base)}
                      fill={color(si)}
                      className="ui-bar"
                      style={{
                        filter: active ? 'brightness(1.12)' : undefined,
                        animationDelay: `${di * 70 + si * 30}ms`,
                      }}
                    />
                    {/* Hit target larger than the mark, keyboard-focusable. */}
                    <rect
                      x={x - 3}
                      y={PAD.top}
                      width={barW + 6}
                      height={PLOT_H}
                      fill="transparent"
                      role="img"
                      tabIndex={0}
                      aria-label={`${d.label}, ${s.label}: ${format(value)}`}
                      className="outline-none focus-visible:stroke-[var(--focus)] focus-visible:stroke-2"
                      onPointerEnter={() => {
                        setHover({ d: di, s: si });
                      }}
                      onPointerLeave={() => {
                        setHover(null);
                      }}
                      onFocus={() => {
                        setHover({ d: di, s: si });
                      }}
                      onBlur={() => {
                        setHover(null);
                      }}
                    />
                    {shown.length === 1 && base - y > 0 && (
                      <text
                        aria-hidden
                        x={x + barW / 2}
                        y={Math.max(y - 6, PAD.top - 6)}
                        textAnchor="middle"
                        className="fill-ink-2 text-[11px] tabular-nums"
                      >
                        {formatTick(value)}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                aria-hidden
                x={geometry.mirror(geometry.left + di * band + band / 2)}
                y={H - 12}
                textAnchor="middle"
                className="fill-ink-3 text-[11px]"
              >
                {d.label}
              </text>
            </g>
          ))}
        </svg>
        {peak !== null && !hover && (
          <Callout
            rtl={geometry.rtl}
            x={bar(peak, 0).x + barW / 2}
            y={bar(peak, 0).y}
            text={`${props.highlight ?? ''} · ${data[peak]?.label ?? ''}`}
            value={format(bar(peak, 0).value)}
          />
        )}
        {tip && hover && (
          <Tooltip
            rtl={geometry.rtl}
            x={tip.x + barW / 2}
            y={tip.y}
            heading={data[hover.d]?.label ?? ''}
            rows={[
              {
                key: shown[hover.s]?.key ?? '',
                label: shown[hover.s]?.label ?? '',
                value: format(tip.value),
                color: color(hover.s),
              },
            ]}
          />
        )}
      </div>
    </Frame>
  );
}

/** Lines over time (change over time); crosshair snaps to the nearest point. */
export function LineChart(props: ChartProps) {
  const { title, description, series, data, format, formatTick = format } = props;
  const geometry = useGeometry();
  const [index, setIndex] = useState<number | null>(null);
  const overlayId = useId();
  const shown = series.slice(0, MAX_SERIES);
  const max = Math.max(0, ...data.flatMap((d) => shown.map((s) => d.values[s.key] ?? 0)));
  const ticks = niceScale(max);
  const top = ticks.at(-1) ?? 1;
  const base = PAD.top + PLOT_H;
  const scaleY = (v: number) => base - (v / top) * PLOT_H;
  const step = data.length > 1 ? geometry.plotW / (data.length - 1) : 0;
  const xAt = (i: number) => geometry.mirror(geometry.left + i * step);
  const last = data.length - 1;
  /** First and last labels lean inward (left edge: start, right edge: end). */
  const edgeAnchor = (i: number): 'start' | 'middle' | 'end' => {
    if (i !== 0 && i !== last) return 'middle';
    const atLeftEdge = (i === 0) !== geometry.rtl;
    return atLeftEdge ? 'start' : 'end';
  };

  const nearest = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * W;
    const fromAxis = geometry.rtl ? geometry.right - x : x - geometry.left;
    return Math.min(last, Math.max(0, Math.round(fromAxis / Math.max(step, 1))));
  };
  const onKeyDown = (e: KeyboardEvent<SVGRectElement>) => {
    const forward = geometry.rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = geometry.rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === forward) setIndex((i) => Math.min(last, (i ?? -1) + 1));
    else if (e.key === back) setIndex((i) => Math.max(0, (i ?? 1) - 1));
    else return;
    e.preventDefault();
  };
  // End labels only when they will not collide (otherwise the legend carries identity).
  const endY = shown.map((s) => scaleY(data[last]?.values[s.key] ?? 0));
  const labelEnds =
    shown.length <= 4 &&
    endY.every((y, i) => endY.every((o, j) => i === j || Math.abs(y - o) >= 14));
  const current = index === null ? null : data[index];
  const peak = props.highlight ? peakOf(data, shown[0]?.key) : null;

  return (
    <Frame
      title={title}
      description={description}
      series={shown}
      legendShape="line"
      showTableLabel={props.showTableLabel}
      showChartLabel={props.showChartLabel}
      table={<DataTable title={title} series={shown} data={data} format={format} />}
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          // Text anchors are physical: x positions are already mirrored for RTL in code.
          direction="ltr"
          role="group"
          aria-label={title}
        >
          <Axis ticks={ticks} scaleY={scaleY} geometry={geometry} formatTick={formatTick} />
          {data.map((d, i) =>
            i === 0 || i === last || (data.length <= 12 && i % 2 === 0 && i !== last - 1) ? (
              <text
                key={d.label}
                aria-hidden
                x={xAt(i)}
                y={H - 12}
                textAnchor={edgeAnchor(i)}
                className="fill-ink-3 text-[11px]"
              >
                {d.label}
              </text>
            ) : null,
          )}
          {index !== null && (
            <line
              aria-hidden
              x1={xAt(index)}
              x2={xAt(index)}
              y1={PAD.top}
              y2={base}
              stroke="var(--line-2)"
              strokeWidth={1}
            />
          )}
          {shown.map((s, si) => (
            <g key={s.key} aria-hidden>
              <path
                d={data
                  .map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${scaleY(d.values[s.key] ?? 0)}`)
                  .join('')}
                fill="none"
                pathLength={1}
                className="ui-line"
                style={{ animationDelay: `${si * 150}ms` }}
                stroke={color(si)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {[index ?? last].map((i) => (
                <circle
                  key={i}
                  cx={xAt(i)}
                  cy={scaleY(data[i]?.values[s.key] ?? 0)}
                  r={4}
                  className="ui-fade"
                  style={{ animationDelay: '1s' }}
                  fill={color(si)}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              ))}
              {labelEnds && index === null && (
                <text
                  x={xAt(last) + (geometry.rtl ? 2 : -2)}
                  y={(endY[si] ?? 0) - 8}
                  textAnchor={geometry.rtl ? 'start' : 'end'}
                  className="fill-ink-2 text-[11px] tabular-nums"
                >
                  {formatTick(data[last]?.values[s.key] ?? 0)}
                </text>
              )}
            </g>
          ))}
          {/* One overlay finds the X: pointer or arrow keys. */}
          <rect
            id={overlayId}
            x={geometry.left}
            y={PAD.top}
            width={geometry.plotW}
            height={PLOT_H}
            fill="transparent"
            role="img"
            tabIndex={0}
            aria-label={title}
            className="outline-none focus-visible:stroke-[var(--focus)] focus-visible:stroke-2"
            onPointerMove={(e) => {
              setIndex(
                nearest(
                  e.clientX,
                  (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect(),
                ),
              );
            }}
            onPointerLeave={() => {
              setIndex(null);
            }}
            onFocus={() => {
              setIndex((i) => i ?? last);
            }}
            onBlur={() => {
              setIndex(null);
            }}
            onKeyDown={onKeyDown}
          />
        </svg>
        {peak !== null && index === null && (
          <Callout
            rtl={geometry.rtl}
            x={xAt(peak)}
            y={scaleY(data[peak]?.values[shown[0]?.key ?? ''] ?? 0)}
            text={`${props.highlight ?? ''} · ${data[peak]?.label ?? ''}`}
            value={format(data[peak]?.values[shown[0]?.key ?? ''] ?? 0)}
          />
        )}
        {current && index !== null && (
          <Tooltip
            rtl={geometry.rtl}
            x={xAt(index)}
            y={Math.min(...shown.map((s) => scaleY(current.values[s.key] ?? 0)))}
            heading={current.label}
            rows={shown.map((s, si) => ({
              key: s.key,
              label: s.label,
              value: format(current.values[s.key] ?? 0),
              color: color(si),
            }))}
          />
        )}
      </div>
    </Frame>
  );
}

/** Thin progress bar (e.g. "3 of 4 setup steps"); the track is a lighter step of the fill. */
export function Meter({
  label,
  value,
  max,
  className,
}: {
  label: string;
  value: number;
  max: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-lilac', className)}
    >
      <div
        className="ui-fill-x h-full rounded-full bg-lilac-solid"
        style={{ inlineSize: `${pct}%` }}
      />
    </div>
  );
}
