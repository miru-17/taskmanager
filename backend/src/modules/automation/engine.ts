import { Prisma, type AutomationRule, type AutomationRunStatus } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { logger } from "../../core/logger";
import { AppError } from "../../core/errors";
import { publishTaskChange } from "../../core/events";
import { enqueue } from "../../core/queue";
import { notify } from "../notifications/notifications.service";
import { sanitizeMentions } from "../comments/comments.service";
import { automationUpdate } from "../tasks/tasks.service";
import { logActivity } from "../tasks/lifecycle";
import { automationContext } from "./context";
import { actionSchema, conditionSchema, triggerConfigFor, type Action, type AutomationEvent, type Condition, type Trigger } from "./definitions";
import { AUTOMATION_JOB } from "./emit";

/** A chain of automation-caused events longer than this is cut off. */
export const MAX_DEPTH = 5;
/** More runs than this in one minute switches a rule off (a runaway, or a loop across tasks). */
export const RATE_LIMIT_PER_MINUTE = 60;
/** This many failures in a row switches a rule off. */
export const FAILURE_LIMIT = 5;

const DAY = 86_400_000;
const startOfUtcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const taskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  assigneeId: true,
  createdById: true,
  parentId: true,
  dueDate: true,
  projectId: true,
  organizationId: true,
  deletedAt: true,
  archivedAt: true,
  labels: { select: { labelId: true } },
} satisfies Prisma.TaskSelect;
type TaskFacts = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

// ─── Matching ────────────────────────────────────────────────────────────────

/** Does this event fit the rule's trigger options (e.g. "status changed to DONE")? */
export const triggerMatches = (rule: Pick<AutomationRule, "trigger" | "triggerConfig">, e: Pick<AutomationEvent, "trigger" | "change">) => {
  if (rule.trigger !== e.trigger) return false;
  const parsed = triggerConfigFor(rule.trigger as Trigger).safeParse(rule.triggerConfig ?? {});
  if (!parsed.success) return false;
  const c = parsed.data as { from?: string; to?: string; days?: number };
  switch (rule.trigger) {
    case "STATUS_CHANGED":
      return (!c.from || e.change?.from === c.from) && (!c.to || e.change?.to === c.to);
    case "PRIORITY_CHANGED":
      return !c.to || e.change?.to === c.to;
    case "DUE_SOON":
      return e.change?.to === c.days;
    default:
      return true;
  }
};

export const conditionHolds = (c: Condition, t: TaskFacts) => {
  switch (c.field) {
    case "status":
      return c.op === "is" ? c.value.includes(t.status) : !c.value.includes(t.status);
    case "priority":
      return c.op === "is" ? c.value.includes(t.priority) : !c.value.includes(t.priority);
    case "assignee":
      return c.op === "is_set" ? t.assigneeId !== null : t.assigneeId === null;
    case "assignee_is":
      return t.assigneeId === c.value;
    case "label": {
      const has = t.labels.some((l) => l.labelId === c.value);
      return c.op === "has" ? has : !has;
    }
    case "title":
      return t.title.toLowerCase().includes(c.value.toLowerCase());
    case "dueDate":
      return c.op === "is_set" ? t.dueDate !== null : t.dueDate === null;
    case "subtask":
      return c.op === "is" ? t.parentId !== null : t.parentId === null;
  }
};

/** Rules are stored as JSON; anything that no longer parses is treated as a failure, not trusted. */
const parseRule = (rule: AutomationRule) => {
  const conditions = conditionSchema.array().safeParse(rule.conditions);
  const actions = actionSchema.array().min(1).safeParse(rule.actions);
  if (!conditions.success || !actions.success) return null;
  return { conditions: conditions.data, actions: actions.data };
};

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Recipients for NOTIFY. notify() itself drops anyone who can't see the task. */
const recipientsFor = async (to: Extract<Action, { type: "NOTIFY" }>["to"], t: TaskFacts) => {
  if (typeof to === "number") return [to];
  if (to === "assignee") return t.assigneeId ? [t.assigneeId] : [];
  if (to === "creator") return t.createdById ? [t.createdById] : [];
  if (to === "watchers") return (await prisma.taskWatcher.findMany({ where: { taskId: t.id }, select: { userId: true } })).map((w) => w.userId);
  const p = await prisma.project.findUnique({ where: { id: t.projectId }, select: { ownerId: true, members: { where: { role: "MANAGER" }, select: { userId: true } } } });
  return [...(p?.ownerId ? [p.ownerId] : []), ...(p?.members.map((m) => m.userId) ?? [])];
};

