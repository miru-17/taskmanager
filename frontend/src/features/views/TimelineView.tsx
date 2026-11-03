import { useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTasks, useUpdateTask } from "../../data/queries";
import { addDays, daysBetween, todayKey, toDateInput } from "../../data/dates";
import { getErrorMessage } from "../../data/errors";
import { STATUS_LABELS, type Task, type TaskStatus } from "../../types/Task";
import { EmptyState, ErrorState, Spinner, StatusIcon } from "../../ui";
import { cx } from "../../ui/cx";
import { useTaskParam } from "../tasks/composer";
import { useProjectOutlet } from "../projects/ProjectLayout";
import { canEditTask } from "./permissions";
import { toSpans, type Span } from "./logic";

const ROW = 34;
const HEADER = 44;
const LEFT = 260;
const ZOOMS = { week: 44, month: 18, quarter: 7 } as const;
type Zoom = keyof typeof ZOOMS;

const BAR: Record<TaskStatus, string> = {
  TODO: "var(--muted)",
  IN_PROGRESS: "var(--info)",
  IN_REVIEW: "var(--warning)",
  DONE: "var(--success)",
};



const monthLabel = (key: string) => new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));

const TimelineView = () => {
  const { project, filters } = useProjectOutlet();
  const { user } = useAuth();
  const { openTask } = useTaskParam();
  const update = useUpdateTask();
  const [zoom, setZoom] = useState<Zoom>("month");
  const [drag, setDrag] = useState<{ id: number; startX: number; delta: number } | null>(null);
  const moved = useRef(false);
  const { data, isPending, isError, error, refetch } = useTasks({ ...filters, sort: "startDate", limit: 500 });

  const { spans, undated } = useMemo(() => toSpans(data?.items ?? []), [data]);
  const today = todayKey();

  const range = useMemo(() => {
    if (!spans.length) return null;
    let min = spans[0].start;
    let max = spans[0].end;
    for (const s of spans) {
      if (s.start < min) min = s.start;
      if (s.end > max) max = s.end;
    }
    if (today < min) min = today;
    if (today > max) max = today;
    const from = addDays(min, -3);
    let to = addDays(max, 10);
    if (daysBetween(from, to) < 30) to = addDays(from, 30);
    return { from, days: daysBetween(from, to) + 1 };
  }, [spans, today]);

  if (isPending) return <Spinner />;
  if (isError) return <div className="p-6"><ErrorState message={getErrorMessage(error, "Couldn't load tasks")} onRetry={() => refetch()} /></div>;
  if (!range) {
    return (
      <div className="p-6">
        <EmptyState title="Nothing to plot yet">Give tasks a start or due date and they'll appear on the timeline.{undated > 0 && ` ${undated} task(s) have no dates.`}</EmptyState>
      </div>
    );
  }

  const dayW = ZOOMS[zoom];
  const width = range.days * dayW;
  const height = spans.length * ROW;
  const xOf = (key: string) => daysBetween(range.from, key) * dayW;
  const rowOf = new Map(spans.map((s, i) => [s.task.id, i]));
  const editable = (t: Task) => project.status !== "ARCHIVED" && canEditTask(project.capabilities, user?.id, t);

  // Header ticks: months always; days when zoomed in; week starts otherwise
  const ticks: { x: number; label: string; major: boolean }[] = [];
  for (let i = 0; i < range.days; i++) {
    const key = addDays(range.from, i);
    const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
    if (key.endsWith("-01") || i === 0) ticks.push({ x: i * dayW, label: monthLabel(key), major: true });
    else if (zoom === "week" || (zoom === "month" && dow === 1)) ticks.push({ x: i * dayW, label: String(Number(key.slice(8))), major: false });
  }

  // Dependency arrows: blocker end → dependent start. Red when the plan is impossible.
  const links = spans.flatMap((s) =>
    s.task.dependsOnIds
      .filter((id) => rowOf.has(id))
      .map((id) => {
        const from = spans[rowOf.get(id)!];
        const x1 = xOf(from.end) + dayW;
        const y1 = rowOf.get(id)! * ROW + ROW / 2;
        const x2 = xOf(s.start);
        const y2 = rowOf.get(s.task.id)! * ROW + ROW / 2;
        const conflict = s.task.status !== "DONE" && s.start <= from.end;
        const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12));
        return { key: `${id}-${s.task.id}`, d: `M${x1},${y1} H${mid} V${y2} H${x2}`, conflict };
      })
  );

  const onPointerUp = (s: Span) => {
    if (!drag) return;
    const days = Math.round(drag.delta / dayW);
    setDrag(null);
    if (!days) return;
    moved.current = true;
    const input: Record<string, string> = {};
    if (s.task.startDate) input.startDate = addDays(toDateInput(s.task.startDate), days);
    if (s.task.dueDate) input.dueDate = addDays(toDateInput(s.task.dueDate), days);
    update.mutate({ id: s.task.id, input });
  };

  return (
    <div className="flex h-full flex-col px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <div role="group" aria-label="Zoom" className="inline-flex overflow-hidden rounded-lg border border-line">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={cx("px-2.5 py-1 capitalize", zoom === z ? "bg-elev-2 text-fg" : "hover:bg-elev")}>
              {z}
            </button>
          ))}
        </div>
        <span>
          {spans.length} scheduled{undated > 0 && ` · ${undated} without dates (not shown)`}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {(Object.keys(BAR) as TaskStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm" style={{ background: BAR[s] }} aria-hidden /> {STATUS_LABELS[s]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-4 bg-danger" aria-hidden /> Dependency conflict
          </span>
        </span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface">
        <div className="relative" style={{ width: LEFT + width, height: HEADER + height }}>
          {/* Task names (sticky left column) */}
          <div className="sticky left-0 z-20 float-left border-r border-line bg-surface" style={{ width: LEFT }}>
            <div className="sticky top-0 z-10 flex items-end border-b border-line bg-surface px-3 pb-2 text-xs font-medium text-muted" style={{ height: HEADER }}>
              Task
            </div>
            {spans.map((s) => (
              <button key={s.task.id} type="button" onClick={() => openTask(s.task.id)} className="flex w-full items-center gap-2 border-b border-line/60 px-3 text-left text-sm hover:bg-elev" style={{ height: ROW }}>
                <StatusIcon status={s.task.status} className="size-3.5" />
                <span className="w-14 shrink-0 text-[11px] text-muted">{s.task.key}</span>
                <span className="truncate">{s.task.title}</span>
              </button>
            ))}
          </div>

          {/* Time grid */}
          <div className="absolute top-0" style={{ left: LEFT, width, height: HEADER + height }}>
            <div className="sticky top-0 z-10 border-b border-line bg-surface" style={{ height: HEADER }}>
              {ticks.map((t) => (
                <span key={t.x} className={cx("absolute text-[11px] whitespace-nowrap", t.major ? "top-1.5 font-medium text-fg-soft" : "bottom-1.5 text-muted")} style={{ left: t.x + 4 }}>
                  {t.label}
                </span>
              ))}
            </div>
            <svg className="absolute" style={{ top: HEADER, left: 0 }} width={width} height={height} aria-hidden>
              {ticks.map((t) => (
                <line key={t.x} x1={t.x} x2={t.x} y1={0} y2={height} stroke="var(--line)" strokeWidth={t.major ? 1 : 0.5} />
              ))}
              {spans.map((_, i) => (
                <line key={i} x1={0} x2={width} y1={(i + 1) * ROW} y2={(i + 1) * ROW} stroke="var(--line)" strokeOpacity={0.6} strokeWidth={0.5} />
              ))}
              <rect x={xOf(today)} y={0} width={dayW} height={height} fill="var(--accent)" fillOpacity={0.07} />
              <line x1={xOf(today) + dayW / 2} x2={xOf(today) + dayW / 2} y1={0} y2={height} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" />
              <defs>
                <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--muted)" />
                </marker>
                <marker id="arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--danger)" />
                </marker>
              </defs>
              {links.map((l) => (
                <path key={l.key} d={l.d} fill="none" stroke={l.conflict ? "var(--danger)" : "var(--muted)"} strokeWidth={1.25} markerEnd={`url(#${l.conflict ? "arrow-bad" : "arrow"})`} />
              ))}
            </svg>

            {spans.map((s, i) => {
              const offset = drag?.id === s.task.id ? drag.delta : 0;
              const canMove = editable(s.task);
              return (
                <button
                  key={s.task.id}
                  type="button"
                  title={`${s.task.key} ${s.task.title}: ${s.start} → ${s.end}`}
                  aria-label={`${s.task.key} ${s.task.title}, ${s.start} to ${s.end}`}
                  className={cx("absolute z-[5] flex items-center overflow-hidden rounded-md px-1.5 text-[11px] font-medium text-white shadow-card", canMove ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", s.task.status === "DONE" && "opacity-70")}
                  style={{
                    top: HEADER + i * ROW + 7,
                    height: ROW - 14,
                    left: xOf(s.start) + offset + 1,
                    width: Math.max(dayW * (daysBetween(s.start, s.end) + 1) - 2, 6),
                    background: BAR[s.task.status],
                    touchAction: "none",
                  }}
                  onPointerDown={(e) => {
                    if (!canMove) return;
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    moved.current = false;
                    setDrag({ id: s.task.id, startX: e.clientX, delta: 0 });
                  }}
                  onPointerMove={(e) => drag?.id === s.task.id && setDrag({ ...drag, delta: e.clientX - drag.startX })}
                  onPointerUp={() => onPointerUp(s)}
                  onPointerCancel={() => setDrag(null)}
                  onClick={() => {
                    if (moved.current) {
                      moved.current = false;
                      return;
                    }
                    openTask(s.task.id);
                  }}
                >
                  {dayW * (daysBetween(s.start, s.end) + 1) > 60 && <span className="truncate">{s.task.title}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Drag a bar to shift its dates. Arrows run from a blocking task to the task it blocks.</p>
    </div>
  );
};

export default TimelineView;
