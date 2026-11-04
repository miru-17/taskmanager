import { PRIORITY_LABELS, STATUS_LABELS, type Activity, type Priority, type TaskStatus } from "../../types/Task";

// ─── Activity wording ────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  assigneeId: "assignee",
  parentId: "parent task",
  milestoneId: "milestone",
  startDate: "start date",
  dueDate: "due date",
  estimateHours: "estimate",
  actualHours: "time spent",
  labels: "labels",
};

const show = (field: string, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "none";
  if (field === "status") return STATUS_LABELS[v as TaskStatus] ?? String(v);
  if (field === "priority") return PRIORITY_LABELS[v as Priority] ?? String(v);
  if (field.endsWith("Date")) return String(v).slice(0, 10);
  if (field === "estimateHours" || field === "actualHours") return `${v}h`;
  return String(v);
};

/** Fields whose raw values are ids or long text: say *that* they changed, not the values. */
const OPAQUE = new Set(["assigneeId", "parentId", "milestoneId", "labels", "description"]);

export const describe = (a: Pick<Activity, "type" | "changes">): string[] => {
  const c = (a.changes ?? {}) as Record<string, unknown>;
  switch (a.type) {
    case "created":
      return ["created this task"];
    case "updated":
      return Object.entries(c).filter(([f]) => !f.startsWith("_")).map(([f, v]) => {
        const { from, to } = v as { from: unknown; to: unknown };
        const name = FIELD_LABELS[f] ?? f;
        // Custom field values are option/user ids or free text: name the field, not the raw value
        if (f.startsWith("field:")) return `changed ${f.slice(6)}`;
        return OPAQUE.has(f) ? `changed the ${name}` : `changed ${name} from ${show(f, from)} to ${show(f, to)}`;
      });
    case "archived":
      return ["archived this task"];
    case "unarchived":
      return ["restored this task from the archive"];
    case "deleted":
      return ["deleted this task"];
    case "dependency_added":
      return [`marked this as blocked by ${String(c.dependsOn ?? "a task")}`];
    case "dependency_removed":
      return ["removed a blocker"];
    case "checklist_added":
      return [`added “${String(c.text)}” to the checklist`];
    case "checklist_checked":
      return [`checked “${String(c.text)}”`];
    case "checklist_unchecked":
      return [`unchecked “${String(c.text)}”`];
    case "checklist_removed":
      return [`removed “${String(c.text)}” from the checklist`];
    case "attachment_added":
      return [`attached ${String(c.fileName)}`];
    case "attachment_removed":
      return [`removed the file ${String(c.fileName)}`];
    case "recurrence_set":
      return [`set this to repeat: ${String(c.rule)}`];
    case "recurrence_stopped":
      return ["stopped this task repeating"];
    case "recurrence_next":
      return [`completed this occurrence; the next one is due ${String(c.dueDate)}`];
    case "approval_requested":
      return [`requested approval${c.note ? `: “${String(c.note)}”` : ""}`];
    case "approval_approved":
      return [`approved${c.comment ? `: “${String(c.comment)}”` : ""}`];
    case "approval_rejected":
      return [`requested changes${c.comment ? `: “${String(c.comment)}”` : ""}`];
    case "approval_cancelled":
      return ["cancelled the approval request"];
    case "approval_waiting_on_blockers":
      return ["approval granted; waiting on blocking tasks before completing"];
    case "automation_ran":
      return [`ran “${String(c.rule)}”`];
    default:
      return [a.type.replace(/_/g, " ")];
  }
};


/** Who to show for a history entry: the person, the automation that made the change, or "Someone" (a removed account). */
export const actorLabel = (a: { actor: { name: string | null; email: string } | null; type?: string; changes?: Record<string, unknown> | null; automation?: string | null }, name: (u: { name: string | null; email: string }) => string) => {
  if (a.actor) return name(a.actor);
  const c = a.changes ?? {};
  if (a.automation || a.type === "automation_ran" || typeof c._automation === "string") return "Automation";
  return "Someone";
};
