import type { Priority } from "./parse";

/**
 * The deterministic side of every AI feature. These run when AI is off or fails, and the
 * risk detection always runs (the model only adds wording to it). Pure functions over plain
 * facts, so each rule is unit-testable and explainable.
 */

export type Status = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
export interface TaskFacts {
  id: number;
  key: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  /** YYYY-MM-DD */
  dueDate: string | null;
  assignee: { id: number; name: string } | null;
  estimateHours: number | null;
  /** YYYY-MM-DD of the last change */
  updatedDay: string;
  parentId: number | null;
  /** Open tasks this one waits on */
  openBlockers: number;
  /** Ids of open tasks this one is waiting on that are themselves overdue */
  overdueBlockerKeys: string[];
  /** Open tasks waiting on this one */
  blocksOpen: number;
}

const DAY = 86_400_000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const open = (t: TaskFacts) => t.status !== "DONE";

// ─── Breakdown ───────────────────────────────────────────────────────────────

const BREAKDOWN_TEMPLATES: { match: RegExp; steps: string[] }[] = [
  { match: /\b(bug|fix|error|crash|broken|issue|regression|fails?)\b/i, steps: ["Reproduce the problem and write down the steps", "Find the root cause", "Fix it and add a test that covers it", "Verify the fix where it was reported"] },
  { match: /\b(design|mockup|ui|ux|layout|page|screen|logo)\b/i, steps: ["Collect requirements and examples", "Sketch options", "Review the options with stakeholders", "Finalize and hand off"] },
  { match: /\b(write|draft|blog|post|article|docs?|documentation|copy|report)\b/i, steps: ["Outline the key points", "Write the first draft", "Get feedback", "Revise and publish"] },
  { match: /\b(launch|release|ship|deploy|rollout)\b/i, steps: ["Confirm scope and the release checklist", "Prepare the release", "Test in staging", "Release and monitor", "Announce it"] },
  { match: /\b(meeting|workshop|offsite|event|call|interview)\b/i, steps: ["Pick a date and invite people", "Prepare the agenda and materials", "Run it", "Send notes and follow-ups"] },
  { match: /\b(research|investigate|evaluate|compare|spike|analy[sz]e)\b/i, steps: ["Define the questions to answer", "Gather information", "Compare the options", "Write up a recommendation"] },
];
const GENERIC_STEPS = ["Clarify the goal and what “done” means", "Do the main work", "Review the result", "Wrap up and tell the people involved"];

/**
 * Steps from the description when it already lists them (bullets or numbered lines),
 * otherwise a template matched on the title. Existing subtasks are never proposed again.
 */
export const breakdownRules = (title: string, description: string | null, existing: string[]) => {
  const have = new Set(existing.map((s) => s.trim().toLowerCase()));
  const listed = (description ?? "")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(?:[-*•]|\d+[.)]|\[ \])\s+(.+)$/)?.[1]?.trim())
    .filter((l): l is string => Boolean(l && l.length >= 3));
  const template = BREAKDOWN_TEMPLATES.find((t) => t.match.test(title))?.steps ?? GENERIC_STEPS;
  const steps = listed.length >= 2 ? listed : template;
  return {
    basis: listed.length >= 2 ? ("description" as const) : ("template" as const),
    subtasks: steps
      .map((s) => s.slice(0, 200))
      .filter((s) => !have.has(s.toLowerCase()))
      .slice(0, 8)
      .map((title) => ({ title, estimateHours: null as number | null })),
  };
};

// ─── Prioritisation ──────────────────────────────────────────────────────────

export interface PrioritySuggestion {
  taskId: number;
  suggested: Priority;
  reason: string;
}

/** Explainable nudges: overdue, due very soon, blocking others, or high priority that's gone stale. */
export const prioritizeRules = (tasks: TaskFacts[], today: string): PrioritySuggestion[] => {
  const out: (PrioritySuggestion & { score: number })[] = [];
  for (const t of tasks.filter(open)) {
    const due = t.dueDate ? daysBetween(today, t.dueDate) : null;
    let suggested: Priority | null = null;
    let reason = "";
    let score = 0;
    if (due !== null && due < 0) {
      suggested = t.blocksOpen > 0 ? "CRITICAL" : "HIGH";
      reason = `Overdue by ${plural(-due, "day")}${t.blocksOpen ? ` and blocks ${plural(t.blocksOpen, "open task")}` : ""}`;
      score = 100 - due + t.blocksOpen * 5;
    } else if (due !== null && due <= 2) {
      suggested = "HIGH";
      reason = due === 0 ? "Due today" : `Due in ${plural(due, "day")}`;
      score = 80 - due;
    } else if (t.blocksOpen >= 2) {
      suggested = "HIGH";
      reason = `Blocks ${plural(t.blocksOpen, "open task")}`;
      score = 60 + t.blocksOpen;
    } else if (RANK[t.priority] <= RANK.HIGH && due === null && t.status === "TODO" && t.blocksOpen === 0 && daysBetween(t.updatedDay, today) >= 30) {
      suggested = "MEDIUM";
      reason = `Marked ${t.priority.toLowerCase()} but untouched for ${plural(daysBetween(t.updatedDay, today), "day")}, with no due date`;
      score = 20;
    }
    // Only ever raise urgent work; only lower in the stale case above
    if (!suggested || suggested === t.priority) continue;
    if (suggested !== "MEDIUM" && RANK[suggested] >= RANK[t.priority]) continue;
    out.push({ taskId: t.id, suggested, reason, score });
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ score: _s, ...s }) => s);
};

