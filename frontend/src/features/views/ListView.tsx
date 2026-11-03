import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Archive, Trash2, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useBulk, useMilestones, useTasks } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { formatDay } from "../../data/dates";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, displayName, type Task } from "../../types/Task";
import { Avatar, Button, ConfirmDialog, EmptyState, ErrorState, LabelChip, PriorityIcon, SortArrow, Spinner, StatusIcon, fieldBase } from "../../ui";
import { cx } from "../../ui/cx";
import { DueDate, TaskMeta } from "../tasks/TaskBits";
import { useTaskParam } from "../tasks/composer";
import { useProjectOutlet } from "../projects/ProjectLayout";
import { useAssignable } from "../tasks/useAssignable";
import { canDeleteTask, canEditTask } from "./permissions";

const PAGE = 100;
type SortKey = "number" | "title" | "status" | "priority" | "dueDate" | "updatedAt";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "number", label: "Key", className: "w-20" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status", className: "w-32" },
  { key: "priority", label: "Priority", className: "w-28" },
  { key: "dueDate", label: "Due", className: "w-32" },
  { key: "updatedAt", label: "Updated", className: "hidden w-28 lg:table-cell" },
];

const BulkBar = ({ selected, tasks, onDone }: { selected: number[]; tasks: Task[]; onDone: () => void }) => {
  const { project } = useProjectOutlet();
  const { user } = useAuth();
  const bulk = useBulk();
  const people = useAssignable(project.id);
  const { data: milestones } = useMilestones(project.id);
  const [confirm, setConfirm] = useState(false);
  const chosen = tasks.filter((t) => selected.includes(t.id));
  const deletable = chosen.every((t) => canDeleteTask(project.capabilities, user?.id, t));

  const run = (action: "update" | "archive" | "delete", data?: Record<string, unknown>) =>
    bulk.mutate(
      { ids: selected, action, data },
      {
        onSuccess: () => {
          toast.success(`${selected.length} task${selected.length === 1 ? "" : "s"} ${action === "update" ? "updated" : action === "archive" ? "archived" : "deleted"}`);
          setConfirm(false);
          onDone();
        },
      }
    );

  const select = (label: string, onPick: (v: string) => void, options: { value: string; label: string }[]) => (
    <select aria-label={label} className={cx(fieldBase, "h-8 w-auto text-xs")} value="" disabled={bulk.isPending} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <div role="region" aria-label="Bulk actions" className="sticky bottom-4 z-10 mx-auto mt-4 flex w-fit flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
      <span className="text-sm font-medium">{selected.length} selected</span>
      {select("Set status", (v) => run("update", { status: v }), STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })))}
      {select("Set priority", (v) => run("update", { priority: v }), PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })))}
      {select("Assign", (v) => run("update", { assigneeId: v === "none" ? null : Number(v) }), [{ value: "none", label: "Unassigned" }, ...people.map((p) => ({ value: String(p.id), label: displayName(p) }))])}
      {!!milestones?.length && select("Milestone", (v) => run("update", { milestoneId: v === "none" ? null : v }), [{ value: "none", label: "No milestone" }, ...milestones.map((m) => ({ value: m.id, label: m.name }))])}
      <Button size="sm" icon={<Archive className="size-3.5" />} onClick={() => run("archive")} loading={bulk.isPending}>
        Archive
      </Button>
      {deletable && (
        <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm(true)}>
          Delete
        </Button>
      )}
      <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={onDone} aria-label="Clear selection" />
      <ConfirmDialog
        open={confirm}
        title={`Delete ${selected.length} task${selected.length === 1 ? "" : "s"}?`}
        message="Their subtasks are deleted too. This can't be undone from the app."
        loading={bulk.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() => run("delete")}
      />
    </div>
  );
};

