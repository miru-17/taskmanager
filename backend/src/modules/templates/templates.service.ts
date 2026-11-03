import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../core/prisma";
import { badRequest, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import { hasPermission } from "../../core/rbac";
import { cuidSchema } from "../../core/schemas";
import { projectAccessWhere, resolveProjectAccess, type Actor } from "../../core/access";
import { optionalDate } from "../projects/projects.schemas";
import { assertAssignable, assertProjectWritable, findVisible, getTask } from "../tasks/tasks.service";
import { insertTask } from "../tasks/lifecycle";

const priority = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const checklist = z.array(z.string().trim().min(1).max(500)).max(100);
const hours = z.number().min(0).max(10000).nullable().optional();

/** What a template stores. Validated on save *and* re-checked on apply (labels/fields may have changed). */
export const payloadSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(20000).nullable().optional(),
  priority: priority.default("MEDIUM"),
  estimateHours: hours,
  labelIds: z.array(cuidSchema).max(20).default([]),
  checklist: checklist.default([]),
  subtasks: z
    .array(z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(20000).nullable().optional(), priority: priority.default("MEDIUM"), estimateHours: hours, checklist: checklist.default([]) }))
    .max(50)
    .default([]),
  /** Only honoured when the template is applied in its own project (field ids are per project) */
  customFields: z.record(cuidSchema, z.unknown()).default({}),
  /** Due date relative to the day it's applied */
  dueInDays: z.number().int().min(0).max(3650).nullable().optional(),
  startInDays: z.number().int().min(0).max(3650).nullable().optional(),
});
export type TemplatePayload = z.infer<typeof payloadSchema>;

export const templateBody = z.object({
  name: z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  projectId: z.union([cuidSchema, z.null()]).default(null),
  payload: payloadSchema,
});
export const templateUpdateBody = templateBody.partial();
export const fromTaskBody = z.object({
  name: z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  /** true: only offered in the task's project (keeps custom field values) */
  projectOnly: z.boolean().default(true),
});
export const applyBody = z.object({
  projectId: cuidSchema,
  title: z.string().trim().min(1).max(200).optional(),
  dueDate: optionalDate.optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  customFields: z.record(cuidSchema, z.unknown()).optional(),
});

const requireManage = (actor: Actor) => {
  if (!hasPermission(actor.tenant.role, "templates:manage")) throw forbidden("Your role can't manage templates");
};

const assertProjectVisible = async (actor: Actor, projectId: string) => {
  const ok = await prisma.project.count({ where: { id: projectId, ...projectAccessWhere(actor) } });
  if (!ok) throw notFound("Project not found");
};

/** Templates the actor can see: org-wide ones, plus those of projects they can see. */
const visibleTemplates = (actor: Actor): Prisma.TaskTemplateWhereInput => ({
  organizationId: actor.tenant.organizationId,
  OR: [{ projectId: null }, { project: projectAccessWhere(actor) }],
});

const findTemplate = async (actor: Actor, id: string) => {
  const t = await prisma.taskTemplate.findFirst({ where: { id, ...visibleTemplates(actor) } });
  if (!t) throw notFound("Template not found");
  return t;
};

const assertLabelsInOrg = async (organizationId: string, ids: string[]) => {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const n = await prisma.label.count({ where: { organizationId, id: { in: unique } } });
  if (n !== unique.length) throw badRequest("One or more labels don't exist");
};

const summary = (t: { id: string; name: string; description: string | null; projectId: string | null; payload: Prisma.JsonValue; createdAt: Date; updatedAt: Date; createdBy?: { id: number; name: string | null; email: string } | null }) => {
  const p = t.payload as unknown as TemplatePayload;
  return { ...t, subtaskCount: p.subtasks?.length ?? 0, checklistCount: p.checklist?.length ?? 0 };
};

export const listTemplates = async (actor: Actor, projectId?: string) => {
  if (projectId) await assertProjectVisible(actor, projectId);
  const rows = await prisma.taskTemplate.findMany({
    where: { ...visibleTemplates(actor), ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : {}) },
    orderBy: { name: "asc" },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });
  return rows.map(summary);
};

export const getTemplate = async (actor: Actor, id: string) => summary(await findTemplate(actor, id));

export const createTemplate = async (req: Request, actor: Actor, input: z.infer<typeof templateBody>) => {
  requireManage(actor);
  if (input.projectId) await assertProjectVisible(actor, input.projectId);
  if (!input.projectId && Object.keys(input.payload.customFields).length) throw badRequest("Organization-wide templates can't hold custom field values");
  await assertLabelsInOrg(actor.tenant.organizationId, input.payload.labelIds);
  const t = await prisma.taskTemplate.create({
    data: {
      organizationId: actor.tenant.organizationId,
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      createdById: actor.userId,
    },
  });
  await audit(req, { action: "template.created", organizationId: actor.tenant.organizationId, targetType: "template", targetId: t.id, metadata: { name: t.name } });
  return summary(t);
};

