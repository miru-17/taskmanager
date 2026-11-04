import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import api from "../../services/api";
import { useLabels, useProjectAction } from "../../data/queries";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type AutomationAction, type AutomationCondition, type AutomationRule, type AutomationTrigger, type Priority, type TaskStatus, type TriggerConfig } from "../../types/Task";
import { Button, Dialog, Field, IconButton, field, fieldBase, textarea } from "../../ui";
import { useAssignable } from "../tasks/useAssignable";
import { ACTION_LABELS, CONDITION_FIELDS, TRIGGER_LABELS, describeRule } from "./wording";
import { useNames } from "./useNames";

export interface Draft {
  name: string;
  trigger: AutomationTrigger;
  triggerConfig: TriggerConfig;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}

const MAX = 10;

const defaultCondition = (f: AutomationCondition["field"], people: { id: number }[], labels: { id: string }[]): AutomationCondition | null => {
  switch (f) {
    case "status":
      return { field: "status", op: "is", value: ["TODO"] };
    case "priority":
      return { field: "priority", op: "is", value: ["HIGH"] };
    case "assignee":
      return { field: "assignee", op: "is_not_set" };
    case "assignee_is":
      return people[0] ? { field: "assignee_is", value: people[0].id } : null;
    case "label":
      return labels[0] ? { field: "label", op: "has", value: labels[0].id } : null;
    case "title":
      return { field: "title", op: "contains", value: "" };
    case "dueDate":
      return { field: "dueDate", op: "is_not_set" };
    case "subtask":
      return { field: "subtask", op: "is_not" };
  }
};

const defaultAction = (t: AutomationAction["type"], labels: { id: string }[]): AutomationAction | null => {
  switch (t) {
    case "SET_STATUS":
      return { type: "SET_STATUS", status: "IN_PROGRESS" };
    case "SET_PRIORITY":
      return { type: "SET_PRIORITY", priority: "HIGH" };
    case "ASSIGN":
      return { type: "ASSIGN", to: "creator" };
    case "SET_DUE_DATE":
      return { type: "SET_DUE_DATE", daysFromNow: 3 };
    case "ADD_LABEL":
      return labels[0] ? { type: "ADD_LABEL", labelId: labels[0].id } : null;
    case "REMOVE_LABEL":
      return labels[0] ? { type: "REMOVE_LABEL", labelId: labels[0].id } : null;
    case "ADD_COMMENT":
      return { type: "ADD_COMMENT", body: "" };
    case "NOTIFY":
      return { type: "NOTIFY", to: "assignee", message: "" };
  }
};

/** Client-side checks that mirror the server's, so Save is only offered for a rule that can save. */
export const draftProblems = (d: Draft): string[] => {
  const p: string[] = [];
  if (!d.name.trim()) p.push("Give the rule a name");
  if (d.trigger === "DUE_SOON" && (d.triggerConfig.days === undefined || d.triggerConfig.days < 0 || d.triggerConfig.days > 30)) p.push("Days before the due date must be 0–30");
  if (d.trigger === "STATUS_CHANGED" && d.triggerConfig.from && d.triggerConfig.from === d.triggerConfig.to) p.push("“From” and “to” must differ");
  if (!d.actions.length) p.push("Add at least one action");
  for (const c of d.conditions) {
    if (c.field === "title" && !c.value.trim()) p.push("Fill in the title text to look for");
    if ((c.field === "status" || c.field === "priority") && !c.value.length) p.push(`Pick at least one ${c.field}`);
  }
  for (const a of d.actions) {
    if (a.type === "ADD_COMMENT" && !a.body.trim()) p.push("Write the comment text");
    if (a.type === "NOTIFY" && !a.message.trim()) p.push("Write the notification message");
  }
  for (const t of ["SET_STATUS", "SET_PRIORITY", "ASSIGN", "SET_DUE_DATE"] as const) {
    if (d.actions.filter((a) => a.type === t).length > 1) p.push(`“${ACTION_LABELS[t]}” can be used only once`);
  }
  return [...new Set(p)];
};

