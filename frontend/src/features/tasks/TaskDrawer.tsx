import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Archive, ArchiveRestore, Bell, BellOff, Ban, BookmarkPlus, Link2, Plus, Trash2, X } from "lucide-react";
import api from "../../services/api";
import { useDeleteTask, useFields, useMilestones, useTask, useTaskAction, useUpdateTask, type TaskInput } from "../../data/queries";
import { useAuth } from "../../context/AuthContext";
import CustomFieldInput from "./CustomFieldInput";
import { ApprovalSection, AttachmentsSection, RecurrenceSection, Section } from "./DrawerExtras";
import { actorLabel, describe } from "./activityText";
import SaveTemplateDialog from "../templates/SaveTemplateDialog";
import CommentsSection from "../comments/Comments";
import { useNotificationAction } from "../../data/queries";
import { errorStatus, getErrorMessage } from "../../data/errors";
import { timeAgo, toDateInput } from "../../data/dates";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  displayName,
  type TaskDetail,
  type TaskPage,
} from "../../types/Task";
import { Avatar, Button, ConfirmDialog, Drawer, ErrorState, IconButton, Spinner, StatusIcon, field, textarea } from "../../ui";
import { cx } from "../../ui/cx";
import { AssigneeSelect, LabelPicker } from "./pickers";
import { useComposer, useTaskParam } from "./composer";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
    <span className="text-xs text-muted">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);


// ─── Pieces ──────────────────────────────────────────────────────────────────

const Checklist = ({ task }: { task: TaskDetail }) => {
  const [text, setText] = useState("");
  // Checkbox flips immediately; the server's value takes over once the refetch lands (or the write fails)
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const base = `/tasks/${task.id}/checklist`;
  const add = useTaskAction((t: string) => api.post(base, { text: t }), "Could not add the item");
  const toggle = useTaskAction((i: { id: string; done: boolean }) => api.patch(`${base}/${i.id}`, { done: i.done }), "Could not update the item");
  const remove = useTaskAction((id: string) => api.delete(`${base}/${id}`), "Could not remove the item");
  const editable = task.permissions.edit && !task.archivedAt;

  return (
    <Section title={`Checklist${task.checklist.length ? ` · ${task.checklistDone}/${task.checklistTotal}` : ""}`}>
      <ul className="space-y-1">
        {task.checklist.map((i) => (
          <li key={i.id} className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-elev">
            <input
              type="checkbox"
              aria-label={i.text}
              checked={pending[i.id] ?? i.done}
              disabled={!editable}
              onChange={(e) => {
                const done = e.target.checked;
                setPending((p) => ({ ...p, [i.id]: done }));
                toggle.mutate(
                  { id: i.id, done },
                  {
                    onSettled: () =>
                      setPending((p) => {
                        const { [i.id]: _, ...rest } = p;
                        return rest;
                      }),
                  }
                );
              }}
              className="accent-[var(--accent)]"
            />
            <span className={cx("flex-1 text-sm", (pending[i.id] ?? i.done) && "text-muted line-through")}>{i.text}</span>
            {editable && (
              <IconButton label={`Remove ${i.text}`} className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove.mutate(i.id)}>
                <X className="size-3.5" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate(text.trim(), { onSuccess: () => setText("") });
          }}
        >
          <input aria-label="Add checklist item" className={field} placeholder="Add an item and press Enter" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        </form>
      )}
    </Section>
  );
};

