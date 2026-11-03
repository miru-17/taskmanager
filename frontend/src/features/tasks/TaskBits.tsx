import { useState } from "react";
import toast from "react-hot-toast";
import { Ban, Bookmark, CheckSquare, GitBranch, Paperclip, Repeat, Search, X } from "lucide-react";
import api from "../../services/api";
import { useLabels, useOrgAction, useSavedViews } from "../../data/queries";
import { dueLabel } from "../../data/dates";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type SavedView, type Task } from "../../types/Task";
import { Avatar, Button, Dialog, Field, LabelChip, PriorityIcon, StatusIcon, field, fieldBase } from "../../ui";
import { cx } from "../../ui/cx";
import { useAssignable } from "./useAssignable";
import { useFilters } from "./useFilters";

const toneClass = { danger: "text-danger", warning: "text-warning", muted: "text-muted" };

export const DueDate = ({ task }: { task: Pick<Task, "dueDate" | "status"> }) => {
  const d = dueLabel(task.dueDate, task.status === "DONE");
  if (!d) return null;
  return <span className={cx("text-xs whitespace-nowrap", toneClass[d.tone])}>{d.text}</span>;
};

/** Small facts shown on cards and rows: checklist, subtasks, blocked. */
export const TaskMeta = ({ task }: { task: Task }) => (
  <>
    {task.isBlocked && task.status !== "DONE" && (
      <span className="inline-flex items-center gap-1 text-xs text-danger" title="Blocked by unfinished tasks">
        <Ban className="size-3" aria-hidden /> Blocked
      </span>
    )}
    {task.checklistTotal > 0 && (
      <span className="inline-flex items-center gap-1 text-xs text-muted" title="Checklist">
        <CheckSquare className="size-3" aria-hidden /> {task.checklistDone}/{task.checklistTotal}
      </span>
    )}
    {task.isRecurring && (
      <span className="inline-flex items-center text-xs text-muted" title="Repeats">
        <Repeat className="size-3" aria-label="Repeats" />
      </span>
    )}
    {task.attachmentCount > 0 && (
      <span className="inline-flex items-center gap-1 text-xs text-muted" title="Files">
        <Paperclip className="size-3" aria-hidden /> {task.attachmentCount}
      </span>
    )}
    {task.subtaskCount > 0 && (
      <span className="inline-flex items-center gap-1 text-xs text-muted" title="Subtasks">
        <GitBranch className="size-3" aria-hidden /> {task.subtaskCount}
      </span>
    )}
  </>
);

export const TaskCardBody = ({ task }: { task: Task }) => (
  <>
    <div className="flex items-start gap-2">
      <span className="min-w-0 flex-1 text-sm leading-snug text-fg">{task.title}</span>
      <Avatar user={task.assignee} size={20} />
    </div>
    {task.labels.length > 0 && (
      <div className="mt-2 flex flex-wrap gap-1">
        {task.labels.map((l) => (
          <LabelChip key={l.id} name={l.name} color={l.color} />
        ))}
      </div>
    )}
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <PriorityIcon priority={task.priority} className="size-3.5" />
      <span className="text-[11px] font-medium text-muted">{task.key}</span>
      <TaskMeta task={task} />
      <span className="ml-auto">
        <DueDate task={task} />
      </span>
    </div>
  </>
);

/** One line in a list (My tasks, search results…). */
export const TaskLine = ({ task, onOpen, showProject }: { task: Task; onOpen: () => void; showProject?: boolean }) => (
  <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-elev focus-visible:bg-elev">
    <StatusIcon status={task.status} />
    <PriorityIcon priority={task.priority} className="size-3.5" />
    <span className="w-16 shrink-0 text-xs text-muted">{task.key}</span>
    <span className={cx("min-w-0 flex-1 truncate text-sm", task.status === "DONE" && "text-muted line-through")}>{task.title}</span>
    <span className="hidden items-center gap-2 sm:flex">
      <TaskMeta task={task} />
      {task.labels.slice(0, 2).map((l) => (
        <LabelChip key={l.id} name={l.name} color={l.color} />
      ))}
    </span>
    {showProject && (
      <span className="hidden items-center gap-1.5 text-xs text-muted md:flex">
        <span className="size-2 rounded-sm" style={{ background: task.project.color }} aria-hidden />
        {task.project.name}
      </span>
    )}
    <span className="w-24 text-right">
      <DueDate task={task} />
    </span>
    <Avatar user={task.assignee} size={20} />
  </button>
);


