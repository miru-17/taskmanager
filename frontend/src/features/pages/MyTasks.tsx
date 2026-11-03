import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTasks, type TaskFilters } from "../../data/queries";
import { daysBetween, todayKey, toDateInput } from "../../data/dates";
import { getErrorMessage } from "../../data/errors";
import type { Task } from "../../types/Task";
import { EmptyState, ErrorState, Spinner } from "../../ui";
import { cx } from "../../ui/cx";
import { TaskLine, FilterBar } from "../tasks/TaskBits";
import { useFilters } from "../tasks/useFilters";
import { useTaskParam } from "../tasks/composer";

type Tab = "assigned" | "created" | "watching";
const TABS: { id: Tab; label: string }[] = [
  { id: "assigned", label: "Assigned to me" },
  { id: "created", label: "Created by me" },
  { id: "watching", label: "Watching" },
];

const BUCKETS = ["Overdue", "Today", "Next 7 days", "Later", "No due date", "Done"] as const;

const bucketOf = (t: Task): (typeof BUCKETS)[number] => {
  if (t.status === "DONE") return "Done";
  if (!t.dueDate) return "No due date";
  const d = daysBetween(todayKey(), toDateInput(t.dueDate));
  if (d < 0) return "Overdue";
  if (d === 0) return "Today";
  if (d <= 7) return "Next 7 days";
  return "Later";
};

const MyTasks = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("assigned");
  const [showDone, setShowDone] = useState(false);
  const { filters } = useFilters();
  const { openTask } = useTaskParam();

  const query: TaskFilters = {
    ...filters,
    ...(tab === "assigned" ? { assigneeId: "me" as const } : tab === "created" ? { createdById: "me" as const } : { watching: true }),
    ...(showDone || filters.status ? {} : { status: ["TODO", "IN_PROGRESS", "IN_REVIEW"] }),
    sort: "dueDate",
    order: "asc",
    limit: 500,
  };
  const { data, isPending, isError, error, refetch } = useTasks(query);

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of data?.items ?? []) {
      const b = bucketOf(t);
      map.set(b, [...(map.get(b) ?? []), t]);
    }
    return BUCKETS.filter((b) => map.has(b)).map((b) => ({ name: b, tasks: map.get(b)! }));
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">My tasks</h1>
      <p className="mt-1 text-sm text-muted">Hi {user?.name || user?.email?.split("@")[0]}, here's what's on your plate across every project.</p>

      <div className="mt-6 flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.id ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg")}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 pb-1 text-xs text-muted">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include done
        </label>
      </div>

      <div className="mt-4">
        <FilterBar viewType="my-tasks" />
      </div>

      <div className="mt-4">
        {isPending ? (
          <Spinner />
        ) : isError ? (
          <ErrorState message={getErrorMessage(error, "Couldn't load your tasks")} onRetry={() => refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState icon={<ListChecks className="size-8" />} title="Nothing here">
            {tab === "assigned" ? "No open tasks are assigned to you." : tab === "created" ? "You haven't created any open tasks." : "You aren't watching any open tasks."}
          </EmptyState>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <h2 className={cx("mb-1.5 text-xs font-semibold uppercase tracking-wider", g.name === "Overdue" ? "text-danger" : "text-muted")}>
                  {g.name} <span className="font-normal">· {g.tasks.length}</span>
                </h2>
                <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  {g.tasks.map((t) => (
                    <TaskLine key={t.id} task={t} showProject onOpen={() => openTask(t.id)} />
                  ))}
                </div>
              </section>
            ))}
            {data && data.total > data.items.length && <p className="text-center text-xs text-muted">Showing the first {data.items.length} of {data.total}. Narrow the filters to see the rest.</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyTasks;