const STATUS_WORDS: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done" };
const PRIORITY_WORDS: Record<string, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

/** Describes what an action would do, in words the run log and the dry run both show. */
export const describeAction = (a: Action) => {
  switch (a.type) {
    case "SET_STATUS":
      return `Set status to ${STATUS_WORDS[a.status]}`;
    case "SET_PRIORITY":
      return `Set priority to ${PRIORITY_WORDS[a.priority]}`;
    case "ASSIGN":
      return a.to === "unassigned" ? "Unassign" : a.to === "creator" ? "Assign to the creator" : `Assign to user ${a.to}`;
    case "SET_DUE_DATE":
      return a.daysFromNow === 0 ? "Set due date to today" : `Set due date to ${a.daysFromNow} day(s) from now`;
    case "ADD_LABEL":
      return "Add a label";
    case "REMOVE_LABEL":
      return "Remove a label";
    case "ADD_COMMENT":
      return "Add a comment";
    case "NOTIFY":
      return `Notify ${typeof a.to === "number" ? `user ${a.to}` : a.to.replace("_", " ")}`;
  }
};

/**
 * All field changes are applied as ONE update, through the same rules as a person's edit, so
 * either every field action lands or none does. Comments and notifications follow only if it did.
 */
const runActions = async (rule: AutomationRule, actions: Action[], t: TaskFacts) => {
  const input: Record<string, unknown> = {};
  const add: string[] = [];
  const remove: string[] = [];
  for (const a of actions) {
    if (a.type === "SET_STATUS") input.status = a.status;
    else if (a.type === "SET_PRIORITY") input.priority = a.priority;
    else if (a.type === "ASSIGN") {
      if (a.to === "unassigned") input.assigneeId = null;
      else if (a.to === "creator") {
        if (!t.createdById) throw new AppError(400, "NO_CREATOR", "The task's creator no longer exists");
        input.assigneeId = t.createdById;
      } else input.assigneeId = a.to;
    } else if (a.type === "SET_DUE_DATE") input.dueDate = new Date(startOfUtcDay(new Date()) + a.daysFromNow * DAY);
    else if (a.type === "ADD_LABEL") add.push(a.labelId);
    else if (a.type === "REMOVE_LABEL") remove.push(a.labelId);
  }

  let changes: Record<string, unknown> = {};
  if (Object.keys(input).length || add.length || remove.length) {
    changes = await automationUpdate(t.organizationId, t.id, { ...(input as object), addLabelIds: add.length ? add : undefined, removeLabelIds: remove.length ? remove : undefined });
  }

  let comments = 0;
  let notified = 0;
  for (const a of actions) {
    if (a.type === "ADD_COMMENT") {
      // Mentions are re-validated exactly as for a person's comment (only real project members)
      const { body, userIds } = await sanitizeMentions(t.organizationId, t.projectId, a.body);
      const c = await prisma.taskComment.create({ data: { taskId: t.id, authorId: null, automationName: rule.name, body }, select: { id: true } });
      comments++;
      await notify({ orgId: t.organizationId, type: "MENTIONED", actorId: null, taskId: t.id, userIds, data: { excerpt: body.slice(0, 140), commentId: c.id, actorName: `Automation “${rule.name}”` } });
      await publishTaskChange(t.organizationId, [t.id], null, "comment.changed");
    } else if (a.type === "NOTIFY") {
      const r = await notify({ orgId: t.organizationId, type: "AUTOMATION", actorId: null, taskId: t.id, userIds: await recipientsFor(a.to, t), data: { message: a.message, rule: rule.name, actorName: `Automation “${rule.name}”` } });
      notified += r.length;
    }
  }

  await logActivity(prisma, t.id, null, "automation_ran", { rule: rule.name, ruleId: rule.id, actions: actions.map((a) => a.type) });
  await publishTaskChange(t.organizationId, [t.id], null);
  return { changes, comments, notified };
};

// ─── Running one rule for one event ──────────────────────────────────────────

const finish = (runId: string, status: AutomationRunStatus, detail: Prisma.InputJsonValue) =>
  prisma.automationRun.update({ where: { id: runId }, data: { status, detail } });