const SavedViews = ({ projectId, viewType, current, onApply }: { projectId?: string; viewType: SavedView["viewType"]; current: Record<string, string>; onApply: (f: Record<string, unknown>) => void }) => {
  const { data: views } = useSavedViews(projectId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const save = useOrgAction(
    () => api.post("/views", { name: name.trim(), viewType, projectId: projectId ?? null, filters: Object.fromEntries(Object.entries(current).filter(([, v]) => v)), shared }),
    "Could not save the view"
  );
  const remove = useOrgAction((id: string) => api.delete(`/views/${id}`), "Could not delete the view");
  // Filters are shared by every view type, so any saved view of this scope applies here
  const mine = views ?? [];

  return (
    <>
      {mine.length > 0 && (
        <select
          aria-label="Saved views"
          className={cx(fieldBase, "w-auto")}
          value=""
          onChange={(e) => {
            const v = mine.find((x) => x.id === e.target.value);
            if (v) onApply(v.filters);
          }}
        >
          <option value="">Saved views…</option>
          {mine.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.shared ? " (shared)" : ""}
            </option>
          ))}
        </select>
      )}
      <Button size="sm" variant="ghost" icon={<Bookmark className="size-3.5" />} onClick={() => setOpen(true)}>
        Save view
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Save this view"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              loading={save.isPending}
              onClick={() =>
                save.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("View saved");
                    setOpen(false);
                    setName("");
                  },
                })
              }
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">{(id) => <input id={id} data-autofocus className={field} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <label className="flex items-center gap-2 text-sm text-fg-soft">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with the organization
          </label>
          {mine.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted">Existing views</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {mine.map((v) => (
                  <li key={v.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span>
                      {v.name}
                      {v.shared && <span className="ml-1.5 text-xs text-muted">shared</span>}
                    </span>
                    <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => remove.mutate(v.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
};

export const FilterBar = ({
  projectId,
  viewType,
  hideStatus,
}: {
  projectId?: string;
  viewType: SavedView["viewType"];
  hideStatus?: boolean;
}) => {
  const { raw, set, clear, active, apply } = useFilters();
  const { data: labels } = useLabels();
  const people = useAssignable(projectId);
  const [q, setQ] = useState(raw.q);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          set("q", q.trim());
        }}
      >
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
        <input
          aria-label="Search tasks"
          className={cx(fieldBase, "w-56 pl-8")}
          placeholder="Search title, description or key"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q.trim() !== raw.q && set("q", q.trim())}
        />
      </form>
      {!hideStatus && (
        <select aria-label="Filter by status" className={cx(fieldBase, "w-auto")} value={raw.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
          <option value="TODO,IN_PROGRESS,IN_REVIEW">Not done</option>
        </select>
      )}
      <select aria-label="Filter by priority" className={cx(fieldBase, "w-auto")} value={raw.priority} onChange={(e) => set("priority", e.target.value)}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
        <option value="CRITICAL,HIGH">High and above</option>
      </select>
      <select aria-label="Filter by assignee" className={cx(fieldBase, "w-auto")} value={raw.assignee} onChange={(e) => set("assignee", e.target.value)}>
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name || p.email}
          </option>
        ))}
      </select>
      {!!labels?.length && (
        <select aria-label="Filter by label" className={cx(fieldBase, "w-auto")} value={raw.label} onChange={(e) => set("label", e.target.value)}>
          <option value="">Any label</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {active && (
        <Button
          size="sm"
          variant="ghost"
          icon={<X className="size-3.5" />}
          onClick={() => {
            setQ("");
            clear();
          }}
        >
          Clear
        </Button>
      )}
      <span className="ml-auto flex items-center gap-2">
        <SavedViews
          projectId={projectId}
          viewType={viewType}
          current={raw}
          onApply={(f) => {
            setQ(typeof f.q === "string" ? f.q : "");
            apply(f);
          }}
        />
      </span>
    </div>
  );
};
