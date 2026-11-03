import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { useCreateTask, useMilestones, useProjects } from "../../data/queries";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type Priority, type TaskStatus } from "../../types/Task";
import { Button, Dialog, Field, field, textarea } from "../../ui";
import { AssigneeSelect, LabelPicker } from "./pickers";
import { useComposer, useTaskParam } from "./composer";

const empty = {
  title: "",
  description: "",
  status: "TODO" as TaskStatus,
  priority: "MEDIUM" as Priority,
  assigneeId: null as number | null,
  dueDate: "",
  startDate: "",
  estimateHours: "",
  labelIds: [] as string[],
  milestoneId: "",
};

/** One composer for every "new task" entry point (sidebar, board column, calendar day, subtask). */
const TaskComposer = () => {
  const { defaults, close } = useComposer();
  const { openTask } = useTaskParam();
  const { data: projects } = useProjects();
  const create = useCreateTask();

  const [form, setForm] = useState(empty);
  const [projectId, setProjectId] = useState("");
  const [another, setAnother] = useState(false);
  const { data: milestones } = useMilestones(projectId || undefined);

  const writable = (projects ?? []).filter((p) => p.status !== "ARCHIVED" && p.status !== "COMPLETED");

  useEffect(() => {
    if (!defaults) return;
    setForm({ ...empty, status: defaults.status ?? "TODO", dueDate: defaults.dueDate ?? "", assigneeId: defaults.assigneeId ?? null });
    setProjectId(defaults.projectId ?? writable[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults]);

  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const estimate = form.estimateHours.trim() ? Number(form.estimateHours) : null;
    if (estimate !== null && (Number.isNaN(estimate) || estimate < 0)) {
      toast.error("Estimate must be a positive number of hours");
      return;
    }
    const task = await create.mutateAsync({
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: form.priority,
      projectId: projectId || undefined,
      assigneeId: form.assigneeId,
      dueDate: form.dueDate || null,
      startDate: form.startDate || null,
      estimateHours: estimate,
      labelIds: form.labelIds,
      milestoneId: form.milestoneId || null,
      parentId: defaults?.parentId ?? null,
    });
    toast.success(`Created ${task.key}`);
    if (another) {
      setForm((f) => ({ ...f, title: "", description: "" }));
    } else {
      close();
      if (!defaults?.parentId) openTask(task.id);
    }
  };

  return (
    <Dialog
      open={defaults !== null}
      onClose={close}
      title={defaults?.parentId ? "New subtask" : "New task"}
      width="max-w-2xl"
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> Create another
          </label>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="task-composer" loading={create.isPending} disabled={!form.title.trim()}>
            Create task
          </Button>
        </>
      }
    >
      <form id="task-composer" onSubmit={submit} className="space-y-4">
        <input
          data-autofocus
          aria-label="Task title"
          className="w-full bg-transparent text-lg font-medium text-fg placeholder:text-muted focus:outline-none"
          placeholder="Task title"
          maxLength={200}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
        />
        <textarea
          aria-label="Description"
          className={textarea}
          rows={3}
          placeholder="Add a description…"
          maxLength={20000}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {!defaults?.parentId && (
            <Field label="Project">
              {(id) => (
                <select id={id} className={field} value={projectId} onChange={(e) => {
                    setProjectId(e.target.value);
                    set("milestoneId", "");
                  }}>
                  {writable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.key} · {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Status">
            {(id) => (
              <select id={id} className={field} value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <select id={id} className={field} value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Assignee">{(id) => <AssigneeSelect id={id} projectId={projectId} value={form.assigneeId} onChange={(v) => set("assigneeId", v)} />}</Field>
          <Field label="Start date">{(id) => <input id={id} type="date" className={field} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />}</Field>
          <Field label="Due date">{(id) => <input id={id} type="date" className={field} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />}</Field>
          <Field label="Estimate (hours)">
            {(id) => <input id={id} type="number" min={0} step={0.5} className={field} value={form.estimateHours} onChange={(e) => set("estimateHours", e.target.value)} />}
          </Field>
          {!!milestones?.length && (
            <Field label="Milestone">
              {(id) => (
                <select id={id} className={field} value={form.milestoneId} onChange={(e) => set("milestoneId", e.target.value)}>
                  <option value="">None</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>
        <LabelPicker value={form.labelIds} onChange={(v) => set("labelIds", v)} />
      </form>
    </Dialog>
  );
};

export default TaskComposer;
