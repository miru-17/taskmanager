import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Table2, LineChart as LineIcon } from "lucide-react";
import { cx } from "../../ui/cx";
import { niceTicks, formatNumber } from "./scale";

/** A chart card with a title, a one-line takeaway, and a chart/table toggle (the table is always available). */
export const ChartCard = ({
  title,
  subtitle,
  children,
  table,
  legend,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  table: ReactNode;
  legend?: ReactNode;
  className?: string;
}) => {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cx("print-avoid-break min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card", className)} aria-label={title}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        <button
          type="button"
          className="no-print inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-elev hover:text-fg"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? <LineIcon className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {legend && !asTable && <div className="mb-2">{legend}</div>}
      {asTable ? <div className="scroll-thin max-h-80 overflow-auto">{table}</div> : children}
    </section>
  );
};

export const Legend = ({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-soft" aria-label="Legend">
    {items.map((i) => (
      <li key={i.label} className="inline-flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden>
          <line x1="1" x2="15" y1="4" y2="4" stroke={i.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={i.dashed ? "3 3" : undefined} />
        </svg>
        {i.label}
      </li>
    ))}
  </ul>
);

const useWidth = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
};

export interface Series {
  name: string;
  color: string;
  values: number[];
  /** Light area wash under the line */
  area?: boolean;
  dashed?: boolean;
}

/**
 * Multi-series line chart on one shared y-axis: hairline grid, 2px lines, end labels,
 * a crosshair + tooltip listing every series at the hovered x, and arrow-key navigation.
 */
export const LineChart = ({ labels, series, height = 220, describe, formatLabel = (s) => s }: { labels: string[]; series: Series[]; height?: number; describe: string; formatLabel?: (s: string) => string }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tipId = useId();
  const M = { top: 10, right: 96, bottom: 24, left: 36 };
  const w = width - M.left - M.right;
  const h = height - M.top - M.bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1];
  const x = (i: number) => (labels.length <= 1 ? w / 2 : (i / (labels.length - 1)) * w);
  const y = (v: number) => h - (v / top) * h;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  // Label at most ~8 dates along the axis
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(w / 80))));

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left - M.left;
    const i = labels.length <= 1 ? 0 : Math.round((px / w) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };

  if (!labels.length) return <p className="py-10 text-center text-sm text-muted">No data in this range.</p>;

  // End labels: nudge apart when two series end close together
  const ends = series.map((s) => ({ s, y: y(s.values[s.values.length - 1] ?? 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={describe}
        aria-describedby={hover !== null ? tipId : undefined}
        tabIndex={0}
        className="block touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover((v) => Math.min(labels.length - 1, (v ?? -1) + 1));
          else if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? labels.length) - 1));
          else if (e.key === "Escape") setHover(null);
          else return;
          e.preventDefault();
        }}
        onBlur={() => setHover(null)}
      >
        <g transform={`translate(${M.left},${M.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular-nums">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === labels.length - 1 ? (
              <text key={l} x={x(i)} y={h + 16} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} className="fill-muted text-[10px]">
                {formatLabel(l)}
              </text>
            ) : null
          )}
          {series.map((s) =>
            s.area ? <path key={`${s.name}-area`} d={`${path(s.values)}L${x(s.values.length - 1)},${h}L${x(0)},${h}Z`} fill={s.color} fillOpacity={0.1} stroke="none" /> : null
          )}
          {series.map((s) => (
            <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "4 4" : undefined} />
          ))}
          {ends.map(({ s, y: ey }) => (
            <g key={`${s.name}-end`}>
              <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              <text x={w + 8} y={ey} dy="0.32em" className="fill-fg-soft text-[11px] tabular-nums">
                {formatNumber(s.values[s.values.length - 1] ?? 0)} <tspan className="fill-muted">{s.name}</tspan>
              </text>
            </g>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="var(--line-strong)" strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
        </g>
      </svg>
      {hover !== null && (
        <div
          id={tipId}
          role="status"
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop"
          style={{ left: Math.min(width - 170, Math.max(0, M.left + x(hover) + 12)) }}
        >
          <p className="mb-1 text-muted">{formatLabel(labels[hover])}</p>
          {series.map((s) => (
            <p key={s.name} className="flex items-center gap-2 whitespace-nowrap">
              <span className="h-0.5 w-3 rounded" style={{ background: s.color }} aria-hidden />
              <strong className="tabular-nums text-fg">{formatNumber(s.values[hover] ?? 0)}</strong>
              <span className="text-fg-soft">{s.name}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

/** Horizontal bars for one measure across categories: value at the tip, hover lift, ≤ 24px thick. */
export const BarList = ({ rows, color = "var(--series-1)", describe }: { rows: { label: ReactNode; key: string; value: number; detail?: string }[]; color?: string; describe: string }) => {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">Nothing to show.</p>;
  return (
    <ul className="space-y-2" aria-label={describe}>
      {rows.map((r) => (
        <li key={r.key} className="group grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-3 text-sm" title={r.detail}>
          <span className="truncate text-fg-soft">{r.label}</span>
          <span className="flex items-center gap-2" aria-label={`${r.key}: ${r.value}${r.detail ? `, ${r.detail}` : ""}`}>
            <span
              className="h-4 rounded-r-[4px] transition-opacity group-hover:opacity-80"
              style={{ width: `${Math.max(r.value ? 2 : 0, (r.value / max) * 100)}%`, maxWidth: "calc(100% - 3rem)", background: color }}
              aria-hidden
            />
            <span className="tabular-nums text-xs text-fg">{formatNumber(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
};

export const DataTable = ({ head, rows }: { head: string[]; rows: (string | number)[][] }) => (
  <table className="w-full text-sm">
    <thead className="text-left text-xs text-muted">
      <tr>
        {head.map((h, i) => (
          <th key={h} className={cx("border-b border-line px-2 py-1.5 font-medium", i > 0 && "text-right")}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
    <tbody className="divide-y divide-line">
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((c, j) => (
            <td key={j} className={cx("px-2 py-1.5", j > 0 && "text-right tabular-nums")}>
              {typeof c === "number" ? formatNumber(c) : c}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);
