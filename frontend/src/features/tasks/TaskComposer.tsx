import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import api from "../../services/api";
import { useCreateTask, useFields, useMilestones, useProjects, useTaskAction, useTemplates } from "../../data/queries";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type Priority, type Task, type TaskStatus } from "../../types/Task";
import CustomFieldInput from "./CustomFieldInput";
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
  const { data: fields } = useFields(projectId || undefined);
  const { data: templates } = useTemplates(projectId || undefined, defaults !== null && !defaults?.parentId && Boolean(projectId));
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const template = templates?.find((t) => t.id === templateId);
  const apply = useTaskAction(
    async (body: Record<string, unknown>) => (await api.post<Task>(`/templates/${templateId}/apply`, body)).data,
    "Could not create from the template"
  );

  const writable = (projects ?? []).filter((p) => p.status !== "ARCHIVED" && p.status !== "COMPLETED");

  useEffect(() => {
    if (!defaults) return;
    setForm({ ...empty, status: defaults.status ?? "TODO", dueDate: defaults.dueDate ?? "", assigneeId: defaults.assigneeId ?? null });
    setProjectId(defaults.projectId ?? writable[0]?.id ?? "");
    setTemplateId("");
    setValues({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults]);

  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const customFields = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined && v !== ""));
    const missing = (fields ?? []).filter((f) => f.required && customFields[f.id] === undefined);
    if (missing.length) {
      toast.error(`Fill in ${missing.map((f) => f.name).join(", ")}`);
      return;
    }
    if (template) {
      const task = (await apply.mutateAsync({
        projectId,
        title: form.title.trim(),
        // Empty means "use the template's relative due date"
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
        assigneeId: form.assigneeId,
        customFields,
      })) as Task;
      toast.success(`Created ${task.key} from “${template.name}”`);
      close();
      openTask(task.id);
      return;
    }
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
      customFields,
    });
    toast.success(`Created ${task.key}`);
    if (another) {
      setForm((f) => ({ ...f, title: "", description: "" }));
      setValues({});
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
          <Button variant="primary" type="submit" form="task-composer" loading={create.isPending || apply.isPending} disabled={!form.title.trim()}>
            Create task
          </Button>
        </>
      }
    >
      <form id="task-composer" onSubmit={submit} className="space-y-4">
        {!defaults?.parentId && !!templates?.length && (
          <div className="flex items-center gap-2 rounded-lg bg-elev px-3 py-2">
            <label htmlFor="composer-template" className="text-xs font-medium text-fg-soft">
              Template
            </label>
            <select
              id="composer-template"
              className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-sm"
              value={templateId}
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                setTemplateId(e.target.value);
                if (t) set("title", t.payload.title);
              }}
            >
              <option value="">Blank task</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.projectId ? "" : " (all projects)"}
                </option>
              ))}
            </select>
          </div>
        )}
        {template && (
          <p className="text-xs text-muted">
            Uses the template's description, priority, labels, {template.checklistCount} checklist item{template.checklistCount === 1 ? "" : "s"} and {template.subtaskCount} subtask
            {template.subtaskCount === 1 ? "" : "s"}
            {template.payload.dueInDays != null ? `, due ${template.payload.dueInDays} day${template.payload.dueInDays === 1 ? "" : "s"} from today unless you pick a date` : ""}.
          </p>
        )}
        <input
          data-autofocus
          aria-label="Task title"
          className="w-full bg-transparent text-lg font-medium text-fg placeholder:text-muted focus:outline-none"
          placeholder="Task title"
          maxLength={200}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
        />
        {!template && (
        <textarea
          aria-label="Description"
          className={textarea}
          rows={3}
          placeholder="Add a description…"
          maxLength={20000}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {!defaults?.parentId && (
            <Field label="Project">
              {(id) => (
                <select id={id} className={field} value={projectId} onChange={(e) => {
                    setProjectId(e.target.value);
                    set("milestoneId", "");
                    setTemplateId("");
                    setValues({});
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
          {!template && (
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
          )}
          {!template && (
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
          )}
          <Field label="Assignee">{(id) => <AssigneeSelect id={id} projectId={projectId} value={form.assigneeId} onChange={(v) => set("assigneeId", v)} />}</Field>
          {!template && <Field label="Start date">{(id) => <input id={id} type="date" className={field} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />}</Field>}
          <Field label="Due date">{(id) => <input id={id} type="date" className={field} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />}</Field>
          {!template && (
            <Field label="Estimate (hours)">
              {(id) => <input id={id} type="number" min={0} step={0.5} className={field} value={form.estimateHours} onChange={(e) => set("estimateHours", e.target.value)} />}
            </Field>
          )}
          {!template && !!milestones?.length && (
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
        {!!fields?.length && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.id} label={f.name + (f.required ? " *" : "")} hint={f.description ?? undefined}>
                {(id) => <CustomFieldInput id={id} field={f} projectId={projectId} value={values[f.id] ?? null} onCommit={(v) => setValues((cur) => ({ ...cur, [f.id]: v }))} />}
              </Field>
            ))}
          </div>
        )}
        {!template && <LabelPicker value={form.labelIds} onChange={(v) => set("labelIds", v)} />}
      </form>
    </Dialog>
  );
};

export default TaskComposer;