const ListView = () => {
  const { project, filters, readOnly } = useProjectOutlet();
  const { user } = useAuth();
  const { openTask } = useTaskParam();
  const [sort, setSort] = useState<{ key: SortKey; order: "asc" | "desc" }>({ key: "number", order: "desc" });
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<number[]>([]);
  const [archived, setArchived] = useState(false);

  const query = { ...filters, sort: sort.key, order: sort.order, limit, archived: archived ? ("only" as const) : ("exclude" as const) };
  const { data, isPending, isError, error, refetch, isFetching } = useTasks(query);
  const items = useMemo(() => data?.items ?? [], [data]);

  // Selection never outlives the rows it refers to
  useEffect(() => setSelected((s) => s.filter((id) => items.some((t) => t.id === id))), [items]);
  useEffect(() => setLimit(PAGE), [JSON.stringify(filters), sort.key, sort.order, archived]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectable = (t: Task) => !readOnly && !archived && canEditTask(project.capabilities, user?.id, t);
  const allSelectable = items.filter(selectable);
  const toggleAll = () => setSelected(selected.length === allSelectable.length ? [] : allSelectable.map((t) => t.id));
  const toggleSort = (key: SortKey) => setSort((s) => ({ key, order: s.key === key && s.order === "asc" ? "desc" : "asc" }));

  if (isPending) return <Spinner />;
  if (isError) return <div className="p-6"><ErrorState message={getErrorMessage(error, "Couldn't load tasks")} onRetry={() => refetch()} /></div>;

  return (
    <div className="h-full overflow-y-auto scroll-thin px-4 py-4 sm:px-6">
      <div className="mb-2 flex items-center gap-3 text-xs text-muted">
        <span>
          {data.total} task{data.total === 1 ? "" : "s"}
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived only
        </label>
        {isFetching && <span>Updating…</span>}
      </div>

      {items.length === 0 ? (
        <EmptyState title={archived ? "No archived tasks" : "No tasks match"}>{archived ? "Archived tasks show up here." : "Try clearing the filters."}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="w-10 px-3 py-2">
                  {allSelectable.length > 0 && (
                    <input type="checkbox" aria-label="Select all" checked={selected.length > 0 && selected.length === allSelectable.length} onChange={toggleAll} />
                  )}
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={cx("px-2 py-2 font-medium", c.className)} aria-sort={sort.key === c.key ? (sort.order === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sort.key === c.key && <SortArrow dir={sort.order} />}
                    </button>
                  </th>
                ))}
                <th className="w-32 px-2 py-2 font-medium">Assignee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((t) => (
                <tr key={t.id} className={cx("hover:bg-elev/60", selected.includes(t.id) && "bg-accent/5")}>
                  <td className="px-3 py-2">
                    {selectable(t) && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.key}`}
                        checked={selected.includes(t.id)}
                        onChange={() => setSelected((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted">{t.key}</td>
                  <td className="px-2 py-2">
                    <button type="button" className="flex min-w-0 items-center gap-2 text-left hover:text-accent" onClick={() => openTask(t.id)}>
                      <span className={cx("truncate", t.status === "DONE" && "text-muted line-through")}>{t.title}</span>
                      <span className="hidden shrink-0 items-center gap-2 md:inline-flex">
                        <TaskMeta task={t} />
                        {t.labels.slice(0, 3).map((l) => (
                          <LabelChip key={l.id} name={l.name} color={l.color} />
                        ))}
                      </span>
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <StatusIcon status={t.status} /> {STATUS_LABELS[t.status]}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <PriorityIcon priority={t.priority} className="size-3.5" /> {PRIORITY_LABELS[t.priority]}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <DueDate task={t} />
                  </td>
                  <td className="hidden px-2 py-2 text-xs text-muted lg:table-cell">{formatDay(t.updatedAt)}</td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <Avatar user={t.assignee} size={18} />
                      <span className="truncate">{t.assignee ? displayName(t.assignee) : <span className="text-muted">—</span>}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total > items.length && (
        <div className="mt-3 text-center">
          <Button size="sm" onClick={() => setLimit((l) => Math.min(500, l + PAGE))} disabled={limit >= 500} loading={isFetching}>
            {limit >= 500 ? `Showing the first 500 of ${data.total}. Narrow the filters to see more.` : `Load more (${data.total - items.length} remaining)`}
          </Button>
        </div>
      )}

      {selected.length > 0 && <BulkBar selected={selected} tasks={items} onDone={() => setSelected([])} />}
    </div>
  );
};

export default ListView;