// ─── Risks and workload ──────────────────────────────────────────────────────

export type RiskKind = "overdue" | "blocked_by_overdue" | "critical_unassigned" | "due_soon_unassigned" | "overloaded" | "stale";
export interface Risk {
  kind: RiskKind;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  taskIds: number[];
  userId?: number;
}
export interface Workload {
  user: { id: number; name: string } | null;
  open: number;
  overdue: number;
  dueNext7: number;
  hoursNext7: number;
  unestimatedNext7: number;
}

export const OVERLOAD_HOURS_7D = 40;
export const OVERLOAD_TASKS_7D = 10;
export const STALE_DAYS = 14;

export const workloadRules = (tasks: TaskFacts[], today: string): Workload[] => {
  const by = new Map<string, Workload>();
  for (const t of tasks.filter(open)) {
    const k = t.assignee ? String(t.assignee.id) : "none";
    const w = by.get(k) ?? { user: t.assignee, open: 0, overdue: 0, dueNext7: 0, hoursNext7: 0, unestimatedNext7: 0 };
    w.open++;
    const due = t.dueDate ? daysBetween(today, t.dueDate) : null;
    if (due !== null && due < 0) w.overdue++;
    if (due !== null && due <= 7) {
      // Overdue work is still on the plate this week
      w.dueNext7++;
      if (t.estimateHours) w.hoursNext7 += t.estimateHours;
      else w.unestimatedNext7++;
    }
    by.set(k, w);
  }
  return [...by.values()].sort((a, b) => b.hoursNext7 - a.hoursNext7 || b.dueNext7 - a.dueNext7 || b.open - a.open);
};

export const riskRules = (tasks: TaskFacts[], today: string): Risk[] => {
  const live = tasks.filter(open);
  const due = (t: TaskFacts) => (t.dueDate ? daysBetween(today, t.dueDate) : null);
  const byUrgency = (a: TaskFacts, b: TaskFacts) => (due(a) ?? 9999) - (due(b) ?? 9999) || RANK[a.priority] - RANK[b.priority];
  const ids = (ts: TaskFacts[]) => ts.sort(byUrgency).slice(0, 20).map((t) => t.id);
  const risks: Risk[] = [];

  const overdue = live.filter((t) => (due(t) ?? 0) < 0);
  if (overdue.length) {
    const worst = Math.max(...overdue.map((t) => -(due(t) ?? 0)));
    risks.push({ kind: "overdue", severity: overdue.length >= 5 || worst >= 7 ? "high" : "medium", title: `${plural(overdue.length, "task")} overdue`, detail: `The oldest is ${plural(worst, "day")} late.`, taskIds: ids(overdue) });
  }
  const blocked = live.filter((t) => t.overdueBlockerKeys.length);
  if (blocked.length) {
    risks.push({ kind: "blocked_by_overdue", severity: "high", title: `${plural(blocked.length, "task")} waiting on overdue work`, detail: `Blocked by ${[...new Set(blocked.flatMap((t) => t.overdueBlockerKeys))].slice(0, 5).join(", ")}.`, taskIds: ids(blocked) });
  }
  const critical = live.filter((t) => !t.assignee && RANK[t.priority] <= RANK.HIGH);
  if (critical.length) {
    risks.push({ kind: "critical_unassigned", severity: critical.some((t) => t.priority === "CRITICAL") ? "high" : "medium", title: `${plural(critical.length, "high-priority task")} with no owner`, detail: "Nobody is assigned to these critical or high-priority tasks.", taskIds: ids(critical) });
  }
  const soon = live.filter((t) => !t.assignee && due(t) !== null && due(t)! >= 0 && due(t)! <= 3 && RANK[t.priority] > RANK.HIGH);
  if (soon.length) risks.push({ kind: "due_soon_unassigned", severity: "medium", title: `${plural(soon.length, "task")} due within 3 days with no owner`, detail: "Assign these before they slip.", taskIds: ids(soon) });

  for (const w of workloadRules(tasks, today)) {
    if (!w.user) continue;
    if (w.hoursNext7 > OVERLOAD_HOURS_7D || w.dueNext7 > OVERLOAD_TASKS_7D) {
      const mine = live.filter((t) => t.assignee?.id === w.user!.id && due(t) !== null && due(t)! <= 7);
      risks.push({
        kind: "overloaded",
        severity: w.hoursNext7 > OVERLOAD_HOURS_7D * 1.5 || w.dueNext7 > OVERLOAD_TASKS_7D * 1.5 ? "high" : "medium",
        title: `${w.user.name} may be overloaded`,
        detail: `${plural(w.dueNext7, "task")} due within 7 days${w.hoursNext7 ? ` (${Math.round(w.hoursNext7)} estimated hours${w.unestimatedNext7 ? `, ${w.unestimatedNext7} without an estimate` : ""})` : ""}.`,
        taskIds: ids(mine),
        userId: w.user.id,
      });
    }
  }
  const stale = live.filter((t) => (t.status === "IN_PROGRESS" || t.status === "IN_REVIEW") && daysBetween(t.updatedDay, today) >= STALE_DAYS);
  if (stale.length) risks.push({ kind: "stale", severity: "low", title: `${plural(stale.length, "task")} in progress but untouched for ${STALE_DAYS}+ days`, detail: "These may be stuck or finished without being closed.", taskIds: ids(stale) });

  const order = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => order[a.severity] - order[b.severity]);
};