/** Snapshot an existing task (with its subtasks and checklist) as a template. */
export const templateFromTask = async (req: Request, actor: Actor, taskId: number, input: z.infer<typeof fromTaskBody>) => {
  requireManage(actor);
  const base = await findVisible(actor, taskId);
  const full = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      checklist: { orderBy: { position: "asc" } },
      labels: true,
      fieldValues: true,
      subtasks: { where: { deletedAt: null }, orderBy: { position: "asc" }, include: { checklist: { orderBy: { position: "asc" } } } },
    },
  });
  // Keep the task's duration: due N days after it starts (or after it was created, if it has no start)
  const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const ref = full.startDate ? dayOf(full.startDate) : dayOf(full.createdAt);
  const dueInDays = full.dueDate ? Math.max(0, Math.round((dayOf(full.dueDate) - ref) / 86_400_000)) : null;

  const payload = payloadSchema.parse({
    title: full.title,
    description: full.description,
    priority: full.priority,
    estimateHours: full.estimateHours,
    labelIds: full.labels.map((l) => l.labelId),
    checklist: full.checklist.map((c) => c.text),
    subtasks: full.subtasks.slice(0, 50).map((s) => ({ title: s.title, description: s.description, priority: s.priority, estimateHours: s.estimateHours, checklist: s.checklist.map((c) => c.text) })),
    customFields: input.projectOnly ? Object.fromEntries(full.fieldValues.map((v) => [v.fieldId, v.value])) : {},
    dueInDays,
    startInDays: full.startDate ? 0 : null,
  });
  return createTemplate(req, actor, { name: input.name, description: input.description ?? null, projectId: input.projectOnly ? base.projectId : null, payload });
};

export const updateTemplate = async (req: Request, actor: Actor, id: string, input: z.infer<typeof templateUpdateBody>) => {
  requireManage(actor);
  const t = await findTemplate(actor, id);
  const projectId = input.projectId !== undefined ? input.projectId : t.projectId;
  if (input.projectId) await assertProjectVisible(actor, input.projectId);
  const payload = input.payload ?? (t.payload as unknown as TemplatePayload);
  if (!projectId && Object.keys(payload.customFields ?? {}).length) throw badRequest("Organization-wide templates can't hold custom field values");
  if (input.payload) await assertLabelsInOrg(actor.tenant.organizationId, input.payload.labelIds);
  const updated = await prisma.taskTemplate.update({
    where: { id },
    data: { name: input.name, description: input.description, projectId, payload: input.payload as unknown as Prisma.InputJsonValue | undefined },
  });
  await audit(req, { action: "template.updated", organizationId: actor.tenant.organizationId, targetType: "template", targetId: id });
  return summary(updated);
};

export const deleteTemplate = async (req: Request, actor: Actor, id: string) => {
  requireManage(actor);
  const t = await findTemplate(actor, id);
  await prisma.taskTemplate.delete({ where: { id } });
  await audit(req, { action: "template.deleted", organizationId: actor.tenant.organizationId, targetType: "template", targetId: id, metadata: { name: t.name } });
};

const DAY = 86_400_000;
const todayUtc = () => {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
};

/**
 * Creates a task (with subtasks and checklists) from a template, in one transaction.
 * Anyone who can create tasks in the target project may use any template they can see.
 */
export const applyTemplate = async (actor: Actor, id: string, input: z.infer<typeof applyBody>) => {
  const t = await findTemplate(actor, id);
  if (t.projectId && t.projectId !== input.projectId) throw badRequest("This template belongs to another project");
  const caps = await resolveProjectAccess(actor, input.projectId);
  if (!caps.createTasks) throw forbidden("You can't create tasks in this project");
  await assertProjectWritable(input.projectId);

  const p = payloadSchema.parse(t.payload);
  // Labels deleted since the template was saved are skipped rather than failing the whole apply
  const labels = await prisma.label.findMany({ where: { organizationId: actor.tenant.organizationId, id: { in: p.labelIds } }, select: { id: true } });
  if (input.assigneeId) await assertAssignable(actor, input.projectId, input.assigneeId);

  const start = p.startInDays != null ? new Date(todayUtc() + p.startInDays * DAY) : null;
  const due = input.dueDate !== undefined ? input.dueDate : p.dueInDays != null ? new Date(todayUtc() + p.dueInDays * DAY) : null;
  if (start && due && start > due) throw badRequest("The template's start date would be after the due date");
  const customFields = { ...(t.projectId ? p.customFields : {}), ...(input.customFields ?? {}) };

  const taskId = await prisma.$transaction(
    async (tx) => {
      const parentId = await insertTask(tx, {
        organizationId: actor.tenant.organizationId,
        projectId: input.projectId,
        createdById: actor.userId,
        title: input.title ?? p.title,
        description: p.description ?? null,
        priority: p.priority,
        estimateHours: p.estimateHours ?? null,
        startDate: start,
        dueDate: due,
        assigneeId: input.assigneeId ?? null,
        labelIds: labels.map((l) => l.id),
        checklist: p.checklist,
        customFields,
        activity: { type: "created", changes: { template: t.name } },
      });
      for (const s of p.subtasks) {
        await insertTask(tx, {
          organizationId: actor.tenant.organizationId,
          projectId: input.projectId,
          createdById: actor.userId,
          title: s.title,
          description: s.description ?? null,
          priority: s.priority,
          estimateHours: s.estimateHours ?? null,
          parentId,
          checklist: s.checklist,
          // Required fields are enforced on the parent; subtasks inherit nothing automatically
          enforceRequired: false,
          activity: { type: "created", changes: { template: t.name } },
        });
      }
      return parentId;
    },
    { timeout: 20_000 }
  );
  return getTask(actor, taskId);
};