const Dependencies = ({ task }: { task: TaskDetail }) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: number; key: string; title: string }[]>([]);
  const { openTask } = useTaskParam();
  const add = useTaskAction((dependsOnId: number) => api.post(`/tasks/${task.id}/dependencies`, { dependsOnId }), "Could not add the blocker");
  const remove = useTaskAction((dependsOnId: number) => api.delete(`/tasks/${task.id}/dependencies/${dependsOnId}`), "Could not remove the blocker");
  const editable = task.permissions.edit && !task.archivedAt;

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await api.get<TaskPage>("/tasks", { params: { q: q.trim(), limit: 8, sort: "updatedAt", order: "desc" } });
        const taken = new Set([task.id, ...task.dependencies.map((d) => d.id)]);
        setResults(res.data.items.filter((t) => !taken.has(t.id)));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [q, task.id, task.dependencies]);

  const Ref = ({ t, onRemove }: { t: TaskDetail["dependencies"][number]; onRemove?: () => void }) => (
    <li className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-elev">
      <StatusIcon status={t.status} />
      <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => openTask(t.id)}>
        <span className="mr-1.5 text-xs text-muted">{t.key}</span>
        {t.title}
      </button>
      {onRemove && (
        <IconButton label={`Remove blocker ${t.key}`} className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={onRemove}>
          <X className="size-3.5" />
        </IconButton>
      )}
    </li>
  );

  return (
    <Section title="Dependencies">
      <p className="mb-1 text-xs text-muted">Blocked by</p>
      {task.dependencies.length ? (
        <ul className="space-y-0.5">
          {task.dependencies.map((d) => (
            <Ref key={d.id} t={d} onRemove={editable ? () => remove.mutate(d.id) : undefined} />
          ))}
        </ul>
      ) : (
        <p className="px-1 text-sm text-muted">Nothing</p>
      )}
      {editable && (
        <div className="relative mt-2">
          <input aria-label="Add a blocking task" className={field} placeholder="Add blocker: search by key or title" value={q} onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full truncate px-3 py-1.5 text-left text-sm hover:bg-elev"
                    onClick={() => add.mutate(r.id, { onSuccess: () => setQ("") })}
                  >
                    <span className="mr-1.5 text-xs text-muted">{r.key}</span>
                    {r.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {task.blocking.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs text-muted">Blocking</p>
          <ul className="space-y-0.5">
            {task.blocking.map((d) => (
              <Ref key={d.id} t={d} />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
};

// ─── Drawer ──────────────────────────────────────────────────────────────────

const TaskBody = ({ task }: { task: TaskDetail }) => {
  const { closeTask, openTask } = useTaskParam();
  const { open: openComposer } = useComposer();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const { data: milestones } = useMilestones(task.projectId);
  const { data: fields } = useFields(task.projectId);
  const { can } = useAuth();
  const [savingTemplate, setSavingTemplate] = useState(false);
  const watch = useTaskAction((on: boolean) => (on ? api.post(`/tasks/${task.id}/watch`) : api.delete(`/tasks/${task.id}/watch`)));
  const archive = useTaskAction((on: boolean) => api.post(`/tasks/${task.id}/${on ? "archive" : "unarchive"}`), "Could not change the archive state");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description ?? ""), [task.description]);

  const editable = task.permissions.edit && !task.archivedAt;
  const save = (input: TaskInput) => update.mutate({ id: task.id, input });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't access the clipboard");
    }
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Link to={`/projects/${task.projectId}/board`} onClick={closeTask} className="flex items-center gap-1.5 text-xs text-muted hover:text-fg">
          <span className="size-2 rounded-sm" style={{ background: task.project.color }} aria-hidden />
          {task.project.name}
        </Link>
        <span className="text-xs text-muted">/</span>
        <span className="text-xs font-medium text-fg-soft">{task.key}</span>
        <div className="ml-auto flex items-center">
          <IconButton label={task.isWatching ? "Stop watching" : "Watch"} onClick={() => watch.mutate(!task.isWatching)}>
            {task.isWatching ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          </IconButton>
          <IconButton label="Copy link" onClick={copyLink}>
            <Link2 className="size-4" />
          </IconButton>
          {can("templates:manage") && !task.parentId && (
            <IconButton label="Save as template" onClick={() => setSavingTemplate(true)}>
              <BookmarkPlus className="size-4" />
            </IconButton>
          )}
          {task.permissions.edit && (
            <IconButton label={task.archivedAt ? "Restore from archive" : "Archive"} onClick={() => archive.mutate(!task.archivedAt)}>
              {task.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            </IconButton>
          )}
          {task.permissions.delete && (
            <IconButton label="Delete task" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
          <IconButton label="Close" onClick={closeTask}>
            <X className="size-4" />
          </IconButton>
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {task.archivedAt && <p className="bg-warning/10 px-6 py-2 text-xs text-warning">Archived. Restore it to make changes.</p>}
        {task.isBlocked && task.status !== "DONE" && (
          <p className="flex items-center gap-2 bg-danger/8 px-6 py-2 text-xs text-danger">
            <Ban className="size-3.5" aria-hidden /> Blocked by {task.dependencies.filter((d) => d.status !== "DONE").map((d) => d.key).join(", ")}. It can't be completed until those are done.
          </p>
        )}

        <div className="px-6 pt-5 pb-4">
          {task.parent && (
            <button type="button" className="mb-2 text-xs text-muted hover:text-fg" onClick={() => openTask(task.parent!.id)}>
              ↑ {task.parent.key} {task.parent.title}
            </button>
          )}
          <input
            aria-label="Title"
            className="w-full rounded-md bg-transparent px-1 -mx-1 text-xl font-semibold text-fg focus:bg-elev focus:outline-none disabled:opacity-100"
            value={title}
            maxLength={200}
            disabled={!editable}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== task.title ? save({ title: title.trim() }) : setTitle(task.title)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <textarea
            aria-label="Description"
            className={cx(textarea, "mt-3 min-h-24", !editable && "border-transparent bg-transparent px-0")}
            placeholder={editable ? "Add a description…" : "No description"}
            value={description}
            maxLength={20000}
            disabled={!editable}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => (description.trim() || null) !== task.description && save({ description: description.trim() || null })}
          />
        </div>

        <div className="space-y-2.5 px-6 pb-5">
          <Row label="Status">
            <select aria-label="Status" className={field} value={task.status} disabled={!editable} onChange={(e) => save({ status: e.target.value })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Priority">
            <select aria-label="Priority" className={field} value={task.priority} disabled={!editable} onChange={(e) => save({ priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Assignee">
            <AssigneeSelect projectId={task.projectId} value={task.assigneeId} disabled={!editable} onChange={(v) => save({ assigneeId: v })} />
          </Row>
          <Row label="Dates">
            <div className="grid grid-cols-2 gap-2">
              <input
                aria-label="Start date"
                type="date"
                className={field}
                disabled={!editable}
                defaultValue={toDateInput(task.startDate)}
                key={`s${task.startDate}`}
                onBlur={(e) => e.target.value !== toDateInput(task.startDate) && save({ startDate: e.target.value || null })}
              />
              <input
                aria-label="Due date"
                type="date"
                className={field}
                disabled={!editable}
                defaultValue={toDateInput(task.dueDate)}
                key={`d${task.dueDate}`}
                onBlur={(e) => e.target.value !== toDateInput(task.dueDate) && save({ dueDate: e.target.value || null })}
              />
            </div>
          </Row>
          <Row label="Time (hours)">
            <div className="grid grid-cols-2 gap-2">
              <input
                aria-label="Estimate in hours"
                type="number"
                min={0}
                step={0.5}
                placeholder="Estimate"
                className={field}
                disabled={!editable}
                defaultValue={task.estimateHours ?? ""}
                key={`e${task.estimateHours}`}
                onBlur={(e) => num(e.target.value) !== task.estimateHours && save({ estimateHours: num(e.target.value) })}
              />
              <input
                aria-label="Time spent in hours"
                type="number"
                min={0}
                step={0.5}
                placeholder="Spent"
                className={field}
                disabled={!editable}
                defaultValue={task.actualHours ?? ""}
                key={`a${task.actualHours}`}
                onBlur={(e) => num(e.target.value) !== task.actualHours && save({ actualHours: num(e.target.value) })}
              />
            </div>
          </Row>
          {(milestones?.length ?? 0) > 0 && (
            <Row label="Milestone">
              <select aria-label="Milestone" className={field} value={task.milestoneId ?? ""} disabled={!editable} onChange={(e) => save({ milestoneId: e.target.value || null })}>
                <option value="">None</option>
                {milestones!.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Row>
          )}
          {fields?.map((f) => (
            <Row key={f.id} label={f.name + (f.required ? " *" : "")}>
              <CustomFieldInput field={f} projectId={task.projectId} value={task.customFields[f.id] ?? null} disabled={!editable} onCommit={(v) => save({ customFields: { [f.id]: v } })} />
            </Row>
          ))}
          <div className="pt-1">
            <LabelPicker value={task.labels.map((l) => l.id)} disabled={!editable} onChange={(labelIds) => save({ labelIds })} />
          </div>
        </div>

        <Section
          title={`Subtasks${task.subtasks.length ? ` · ${task.subtasks.filter((s) => s.status === "DONE").length}/${task.subtasks.length}` : ""}`}
          action={
            task.permissions.createSubtasks && !task.archivedAt ? (
              <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => openComposer({ projectId: task.projectId, parentId: task.id })}>
                Add
              </Button>
            ) : undefined
          }
        >
          {task.subtasks.length ? (
            <ul className="space-y-0.5">
              {task.subtasks.map((s) => (
                <li key={s.id}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-elev" onClick={() => openTask(s.id)}>
                    <StatusIcon status={s.status} />
                    <span className="text-xs text-muted">{s.key}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
                    <Avatar user={s.assignee} size={18} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-sm text-muted">No subtasks</p>
          )}
        </Section>

        <Checklist task={task} />
        <Dependencies task={task} />
        <CommentsSection task={task} />
        <ApprovalSection task={task} />
        <RecurrenceSection task={task} />
        <AttachmentsSection task={task} />

        <Section title="Activity">
          <p className="mb-3 text-xs text-muted">
            Created by {displayName(task.createdBy)} · {timeAgo(task.createdAt)}
            {task.watchers.length > 0 && ` · ${task.watchers.length} watching`}
          </p>
          <ol className="space-y-2.5">
            {task.activity.map((a) =>
              describe(a).map((line, i) => (
                <li key={`${a.id}-${i}`} className="flex gap-2 text-sm">
                  <Avatar user={a.actor} size={18} />
                  <span className="text-fg-soft">
                    <span className="font-medium text-fg">{actorLabel(a, displayName)}</span> {line}
                    <span className="ml-1.5 text-xs text-muted">{timeAgo(a.createdAt)}</span>
                  </span>
                </li>
              ))
            )}
          </ol>
        </Section>
      </div>

      <SaveTemplateDialog task={task} open={savingTemplate} onClose={() => setSavingTemplate(false)} />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${task.key}?`}
        message={task.subtaskCount ? `This also deletes its ${task.subtaskCount} subtask(s).` : "The task will be removed from every view."}
        loading={remove.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(task.id, {
            onSuccess: () => {
              toast.success(`${task.key} deleted`);
              setConfirmDelete(false);
              closeTask();
            },
          })
        }
      />
    </>
  );
};

const TaskDrawer = () => {
  const { taskId, closeTask } = useTaskParam();
  const query = useTask(taskId);
  // Opening a task clears its notifications
  const markRead = useNotificationAction((id: number) => api.post(`/notifications/read-task/${id}`));
  const { mutate } = markRead;
  useEffect(() => {
    if (taskId !== null && query.isSuccess) mutate(taskId);
  }, [taskId, query.isSuccess, mutate]);
  return (
    <Drawer open={taskId !== null} onClose={closeTask} label="Task details">
      {query.isPending ? (
        <Spinner label="Loading task…" />
      ) : query.isError ? (
        <div className="p-6">
          <ErrorState message={errorStatus(query.error) === 404 ? "This task doesn't exist or you don't have access to it." : getErrorMessage(query.error, "Couldn't load this task")} />
          <Button className="mt-4" onClick={closeTask}>
            Close
          </Button>
        </div>
      ) : (
        <TaskBody task={query.data} />
      )}
    </Drawer>
  );
};

export default TaskDrawer;
