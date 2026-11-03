import type { Request } from "express";
import { prisma } from "../../core/prisma";
import { badRequest, forbidden, notFound } from "../../core/errors";
import { hasPermission } from "../../core/rbac";
import { audit } from "../../core/audit";
import type { TenantContext } from "../../core/tenant";
import type { CreateTaskInput, UpdateTaskInput } from "./tasks.schemas";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A due date is "in the past" only if it is before yesterday (UTC).
 * The one-day tolerance covers every user time zone (UTC-12 … UTC+14).
 */
const isPastDueDate = (date: Date): boolean => {
  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return date.getTime() < startOfTodayUtc - DAY_MS;
};

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  createdById: true,
  createdBy: { select: { id: true, email: true, name: true } },
} as const;

export interface Actor {
  userId: number;
  tenant: TenantContext;
}

/**
 * Every query is scoped to the caller's organisation. A task in another tenant
 * returns 404 exactly like a task that doesn't exist, so ids can't be probed.
 */
const findTenantTask = async (actor: Actor, id: number) => {
  const task = await prisma.task.findFirst({
    where: { id, organizationId: actor.tenant.organizationId },
    select: taskSelect,
  });
  if (!task) throw notFound("Task not found");
  return task;
};

/** Resource-level check: "_any" permissions cover every task; "_own" only tasks you created. */
const assertCanModify = (actor: Actor, task: { createdById: number | null }, action: "update" | "delete") => {
  const { role } = actor.tenant;
  if (hasPermission(role, `tasks:${action}_any`)) return;
  if (hasPermission(role, `tasks:${action}_own`) && task.createdById === actor.userId) return;
  throw forbidden(
    hasPermission(role, `tasks:${action}_own`)
      ? `You can only ${action} tasks you created`
      : `Your role can't ${action} tasks`
  );
};

export const listTasks = (actor: Actor) =>
  prisma.task.findMany({
    where: { organizationId: actor.tenant.organizationId },
    orderBy: { createdAt: "desc" },
    select: taskSelect,
  });

export const getTask = (actor: Actor, id: number) => findTenantTask(actor, id);

export const createTask = async (actor: Actor, input: CreateTaskInput) => {
  if (input.dueDate && isPastDueDate(input.dueDate)) {
    throw badRequest("Due date cannot be in the past");
  }

  return prisma.task.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      dueDate: input.dueDate ?? null,
      // Tenant and creator come from the server-side context, never from the body
      organizationId: actor.tenant.organizationId,
      createdById: actor.userId,
    },
    select: taskSelect,
  });
};

export const updateTask = async (actor: Actor, id: number, input: UpdateTaskInput) => {
  const existing = await findTenantTask(actor, id);
  assertCanModify(actor, existing, "update");

  // Only validate the due date when it is actually being changed
  if (
    input.dueDate !== undefined &&
    input.dueDate !== null &&
    !sameInstant(input.dueDate, existing.dueDate) &&
    isPastDueDate(input.dueDate)
  ) {
    throw badRequest("Due date cannot be in the past");
  }

  // Tenant condition stays in the write itself (no check-then-act gap)
  const { count } = await prisma.task.updateMany({
    where: { id, organizationId: actor.tenant.organizationId },
    data: {
      title: input.title,
      description: input.description,
      status: input.status,
      dueDate: input.dueDate,
    },
  });
  if (count === 0) throw notFound("Task not found");

  return findTenantTask(actor, id);
};

export const deleteTask = async (req: Request, actor: Actor, id: number): Promise<void> => {
  const existing = await findTenantTask(actor, id);
  assertCanModify(actor, existing, "delete");

  const { count } = await prisma.task.deleteMany({ where: { id, organizationId: actor.tenant.organizationId } });
  if (count === 0) throw notFound("Task not found");

  await audit(req, {
    action: "task.deleted",
    organizationId: actor.tenant.organizationId,
    targetType: "task",
    targetId: id,
    metadata: { title: existing.title },
  });
};