/** A plain-words paragraph from the detected risks, used when there is no model to write one. */
export const riskNarrativeRules = (risks: Risk[], openCount: number) => {
  if (!openCount) return "There are no open tasks.";
  if (!risks.length) return `No risks found across ${plural(openCount, "open task")}.`;
  const high = risks.filter((r) => r.severity === "high");
  const lead = high.length ? `${plural(high.length, "serious risk")} need${high.length === 1 ? "s" : ""} attention` : "Nothing serious, but a few things to watch";
  return `${lead}: ${risks.slice(0, 3).map((r) => r.title.charAt(0).toLowerCase() + r.title.slice(1)).join("; ")}.`;
};

// ─── Summaries ───────────────────────────────────────────────────────────────

const STATUS_WORDS: Record<Status, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done" };

export interface TaskSummaryInput {
  task: TaskFacts;
  checklist: { done: number; total: number };
  subtasks: { done: number; total: number };
  comments: { author: string; excerpt: string; day: string }[];
  recentChanges: string[];
}

export const taskSummaryRules = (i: TaskSummaryInput, today: string) => {
  const t = i.task;
  const parts: string[] = [];
  const due = t.dueDate ? daysBetween(today, t.dueDate) : null;
  parts.push(
    `${STATUS_WORDS[t.status]}, ${t.priority.toLowerCase()} priority, ${t.assignee ? `assigned to ${t.assignee.name}` : "unassigned"}` +
      (due === null ? ", no due date." : t.status === "DONE" ? "." : due < 0 ? `, overdue by ${plural(-due, "day")}.` : due === 0 ? ", due today." : `, due in ${plural(due, "day")}.`)
  );
  const highlights: string[] = [];
  if (t.openBlockers) highlights.push(`Waiting on ${plural(t.openBlockers, "open task")}`);
  if (t.blocksOpen) highlights.push(`Blocks ${plural(t.blocksOpen, "open task")}`);
  if (i.checklist.total) highlights.push(`Checklist ${i.checklist.done}/${i.checklist.total} done`);
  if (i.subtasks.total) highlights.push(`Subtasks ${i.subtasks.done}/${i.subtasks.total} done`);
  if (i.comments.length) {
    const last = i.comments[i.comments.length - 1];
    highlights.push(`${plural(i.comments.length, "comment")}; latest from ${last.author} (${last.day}): “${last.excerpt}”`);
  }
  if (i.recentChanges.length) highlights.push(`Recent changes: ${i.recentChanges.slice(-3).join("; ")}`);
  return { summary: parts.join(" "), highlights };
};