const Chips = <T extends string>({ all, value, labels, onChange, label }: { all: readonly T[]; value: T[]; labels: Record<T, string>; onChange: (v: T[]) => void; label: string }) => (
  <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
    {all.map((v) => {
      const on = value.includes(v);
      return (
        <button
          key={v}
          type="button"
          aria-pressed={on}
          onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
          className={`rounded-md border px-2 py-1 text-xs ${on ? "border-accent bg-accent/10 text-fg" : "border-line text-muted hover:text-fg"}`}
        >
          {labels[v]}
        </button>
      );
    })}
  </div>
);

const Row = ({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) => (
  <li className="flex items-start gap-2 rounded-lg border border-line bg-elev/40 p-2">
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    <IconButton label={label} onClick={onRemove}>
      <Trash2 className="size-4" />
    </IconButton>
  </li>
);

export const RuleBuilder = ({ projectId, open, onClose, editing, initial }: { projectId: string; open: boolean; onClose: () => void; editing: AutomationRule | null; initial?: Draft }) => {
  const people = useAssignable(projectId);
  const { data: labels = [] } = useLabels();
  const names = useNames(projectId);
  const [d, setD] = useState<Draft>(
    () =>
      initial ??
      (editing
        ? { name: editing.name, trigger: editing.trigger, triggerConfig: editing.triggerConfig ?? {}, conditions: editing.conditions, actions: editing.actions }
        : { name: "", trigger: "TASK_CREATED", triggerConfig: {}, conditions: [], actions: [] })
  );
  const [showErrors, setShowErrors] = useState(false);
  const problems = draftProblems(d);
  const preview = useMemo(() => (d.actions.length ? describeRule(d, names) : null), [d, names]);

  const save = useProjectAction(() => {
    const body = { name: d.name.trim(), trigger: d.trigger, triggerConfig: d.triggerConfig, conditions: d.conditions, actions: d.actions };
    return editing ? api.patch(`/automations/${editing.id}`, body) : api.post(`/projects/${projectId}/automations`, body);
  }, "Could not save the automation");

  const setCond = (i: number, c: AutomationCondition) => setD({ ...d, conditions: d.conditions.map((x, j) => (j === i ? c : x)) });
  const setAct = (i: number, a: AutomationAction) => setD({ ...d, actions: d.actions.map((x, j) => (j === i ? a : x)) });
  const setTrigger = (trigger: AutomationTrigger) => setD({ ...d, trigger, triggerConfig: trigger === "DUE_SOON" ? { days: 1 } : {} });

  const personSelect = (value: number, onChange: (id: number) => void, label: string) => (
    <select aria-label={label} className={`${fieldBase} w-48`} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {!people.some((p) => p.id === value) && <option value={value}>{names.person(value)}</option>}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name || p.email}
        </option>
      ))}
    </select>
  );
  const labelSelect = (value: string, onChange: (id: string) => void, label: string) => (
    <select aria-label={label} className={`${fieldBase} w-44`} value={value} onChange={(e) => onChange(e.target.value)}>
      {labels.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit “${editing.name}”` : "New automation"}
      width="max-w-2xl"
      footer={
        <>
          {showErrors && problems.length > 0 && (
            <p className="mr-auto self-center text-xs text-danger" role="alert">
              {problems[0]}
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              if (problems.length) return setShowErrors(true);
              save.mutate(undefined, { onSuccess: () => (toast.success(editing ? "Automation updated" : "Automation created"), onClose()) });
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name">{(id) => <input id={id} data-autofocus className={field} maxLength={100} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Escalate critical bugs" />}</Field>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold tracking-wide text-muted uppercase">When</legend>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Trigger" className={`${fieldBase} w-56`} value={d.trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}>
              {(Object.keys(TRIGGER_LABELS) as AutomationTrigger[]).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABELS[t]}
                </option>
              ))}
            </select>
            {d.trigger === "STATUS_CHANGED" && (
              <>
                <select aria-label="From status" className={`${fieldBase} w-36`} value={d.triggerConfig.from ?? ""} onChange={(e) => setD({ ...d, triggerConfig: { ...d.triggerConfig, from: (e.target.value || undefined) as TaskStatus | undefined } })}>
                  <option value="">from any</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      from {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <select aria-label="To status" className={`${fieldBase} w-36`} value={d.triggerConfig.to ?? ""} onChange={(e) => setD({ ...d, triggerConfig: { ...d.triggerConfig, to: (e.target.value || undefined) as TaskStatus | undefined } })}>
                  <option value="">to any</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      to {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </>
            )}
            {d.trigger === "PRIORITY_CHANGED" && (
              <select aria-label="To priority" className={`${fieldBase} w-36`} value={d.triggerConfig.to ?? ""} onChange={(e) => setD({ ...d, triggerConfig: e.target.value ? { to: e.target.value as Priority } : {} })}>
                <option value="">to any</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    to {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            )}
            {d.trigger === "DUE_SOON" && (
              <label className="flex items-center gap-2 text-sm text-fg-soft">
                <input aria-label="Days before the due date" type="number" min={0} max={30} className={`${fieldBase} w-20`} value={d.triggerConfig.days ?? ""} onChange={(e) => setD({ ...d, triggerConfig: { days: e.target.value === "" ? undefined : Number(e.target.value) } })} />
                days before
              </label>
            )}
          </div>
          {(d.trigger === "DUE_SOON" || d.trigger === "OVERDUE") && <p className="text-xs text-muted">Checked every hour. Each task fires once per due date; done tasks are ignored.</p>}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Only if (all must be true)</legend>
          {d.conditions.length === 0 && <p className="text-sm text-muted">Every matching task. Add a condition to narrow it down.</p>}
          <ul className="space-y-2">
            {d.conditions.map((c, i) => (
              <Row key={i} label={`Remove condition ${i + 1}`} onRemove={() => setD({ ...d, conditions: d.conditions.filter((_, j) => j !== i) })}>
                <span className="text-sm font-medium">{CONDITION_FIELDS.find((f) => f.value === c.field)?.label}</span>
                {(c.field === "status" || c.field === "priority") && (
                  <>
                    <select aria-label="Comparison" className={`${fieldBase} w-24`} value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as "is" | "is_not" } as AutomationCondition)}>
                      <option value="is">is</option>
                      <option value="is_not">is not</option>
                    </select>
                    {c.field === "status" ? (
                      <Chips label="Statuses" all={STATUSES} labels={STATUS_LABELS} value={c.value} onChange={(value) => setCond(i, { ...c, value })} />
                    ) : (
                      <Chips label="Priorities" all={PRIORITIES} labels={PRIORITY_LABELS} value={c.value} onChange={(value) => setCond(i, { ...c, value })} />
                    )}
                  </>
                )}
                {(c.field === "assignee" || c.field === "dueDate") && (
                  <select aria-label="Comparison" className={`${fieldBase} w-36`} value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as "is_set" | "is_not_set" })}>
                    <option value="is_set">is set</option>
                    <option value="is_not_set">is empty</option>
                  </select>
                )}
                {c.field === "assignee_is" && personSelect(c.value, (value) => setCond(i, { ...c, value }), "Assignee")}
                {c.field === "label" && (
                  <>
                    <select aria-label="Comparison" className={`${fieldBase} w-32`} value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as "has" | "has_not" })}>
                      <option value="has">includes</option>
                      <option value="has_not">doesn't include</option>
                    </select>
                    {labelSelect(c.value, (value) => setCond(i, { ...c, value }), "Label")}
                  </>
                )}
                {c.field === "title" && (
                  <>
                    <span className="text-sm text-muted">contains</span>
                    <input aria-label="Title text" className={`${fieldBase} w-48`} maxLength={100} value={c.value} onChange={(e) => setCond(i, { ...c, value: e.target.value })} />
                  </>
                )}
                {c.field === "subtask" && (
                  <select aria-label="Comparison" className={`${fieldBase} w-40`} value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as "is" | "is_not" })}>
                    <option value="is">is a subtask</option>
                    <option value="is_not">is not a subtask</option>
                  </select>
                )}
              </Row>
            ))}
          </ul>
          {d.conditions.length < MAX && (
            <select
              aria-label="Add a condition"
              className={`${fieldBase} w-48`}
              value=""
              onChange={(e) => {
                const c = defaultCondition(e.target.value as AutomationCondition["field"], people, labels);
                if (c) setD({ ...d, conditions: [...d.conditions, c] });
                else toast.error(e.target.value === "label" ? "Create a label first" : "There's nobody to pick yet");
              }}
            >
              <option value="">+ Add a condition…</option>
              {CONDITION_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Then (in order)</legend>
          <ul className="space-y-2">
            {d.actions.map((a, i) => (
              <Row key={i} label={`Remove action ${i + 1}`} onRemove={() => setD({ ...d, actions: d.actions.filter((_, j) => j !== i) })}>
                <span className="text-sm font-medium">{ACTION_LABELS[a.type]}</span>
                {a.type === "SET_STATUS" && (
                  <select aria-label="Status" className={`${fieldBase} w-36`} value={a.status} onChange={(e) => setAct(i, { ...a, status: e.target.value as TaskStatus })}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                )}
                {a.type === "SET_PRIORITY" && (
                  <select aria-label="Priority" className={`${fieldBase} w-36`} value={a.priority} onChange={(e) => setAct(i, { ...a, priority: e.target.value as Priority })}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                )}
                {a.type === "ASSIGN" && (
                  <select
                    aria-label="Assign to"
                    className={`${fieldBase} w-52`}
                    value={String(a.to)}
                    onChange={(e) => setAct(i, { ...a, to: e.target.value === "creator" || e.target.value === "unassigned" ? e.target.value : Number(e.target.value) })}
                  >
                    <option value="creator">the task's creator</option>
                    <option value="unassigned">nobody (unassign)</option>
                    {typeof a.to === "number" && !people.some((p) => p.id === a.to) && <option value={a.to}>{names.person(a.to)}</option>}
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.email}
                      </option>
                    ))}
                  </select>
                )}
                {a.type === "SET_DUE_DATE" && (
                  <label className="flex items-center gap-2 text-sm text-fg-soft">
                    <input aria-label="Days from now" type="number" min={0} max={365} className={`${fieldBase} w-20`} value={a.daysFromNow} onChange={(e) => setAct(i, { ...a, daysFromNow: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
                    days from when it runs
                  </label>
                )}
                {(a.type === "ADD_LABEL" || a.type === "REMOVE_LABEL") && labelSelect(a.labelId, (labelId) => setAct(i, { ...a, labelId }), "Label")}
                {a.type === "ADD_COMMENT" && <textarea aria-label="Comment text" className={`${textarea} min-h-16`} maxLength={2000} value={a.body} onChange={(e) => setAct(i, { ...a, body: e.target.value })} />}
                {a.type === "NOTIFY" && (
                  <div className="flex w-full flex-wrap gap-2">
                    <select
                      aria-label="Notify"
                      className={`${fieldBase} w-52`}
                      value={String(a.to)}
                      onChange={(e) => setAct(i, { ...a, to: ["assignee", "creator", "watchers", "project_managers"].includes(e.target.value) ? (e.target.value as "assignee") : Number(e.target.value) })}
                    >
                      <option value="assignee">the assignee</option>
                      <option value="creator">the creator</option>
                      <option value="watchers">everyone watching</option>
                      <option value="project_managers">project managers</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.email}
                        </option>
                      ))}
                    </select>
                    <input aria-label="Message" className={`${fieldBase} min-w-48 flex-1`} maxLength={500} value={a.message} placeholder="Message" onChange={(e) => setAct(i, { ...a, message: e.target.value })} />
                  </div>
                )}
              </Row>
            ))}
          </ul>
          {d.actions.length < MAX && (
            <select
              aria-label="Add an action"
              className={`${fieldBase} w-48`}
              value=""
              onChange={(e) => {
                const a = defaultAction(e.target.value as AutomationAction["type"], labels);
                if (a) setD({ ...d, actions: [...d.actions, a] });
                else toast.error("Create a label first");
              }}
            >
              <option value="">+ Add an action…</option>
              {(Object.keys(ACTION_LABELS) as AutomationAction["type"][]).map((t) => (
                <option key={t} value={t}>
                  {ACTION_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        {preview && (
          <p className="rounded-lg bg-elev px-3 py-2 text-sm text-fg-soft" aria-live="polite">
            {preview}
          </p>
        )}
        <p className="text-xs text-muted">
          Changes follow the same rules as yours: blocked tasks stay open, approvals are still required. A rule never re-triggers itself, and rules that keep failing switch themselves off.
        </p>
      </div>
    </Dialog>
  );
};