const switchOff = async (rule: AutomationRule, reason: string) => {
  const res = await prisma.automationRule.updateMany({ where: { id: rule.id, enabled: true }, data: { enabled: false, disabledReason: reason } });
  if (!res.count) return; // someone (or another worker) already switched it off
  logger.warn({ ruleId: rule.id, reason }, "Automation rule switched off");
  if (rule.createdById) {
    // Tell the owner on a task of the project so the notification links somewhere useful
    const anyTask = await prisma.task.findFirst({ where: { projectId: rule.projectId, deletedAt: null }, select: { id: true }, orderBy: { updatedAt: "desc" } });
    if (anyTask) await notify({ orgId: rule.organizationId, type: "AUTOMATION", actorId: null, taskId: anyTask.id, userIds: [rule.createdById], data: { message: `Automation "${rule.name}" was switched off: ${reason}`, rule: rule.name } });
  }
};

export type RunOutcome = { status: AutomationRunStatus | "DUPLICATE" | "NOT_MATCHED"; detail?: unknown };

export const runRule = async (rule: AutomationRule, e: AutomationEvent): Promise<RunOutcome> => {
  if (!triggerMatches(rule, e)) return { status: "NOT_MATCHED" };

  // Idempotency: the (rule, event) pair is unique, so a redelivered or duplicated event stops here.
  // The row is written before any action, which makes delivery at-most-once per rule and event.
  let runId: string;
  try {
    const run = await prisma.automationRun.create({
      data: { ruleId: rule.id, organizationId: rule.organizationId, taskId: e.taskId, eventId: e.eventId, status: "RUNNING", depth: e.depth, detail: {} },
      select: { id: true },
    });
    runId = run.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { status: "DUPLICATE" };
    throw err;
  }

  // Loop guard: a rule never runs again inside a chain it started, and chains are bounded
  if (e.chain.includes(rule.id) || e.depth >= MAX_DEPTH) {
    const detail = { reason: e.chain.includes(rule.id) ? "loop" : "depth", chain: e.chain, depth: e.depth };
    await finish(runId, "LOOP_BLOCKED", detail);
    return { status: "LOOP_BLOCKED", detail };
  }

  const t = await prisma.task.findFirst({ where: { id: e.taskId, organizationId: rule.organizationId }, select: taskSelect });
  if (!t || t.deletedAt || t.archivedAt || t.projectId !== rule.projectId) {
    const detail = { reason: "task_unavailable" };
    await finish(runId, "SKIPPED", detail);
    return { status: "SKIPPED", detail };
  }

  const parsed = parseRule(rule);
  if (!parsed) {
    const detail = { error: "The rule's saved definition is no longer valid" };
    await finish(runId, "FAILED", detail);
    await prisma.automationRule.update({ where: { id: rule.id }, data: { failureStreak: { increment: 1 } } });
    await switchOff(rule, "its definition is invalid");
    return { status: "FAILED", detail };
  }

  const failed = parsed.conditions.findIndex((c) => !conditionHolds(c, t));
  if (failed >= 0) {
    // The condition itself is stored, so the log stays right if the rule is edited later
    const detail = { reason: "conditions", failedCondition: failed, condition: parsed.conditions[failed] } as Prisma.InputJsonValue;
    await finish(runId, "SKIPPED", detail);
    return { status: "SKIPPED", detail };
  }

  // Rate guard: catches runaways the chain can't see (e.g. a rule that keeps firing across many tasks)
  const recent = await prisma.automationRun.count({ where: { ruleId: rule.id, status: { in: ["SUCCEEDED", "FAILED"] }, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  if (recent >= RATE_LIMIT_PER_MINUTE) {
    const detail = { reason: "rate_limit", runsLastMinute: recent };
    await finish(runId, "LOOP_BLOCKED", detail);
    await switchOff(rule, `it ran more than ${RATE_LIMIT_PER_MINUTE} times in a minute`);
    return { status: "LOOP_BLOCKED", detail };
  }

  try {
    const result = await automationContext.run({ depth: e.depth + 1, chain: [...e.chain, rule.id], ruleName: rule.name }, () => runActions(rule, parsed.actions, t));
    const detail = { actions: parsed.actions.map(describeAction), changes: result.changes, comments: result.comments, notified: result.notified } as Prisma.InputJsonValue;
    await finish(runId, "SUCCEEDED", detail);
    await prisma.automationRule.update({ where: { id: rule.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date(), failureStreak: 0 } });
    return { status: "SUCCEEDED", detail };
  } catch (err) {
    // Expected refusals (blocked task, approval needed, person no longer in the project) are shown as-is
    const message = err instanceof AppError ? err.message : "Unexpected error";
    if (!(err instanceof AppError)) logger.error({ err, ruleId: rule.id }, "Automation action failed");
    const detail = { error: message, actions: parsed.actions.map(describeAction) };
    await finish(runId, "FAILED", detail);
    const r = await prisma.automationRule.update({ where: { id: rule.id }, data: { failureStreak: { increment: 1 }, lastRunAt: new Date() }, select: { failureStreak: true } });
    if (r.failureStreak >= FAILURE_LIMIT) await switchOff(rule, `it failed ${FAILURE_LIMIT} times in a row (last error: ${message})`);
    return { status: "FAILED", detail };
  }
};

/** Job handler: every enabled rule of the project for this trigger, oldest first. */
export const processEvent = (data: unknown) =>
  // Run outside any automation context the enqueuing code had; the event carries its own chain
  automationContext.exit(async () => {
    const e = data as AutomationEvent;
    const rules = await prisma.automationRule.findMany({ where: { organizationId: e.orgId, projectId: e.projectId, trigger: e.trigger, enabled: true }, orderBy: { createdAt: "asc" } });
    const out: RunOutcome[] = [];
    for (const rule of rules) {
      try {
        out.push(await runRule(rule, e));
      } catch (err) {
        logger.error({ err, ruleId: rule.id, eventId: e.eventId }, "Automation rule crashed");
      }
    }
    return out;
  });

// ─── Time-based triggers ─────────────────────────────────────────────────────

const OVERDUE_LOOKBACK_DAYS = 7;

/**
 * Hourly: queues DUE_SOON and OVERDUE events. Event ids are derived from the task and its due
 * day, so the same task fires each rule once per due date however often the sweep runs (and a
 * changed due date fires again).
 */
export const runTimeSweep = async (now = new Date()) => {
  const today = startOfUtcDay(now);
  const rules = await prisma.automationRule.findMany({ where: { enabled: true, trigger: { in: ["DUE_SOON", "OVERDUE"] }, project: { status: { not: "ARCHIVED" } } } });
  let queued = 0;
  const base = { status: { not: "DONE" as const }, deletedAt: null, archivedAt: null };

  for (const rule of rules) {
    let tasks: { id: number; dueDate: Date | null }[];
    let eventFor: (t: { id: number; dueDate: Date | null }) => Omit<AutomationEvent, "orgId" | "projectId">;
    if (rule.trigger === "DUE_SOON") {
      const days = Number((rule.triggerConfig as { days?: number })?.days);
      if (!Number.isInteger(days)) continue;
      const start = new Date(today + days * DAY);
      tasks = await prisma.task.findMany({ where: { ...base, projectId: rule.projectId, dueDate: { gte: start, lt: new Date(start.getTime() + DAY) } }, select: { id: true, dueDate: true }, take: 2000 });
      eventFor = (t) => ({ eventId: `due:${t.id}:${t.dueDate!.toISOString().slice(0, 10)}:${days}`, taskId: t.id, trigger: "DUE_SOON", change: { to: days }, actorId: null, depth: 0, chain: [] });
    } else {
      tasks = await prisma.task.findMany({ where: { ...base, projectId: rule.projectId, dueDate: { gte: new Date(today - OVERDUE_LOOKBACK_DAYS * DAY), lt: new Date(today) } }, select: { id: true, dueDate: true }, take: 2000 });
      eventFor = (t) => ({ eventId: `overdue:${t.id}:${t.dueDate!.toISOString().slice(0, 10)}`, taskId: t.id, trigger: "OVERDUE", actorId: null, depth: 0, chain: [] });
    }
    if (!tasks.length) continue;
    const events = tasks.map(eventFor);
    // Skip what this rule has already handled, so the sweep doesn't refill the queue every hour
    const done = new Set((await prisma.automationRun.findMany({ where: { ruleId: rule.id, eventId: { in: events.map((ev) => ev.eventId) } }, select: { eventId: true } })).map((r) => r.eventId));
    for (const ev of events) {
      if (done.has(ev.eventId)) continue;
      await enqueue(AUTOMATION_JOB, { ...ev, orgId: rule.organizationId, projectId: rule.projectId });
      queued++;
    }
  }
  return queued;
};