export const projectSummaryRules = (name: string, tasks: TaskFacts[], completedLast7: number, today: string) => {
  const live = tasks.filter(open);
  const done = tasks.length - live.length;
  const overdue = live.filter((t) => t.dueDate && daysBetween(today, t.dueDate) < 0).length;
  const dueWeek = live.filter((t) => t.dueDate && daysBetween(today, t.dueDate) >= 0 && daysBetween(today, t.dueDate) <= 7).length;
  const blocked = live.filter((t) => t.openBlockers).length;
  const inProgress = live.filter((t) => t.status === "IN_PROGRESS" || t.status === "IN_REVIEW").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return {
    summary: `${name}: ${done} of ${plural(tasks.length, "task")} done (${pct}%). ${completedLast7} completed in the last 7 days; ${inProgress} in progress; ${dueWeek} due in the next 7 days.`,
    highlights: [overdue ? `${plural(overdue, "task")} overdue` : "Nothing overdue", blocked ? `${plural(blocked, "task")} blocked` : "Nothing blocked"],
  };
};

// ─── Assistant (offline) ─────────────────────────────────────────────────────

export const OFFLINE_HELP = [
  "What's overdue?",
  "What's due this week?",
  "What should I work on next?",
  "What's blocked?",
  "Who is overloaded?",
];

/** Answers a few common questions from the data, by keyword. Anything else gets the list of what works offline. */
export const assistantRules = (message: string, tasks: TaskFacts[], meId: number, today: string): { answer: string; taskIds: number[] } => {
  const q = message.toLowerCase();
  const live = tasks.filter(open);
  const due = (t: TaskFacts) => (t.dueDate ? daysBetween(today, t.dueDate) : null);
  const mineOnly = /\b(my|mine|me|i)\b/.test(q);
  const scope = (ts: TaskFacts[]) => (mineOnly ? ts.filter((t) => t.assignee?.id === meId) : ts);
  const list = (ts: TaskFacts[], empty: string, lead: string) =>
    ts.length ? { answer: `${lead} (${ts.length}):\n${ts.slice(0, 10).map((t) => `• ${t.key} ${t.title}${t.dueDate ? ` — due ${t.dueDate}` : ""}`).join("\n")}${ts.length > 10 ? `\n…and ${ts.length - 10} more.` : ""}`, taskIds: ts.slice(0, 10).map((t) => t.id) } : { answer: empty, taskIds: [] };
  const urgent = (a: TaskFacts, b: TaskFacts) => (due(a) ?? 9999) - (due(b) ?? 9999) || RANK[a.priority] - RANK[b.priority];

  if (/overdue|late|behind/.test(q)) return list(scope(live.filter((t) => (due(t) ?? 0) < 0)).sort(urgent), mineOnly ? "Nothing of yours is overdue." : "Nothing is overdue.", "Overdue");
  if (/\btoday\b/.test(q)) return list(scope(live.filter((t) => due(t) === 0)).sort(urgent), "Nothing is due today.", "Due today");
  if (/tomorrow/.test(q)) return list(scope(live.filter((t) => due(t) === 1)).sort(urgent), "Nothing is due tomorrow.", "Due tomorrow");
  if (/this week|next 7|coming up|upcoming|due soon/.test(q)) return list(scope(live.filter((t) => due(t) !== null && due(t)! >= 0 && due(t)! <= 7)).sort(urgent), "Nothing is due in the next 7 days.", "Due in the next 7 days");
  if (/block/.test(q)) return list(scope(live.filter((t) => t.openBlockers)).sort(urgent), "Nothing is blocked.", "Blocked");
  if (/overload|workload|capacity|busy|too much/.test(q)) {
    const w = workloadRules(tasks, today).filter((x) => x.user);
    if (!w.length) return { answer: "Nobody has open assigned work.", taskIds: [] };
    return { answer: `Work due in the next 7 days:\n${w.slice(0, 8).map((x) => `• ${x.user!.name}: ${plural(x.dueNext7, "task")}${x.hoursNext7 ? `, ${Math.round(x.hoursNext7)}h estimated` : ""}${x.overdue ? `, ${x.overdue} overdue` : ""}`).join("\n")}`, taskIds: [] };
  }
  if (/work on|next|focus|priorit|should i/.test(q)) {
    const mine = live.filter((t) => t.assignee?.id === meId && !t.openBlockers).sort(urgent);
    return list(mine, "You have no open, unblocked tasks assigned to you.", "Your most urgent unblocked tasks");
  }
  if (/my tasks|assigned to me|what am i/.test(q)) return list(live.filter((t) => t.assignee?.id === meId).sort(urgent), "You have no open tasks.", "Your open tasks");
  return { answer: `AI isn't available right now, so I can only answer a few questions from your data. Try:\n${OFFLINE_HELP.map((h) => `• ${h}`).join("\n")}`, taskIds: [] };
};
