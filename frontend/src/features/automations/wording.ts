import { PRIORITY_LABELS, STATUS_LABELS, type AutomationAction, type AutomationCondition, type AutomationRule, type AutomationRunStatus, type AutomationTrigger, type Priority, type TaskStatus, type TriggerConfig } from "../../types/Task";

/** Plain-language wording for rules, shared by the list, the builder preview and the run log. */

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  TASK_CREATED: "A task is created",
  STATUS_CHANGED: "The status changes",
  ASSIGNEE_CHANGED: "The assignee changes",
  PRIORITY_CHANGED: "The priority changes",
  COMMENT_ADDED: "Someone comments",
  DUE_SOON: "A due date is coming up",
  OVERDUE: "A task becomes overdue",
};

export const ACTION_LABELS: Record<AutomationAction["type"], string> = {
  SET_STATUS: "Set status",
  SET_PRIORITY: "Set priority",
  ASSIGN: "Assign",
  SET_DUE_DATE: "Set due date",
  ADD_LABEL: "Add label",
  REMOVE_LABEL: "Remove label",
  ADD_COMMENT: "Add a comment",
  NOTIFY: "Send a notification",
};

export const CONDITION_FIELDS: { value: AutomationCondition["field"]; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "assignee", label: "Assignee (any)" },
  { value: "assignee_is", label: "Assignee is…" },
  { value: "label", label: "Label" },
  { value: "title", label: "Title" },
  { value: "dueDate", label: "Due date" },
  { value: "subtask", label: "Subtask" },
];

export const RUN_STATUS: Record<AutomationRunStatus, { label: string; tone: string }> = {
  RUNNING: { label: "Running", tone: "bg-info/12 text-info" },
  SUCCEEDED: { label: "Ran", tone: "bg-success/12 text-success" },
  SKIPPED: { label: "Skipped", tone: "bg-elev text-muted" },
  FAILED: { label: "Failed", tone: "bg-danger/12 text-danger" },
  LOOP_BLOCKED: { label: "Stopped", tone: "bg-warning/12 text-warning" },
};

type Names = { person: (id: number) => string; label: (id: string) => string };

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`);

export const describeTrigger = (trigger: AutomationTrigger, c: TriggerConfig = {}) => {
  switch (trigger) {
    case "STATUS_CHANGED":
      return `When the status changes${c.from ? ` from ${STATUS_LABELS[c.from]}` : ""}${c.to ? ` to ${STATUS_LABELS[c.to as TaskStatus]}` : ""}`;
    case "PRIORITY_CHANGED":
      return `When the priority changes${c.to ? ` to ${PRIORITY_LABELS[c.to as Priority]}` : ""}`;
    case "DUE_SOON":
      return c.days === 0 ? "On the due date" : c.days === 1 ? "1 day before the due date" : `${c.days ?? "?"} days before the due date`;
    case "TASK_CREATED":
      return "When a task is created";
    case "ASSIGNEE_CHANGED":
      return "When the assignee changes";
    case "COMMENT_ADDED":
      return "When someone comments";
    case "OVERDUE":
      return "When a task becomes overdue";
  }
};

export const describeCondition = (c: AutomationCondition, n: Names) => {
  switch (c.field) {
    case "status":
      return `status ${c.op === "is" ? "is" : "is not"} ${list(c.value.map((s) => STATUS_LABELS[s]))}`;
    case "priority":
      return `priority ${c.op === "is" ? "is" : "is not"} ${list(c.value.map((p) => PRIORITY_LABELS[p]))}`;
    case "assignee":
      return c.op === "is_set" ? "someone is assigned" : "nobody is assigned";
    case "assignee_is":
      return `it's assigned to ${n.person(c.value)}`;
    case "label":
      return `it ${c.op === "has" ? "has" : "doesn't have"} the label ${n.label(c.value)}`;
    case "title":
      return `the title contains “${c.value}”`;
    case "dueDate":
      return c.op === "is_set" ? "it has a due date" : "it has no due date";
    case "subtask":
      return c.op === "is" ? "it's a subtask" : "it's not a subtask";
  }
};

const recipient = (to: Extract<AutomationAction, { type: "NOTIFY" }>["to"], n: Names) =>
  typeof to === "number" ? n.person(to) : { assignee: "the assignee", creator: "the creator", watchers: "watchers", project_managers: "project managers" }[to];

export const describeActionText = (a: AutomationAction, n: Names) => {
  switch (a.type) {
    case "SET_STATUS":
      return `move it to ${STATUS_LABELS[a.status]}`;
    case "SET_PRIORITY":
      return `set priority to ${PRIORITY_LABELS[a.priority]}`;
    case "ASSIGN":
      return a.to === "unassigned" ? "unassign it" : a.to === "creator" ? "assign it to its creator" : `assign it to ${n.person(a.to)}`;
    case "SET_DUE_DATE":
      return a.daysFromNow === 0 ? "make it due today" : `make it due in ${a.daysFromNow} day${a.daysFromNow === 1 ? "" : "s"}`;
    case "ADD_LABEL":
      return `add the label ${n.label(a.labelId)}`;
    case "REMOVE_LABEL":
      return `remove the label ${n.label(a.labelId)}`;
    case "ADD_COMMENT":
      return `comment “${a.body.length > 60 ? `${a.body.slice(0, 57)}…` : a.body}”`;
    case "NOTIFY":
      return `notify ${recipient(a.to, n)}`;
  }
};

/** "When the status changes to Done, if priority is High, notify watchers and add the label shipped." */
export const describeRule = (r: Pick<AutomationRule, "trigger" | "triggerConfig" | "conditions" | "actions">, n: Names) => {
  const when = describeTrigger(r.trigger, r.triggerConfig);
  const conds = r.conditions.map((c) => describeCondition(c, n));
  const acts = r.actions.map((a) => describeActionText(a, n));
  const and = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  return `${when}${conds.length ? `, if ${and(conds)}` : ""}: ${and(acts)}.`;
};

/** One line for a run in the log. */
export const describeRun = (status: AutomationRunStatus, d: { actions?: string[]; error?: string; reason?: string; failedCondition?: number; condition?: AutomationCondition; runsLastMinute?: number } | null, n: Names) => {
  if (status === "RUNNING") return "Running now";
  if (status === "SUCCEEDED") return d?.actions?.join(" · ") ?? "Ran";
  if (status === "FAILED") return d?.error ?? "Failed";
  if (status === "LOOP_BLOCKED") {
    if (d?.reason === "rate_limit") return `Ran too often (${d.runsLastMinute ?? "many"} times in a minute); the rule was switched off`;
    if (d?.reason === "depth") return "Stopped: too many automations triggered each other in a row";
    return "Stopped a loop: this rule's own change came back around to it";
  }
  if (d?.reason === "conditions" && d.condition) return `Skipped: not true that ${describeCondition(d.condition, n)}`;
  if (d?.reason === "task_unavailable") return "Skipped: the task was deleted, archived or moved";
  return "Skipped";
};
