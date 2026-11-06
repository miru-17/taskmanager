import type { Request } from "express";
import type { AutomationRule, Prisma } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { badRequest, forbidden, notFound, AppError } from "../../core/errors";
import { audit } from "../../core/audit";
import { resolveProjectAccess, type Actor } from "../../core/access";
import { assertAssignable, assertLabels, findVisible } from "../tasks/tasks.service";
import { ruleBody, ruleUpdateBody, type Action, type Condition, type RuleInput, type Trigger } from "./definitions";
import { conditionHolds, describeAction, triggerMatches } from "./engine";
import { assertCanEnableAutomation } from "../../core/plans";
import type { z } from "zod";

export const MAX_RULES_PER_PROJECT = 50;

/** Rules are visible to anyone working in the project (so "why did my task change?" has an answer), never to clients. */
const assertCanRead = async (actor: Actor, projectId: string) => {
  if (actor.tenant.role === "CLIENT") throw forbidden("Clients can't see automations");
  return resolveProjectAccess(actor, projectId);
};

const assertCanManage = async (actor: Actor, projectId: string) => {
  const caps = await assertCanRead(actor, projectId);
  if (!caps.manage) throw forbidden("Only project managers can change automations");
  return caps;
};

/** References that must exist now: labels in this organization, people who can see this project. */
const assertReferences = async (actor: Actor, projectId: string, conditions: Condition[], actions: Action[]) => {
  const labels = [
    ...conditions.flatMap((c) => (c.field === "label" ? [c.value] : [])),
    ...actions.flatMap((a) => (a.type === "ADD_LABEL" || a.type === "REMOVE_LABEL" ? [a.labelId] : [])),
  ];
  if (labels.length) await assertLabels(actor.tenant.organizationId, labels);
  const people = [
    ...conditions.flatMap((c) => (c.field === "assignee_is" ? [c.value] : [])),
    ...actions.flatMap((a) => ((a.type === "ASSIGN" || a.type === "NOTIFY") && typeof a.to === "number" ? [a.to] : [])),
  ];
  for (const id of new Set(people)) {
    try {
      await assertAssignable(actor, projectId, id);
    } catch (err) {
      // On a rule this is a validation problem, whatever the task-level check calls it
      if (err instanceof AppError) throw badRequest(`User ${id} isn't a member of this organization who can see this project`);
      throw err;
    }
  }

  const statuses = actions.filter((a) => a.type === "SET_STATUS");
  if (statuses.length > 1) throw badRequest("A rule can set the status only once");
  if (actions.filter((a) => a.type === "ASSIGN").length > 1) throw badRequest("A rule can assign only once");
  if (actions.filter((a) => a.type === "SET_PRIORITY").length > 1) throw badRequest("A rule can set the priority only once");
  if (actions.filter((a) => a.type === "SET_DUE_DATE").length > 1) throw badRequest("A rule can set the due date only once");
  const added = new Set(actions.flatMap((a) => (a.type === "ADD_LABEL" ? [a.labelId] : [])));
  if (actions.some((a) => a.type === "REMOVE_LABEL" && added.has(a.labelId))) throw badRequest("A rule can't add and remove the same label");
};

const shape = (r: AutomationRule & { createdBy?: { id: number; name: string | null; email: string } | null }) => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  enabled: r.enabled,
  trigger: r.trigger,
  triggerConfig: r.triggerConfig,
  conditions: r.conditions,
  actions: r.actions,
  createdBy: r.createdBy ?? null,
  runCount: r.runCount,
  lastRunAt: r.lastRunAt,
  failureStreak: r.failureStreak,
  disabledReason: r.disabledReason,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});
const include = { createdBy: { select: { id: true, name: true, email: true } } } as const;

const findRule = async (actor: Actor, id: string) => {
  const r = await prisma.automationRule.findFirst({ where: { id, organizationId: actor.tenant.organizationId }, include });
  if (!r) throw notFound("Automation not found");
  try {
    await assertCanRead(actor, r.projectId);
  } catch (err) {
    // A project the caller can't see behaves as if the rule didn't exist
    if (err instanceof AppError && err.status === 404) throw notFound("Automation not found");
    throw err;
  }
  return r;
};

export const listRules = async (actor: Actor, projectId: string) => {
  const caps = await assertCanRead(actor, projectId);
  const rules = await prisma.automationRule.findMany({ where: { projectId, organizationId: actor.tenant.organizationId }, include, orderBy: { createdAt: "asc" } });
  return { canManage: caps.manage, rules: rules.map(shape) };
};

export const createRule = async (req: Request, actor: Actor, projectId: string, input: RuleInput) => {
  await assertCanManage(actor, projectId);
  if ((await prisma.automationRule.count({ where: { projectId } })) >= MAX_RULES_PER_PROJECT) throw new AppError(409, "TOO_MANY_RULES", `A project can have at most ${MAX_RULES_PER_PROJECT} automations`);
  await assertReferences(actor, projectId, input.conditions, input.actions);
  if (input.enabled) await assertCanEnableAutomation(actor.tenant.organizationId);
  const r = await prisma.automationRule.create({
    data: {
      organizationId: actor.tenant.organizationId,
      projectId,
      name: input.name,
      enabled: input.enabled,
      trigger: input.trigger,
      triggerConfig: input.triggerConfig as Prisma.InputJsonValue,
      conditions: input.conditions as Prisma.InputJsonValue,
      actions: input.actions as Prisma.InputJsonValue,
      createdById: actor.userId,
    },
    include,
  });
  await audit(req, { action: "automation.created", organizationId: actor.tenant.organizationId, targetType: "automation", targetId: r.id, metadata: { projectId, trigger: r.trigger } });
  return shape(r);
};

