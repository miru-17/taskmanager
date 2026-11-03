import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTasks, useUpdateTask } from "../../data/queries";
import { todayKey, toDateInput } from "../../data/dates";
import { getErrorMessage } from "../../data/errors";
import type { Task } from "../../types/Task";
import { Button, ErrorState, IconButton, PriorityIcon, Spinner } from "../../ui";
import { cx } from "../../ui/cx";
import { useComposer, useTaskParam } from "../tasks/composer";
import { useProjectOutlet } from "../projects/ProjectLayout";
import { canEditTask } from "./permissions";
import { monthGrid } from "./logic";

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i)))); // Mon…Sun
const monthTitle = (y: number, m: number) => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 1)));


const MAX_VISIBLE = 3;

const CalendarView = () => {
  const { project, filters, readOnly } = useProjectOutlet();
  const { user } = useAuth();
  const { openTask } = useTaskParam();
  const { open } = useComposer();
  const update = useUpdateTask();
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const { data, isPending, isError, error, refetch } = useTasks({ ...filters, dueFrom: days[0], dueTo: days[41], sort: "priority", limit: 500 });
  const undated = useTasks({ ...filters, dueTo: undefined, dueFrom: undefined, limit: 1 }, !isPending);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of data?.items ?? []) {
      const k = toDateInput(t.dueDate);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [data]);

  const shift = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  const today = todayKey();
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const editable = (t: Task) => project.status !== "ARCHIVED" && canEditTask(project.capabilities, user?.id, t);

  if (isError) return <div className="p-6"><ErrorState message={getErrorMessage(error, "Couldn't load tasks")} onRetry={() => refetch()} /></div>;

  return (
    <div className="flex h-full flex-col px-4 py-4 sm:px-6">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">{monthTitle(cursor.y, cursor.m)}</h2>
        <IconButton label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Next month" onClick={() => shift(1)}>
          <ChevronRight className="size-4" />
        </IconButton>
        <Button size="sm" variant="ghost" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>
          Today
        </Button>
        <span className="ml-auto text-xs text-muted">
          {data ? `${data.total} due this view` : ""}
          {undated.data && undated.data.total > (data?.total ?? 0) && ` · ${undated.data.total - (data?.total ?? 0)} others outside it or undated`}
        </span>
      </div>

      {isPending ? (
        <Spinner />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(5.5rem,1fr))] overflow-hidden rounded-xl border border-line bg-line gap-px">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-surface px-2 py-1.5 text-xs font-medium text-muted">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const tasks = byDay.get(day) ?? [];
            const inMonth = day.startsWith(monthPrefix);
            const showAll = expanded === day;
            const visible = showAll ? tasks : tasks.slice(0, MAX_VISIBLE);
            return (
              <div
                key={day}
                aria-label={day}
                className={cx("group relative flex min-h-0 flex-col bg-surface p-1", !inMonth && "bg-elev/40", dragOver === day && "ring-2 ring-inset ring-accent")}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/x-taskforge-task")) {
                    e.preventDefault();
                    setDragOver(day);
                  }
                }}
                onDragLeave={() => setDragOver((d) => (d === day ? null : d))}
                onDrop={(e) => {
                  setDragOver(null);
                  const id = Number(e.dataTransfer.getData("application/x-taskforge-task"));
                  const task = data?.items.find((t) => t.id === id);
                  if (task && toDateInput(task.dueDate) !== day) update.mutate({ id, input: { dueDate: day } });
                }}
              >
                <div className="flex items-center justify-between px-1">
                  <span className={cx("text-xs", day === today ? "flex size-5 items-center justify-center rounded-full bg-accent font-semibold text-accent-fg" : inMonth ? "text-fg-soft" : "text-muted")}>
                    {Number(day.slice(8))}
                  </span>
                  {!readOnly && (
                    <button type="button" aria-label={`Add task due ${day}`} className="rounded px-1 text-xs text-muted opacity-0 hover:bg-elev group-hover:opacity-100 focus:opacity-100" onClick={() => open({ projectId: project.id, dueDate: day })}>
                      +
                    </button>
                  )}
                </div>
                <div className={cx("mt-0.5 space-y-0.5", showAll && "scroll-thin overflow-y-auto")}>
                  {visible.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      draggable={editable(t)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-taskforge-task", String(t.id));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => openTask(t.id)}
                      className={cx(
                        "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-elev",
                        t.status === "DONE" ? "text-muted line-through" : "text-fg"
                      )}
                      title={`${t.key} ${t.title}`}
                    >
                      <PriorityIcon priority={t.priority} className="size-3" />
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))}
                  {tasks.length > MAX_VISIBLE && (
                    <button type="button" className="px-1 text-[11px] text-muted hover:text-fg" onClick={() => setExpanded(showAll ? null : day)}>
                      {showAll ? "Show less" : `+${tasks.length - MAX_VISIBLE} more`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Drag a task to another day to change its due date. Tasks without a due date appear in the Board and List views.</p>
    </div>
  );
};

export default CalendarView;