export const updateRule = async (req: Request, actor: Actor, id: string, input: z.infer<typeof ruleUpdateBody>) => {
  const existing = await findRule(actor, id);
  await assertCanManage(actor, existing.projectId);
  // Validate the merged rule as a whole, so e.g. a trigger change can't leave stale trigger options
  const merged = ruleBody.safeParse({
    name: input.name ?? existing.name,
    enabled: input.enabled ?? existing.enabled,
    trigger: input.trigger ?? existing.trigger,
    triggerConfig: input.triggerConfig ?? (input.trigger && input.trigger !== existing.trigger ? {} : existing.triggerConfig),
    conditions: input.conditions ?? existing.conditions,
    actions: input.actions ?? existing.actions,
  });
  if (!merged.success) throw badRequest(merged.error.issues[0]?.message ?? "Invalid automation");
  const m = merged.data;
  await assertReferences(actor, existing.projectId, m.conditions, m.actions);
  const reenabled = m.enabled && !existing.enabled;
  if (reenabled) await assertCanEnableAutomation(actor.tenant.organizationId);
  const r = await prisma.automationRule.update({
    where: { id },
    data: {
      name: m.name,
      enabled: m.enabled,
      trigger: m.trigger,
      triggerConfig: m.triggerConfig as Prisma.InputJsonValue,
      conditions: m.conditions as Prisma.InputJsonValue,
      actions: m.actions as Prisma.InputJsonValue,
      // Switching a rule back on clears why the system switched it off
      ...(reenabled ? { disabledReason: null, failureStreak: 0 } : {}),
    },
    include,
  });
  await audit(req, { action: "automation.updated", organizationId: actor.tenant.organizationId, targetType: "automation", targetId: id, metadata: { fields: Object.keys(input) } });
  return shape(r);
};

export const deleteRule = async (req: Request, actor: Actor, id: string) => {
  const existing = await findRule(actor, id);
  await assertCanManage(actor, existing.projectId);
  await prisma.automationRule.delete({ where: { id } });
  await audit(req, { action: "automation.deleted", organizationId: actor.tenant.organizationId, targetType: "automation", targetId: id, metadata: { name: existing.name } });
};

export const listRuns = async (actor: Actor, id: string, opts: { limit: number; status?: string }) => {
  const rule = await findRule(actor, id);
  const runs = await prisma.automationRun.findMany({
    where: { ruleId: rule.id, ...(opts.status ? { status: opts.status as never } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit,
    select: { id: true, status: true, depth: true, detail: true, createdAt: true, taskId: true, task: { select: { id: true, number: true, title: true, deletedAt: true, project: { select: { key: true } } } } },
  });
  const counts = await prisma.automationRun.groupBy({ by: ["status"], where: { ruleId: rule.id }, _count: true });
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      depth: r.depth,
      detail: r.detail,
      createdAt: r.createdAt,
      task: r.task && !r.task.deletedAt ? { id: r.task.id, key: `${r.task.project.key}-${r.task.number}`, title: r.task.title } : null,
    })),
  };
};

/**
 * Dry run against one task: which conditions hold and what the actions would do.
 * Nothing is changed and nothing is recorded.
 */
export const testRule = async (actor: Actor, id: string, taskId: number) => {
  const rule = await findRule(actor, id);
  await assertCanManage(actor, rule.projectId);
  const task = await findVisible(actor, taskId);
  if (task.projectId !== rule.projectId) throw badRequest("Pick a task from this rule's project");
  const parsed = ruleBody.safeParse({ ...rule, triggerConfig: rule.triggerConfig, conditions: rule.conditions, actions: rule.actions });
  if (!parsed.success) throw badRequest("This rule's saved definition is invalid; edit and save it again");
  const facts = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { id: true, title: true, status: true, priority: true, assigneeId: true, createdById: true, parentId: true, dueDate: true, projectId: true, organizationId: true, deletedAt: true, archivedAt: true, labels: { select: { labelId: true } } },
  });
  const conditions = parsed.data.conditions.map((c) => ({ condition: c, holds: conditionHolds(c, facts) }));
  const problems: string[] = [];
  try {
    await assertReferences(actor, rule.projectId, parsed.data.conditions, parsed.data.actions);
  } catch (err) {
    problems.push(err instanceof AppError ? err.message : "A reference in this rule is no longer valid");
  }
  if (parsed.data.actions.some((a) => a.type === "ASSIGN" && a.to === "creator") && !facts.createdById) problems.push("This task's creator no longer exists");
  return {
    wouldRun: conditions.every((c) => c.holds) && !problems.length && rule.enabled,
    enabled: rule.enabled,
    conditions,
    actions: parsed.data.actions.map(describeAction),
    problems,
    /** For triggers with options, whether an example event would match (e.g. "to DONE") */
    triggerNote: describeTrigger(rule.trigger as Trigger, rule.triggerConfig as Record<string, unknown>),
  };
};

export const describeTrigger = (trigger: Trigger, c: Record<string, unknown>) => {
  switch (trigger) {
    case "TASK_CREATED":
      return "When a task is created";
    case "STATUS_CHANGED":
      return `When the status changes${c.from ? ` from ${c.from}` : ""}${c.to ? ` to ${c.to}` : ""}`;
    case "ASSIGNEE_CHANGED":
      return "When the assignee changes";
    case "PRIORITY_CHANGED":
      return `When the priority changes${c.to ? ` to ${c.to}` : ""}`;
    case "COMMENT_ADDED":
      return "When someone comments";
    case "DUE_SOON":
      return c.days === 0 ? "On the due date" : `${c.days} day(s) before the due date`;
    case "OVERDUE":
      return "When a task becomes overdue";
  }
};

// re-exported for tests
export { triggerMatches };
