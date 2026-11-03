import type { Request } from "express";
import { z } from "zod";
import { prisma } from "../../core/prisma";
import { AppError, badRequest, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import { projectAccessWhere, resolveProjectAccess, type Actor } from "../../core/access";
import { assertProjectWritable, editableTask, findVisible, getTask, visibleTasks } from "../tasks/tasks.service";
import { afterCompletion, logActivity, nextPosition } from "../tasks/lifecycle";

export const requestBody = z.object({
  approverIds: z.array(z.number().int().positive()).min(1, "Choose at least one approver").max(10, "At most 10 approvers"),
  rule: z.enum(["ANY", "ALL"]).default("ANY"),
  note: z.string().trim().max(2000).nullable().optional(),
});
export const decisionBody = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().trim().max(2000).nullable().optional(),
});
export const listQuery = z.object({ scope: z.enum(["to-me", "by-me"]).default("to-me") });

const userSelect = { id: true, email: true, name: true } as const;
const requestSelect = {
  id: true,
  rule: true,
  status: true,
  note: true,
  createdAt: true,
  decidedAt: true,
  consumedAt: true,
  requestedBy: { select: userSelect },
  steps: { select: { decision: true, comment: true, decidedAt: true, approver: { select: userSelect } } },
  task: { select: { id: true, number: true, title: true, status: true, dueDate: true, project: { select: { id: true, key: true, name: true, color: true } } } },
} as const;

const withKey = <T extends { task: { number: number; project: { key: string } } }>(r: T) => ({ ...r, task: { ...r.task, key: `${r.task.project.key}-${r.task.number}` } });

/**
 * Asks named people to sign off on a task. Approvers must be able to see the project
 * (clients count — signing off deliverables is their job); org viewers are read-only and
 * can't approve; nobody approves their own request.
 */
export const requestApproval = async (req: Request, actor: Actor, taskId: number, input: z.infer<typeof requestBody>) => {
  const { task } = await editableTask(actor, taskId);
  if (task.archivedAt) throw badRequest("Unarchive this task first");
  if (task.status === "DONE") throw badRequest("This task is already done");
  await assertProjectWritable(task.projectId);

  const approverIds = [...new Set(input.approverIds)];
  if (approverIds.includes(actor.userId)) throw badRequest("You can't approve your own request");
  const { organizationId } = actor.tenant;
  const members = await prisma.membership.findMany({ where: { organizationId, userId: { in: approverIds } }, select: { userId: true, role: true } });
  if (members.length !== approverIds.length) throw badRequest("Every approver must be a member of this organization");
  for (const m of members) {
    if (m.role === "VIEWER") throw badRequest("Viewers can't approve tasks");
    const sees = await prisma.project.count({ where: { id: task.projectId, ...projectAccessWhere({ userId: m.userId, tenant: { organizationId, role: m.role } }) } });
    if (!sees) throw badRequest("Every approver must have access to this project");
  }

  const request = await prisma.$transaction(async (tx) => {
    // Serialise requests on the same task: only one can be pending
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
    if (await tx.approvalRequest.findFirst({ where: { taskId, status: "PENDING" } })) throw new AppError(409, "APPROVAL_PENDING", "This task already has a pending approval");

    const r = await tx.approvalRequest.create({
      data: { taskId, requestedById: actor.userId, rule: input.rule, note: input.note ?? null, steps: { create: approverIds.map((approverId) => ({ approverId })) } },
      select: { id: true },
    });
    const current = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true } });
    if (current.status !== "IN_REVIEW") {
      await tx.task.update({ where: { id: taskId }, data: { status: "IN_REVIEW", position: await nextPosition(tx, task.projectId, "IN_REVIEW") } });
      await logActivity(tx, taskId, actor.userId, "updated", { status: { from: current.status, to: "IN_REVIEW" } });
    }
    await tx.taskWatcher.createMany({ data: approverIds.map((userId) => ({ taskId, userId })), skipDuplicates: true });
    await logActivity(tx, taskId, actor.userId, "approval_requested", { rule: input.rule, approvers: approverIds.length, note: input.note ?? null });
    return r;
  });

  await audit(req, { action: "approval.requested", organizationId, targetType: "task", targetId: taskId, metadata: { requestId: request.id, approverIds, rule: input.rule } });
  return getTask(actor, taskId);
};

/** Loads a request in the caller's organization, on a task they can still see. */
const findRequest = async (actor: Actor, id: string) => {
  const r = await prisma.approvalRequest.findFirst({
    where: { id, task: { organizationId: actor.tenant.organizationId } },
    include: { steps: true, task: { select: { id: true, projectId: true, status: true, archivedAt: true, deletedAt: true } } },
  });
  if (!r) throw notFound("Approval not found");
  try {
    await findVisible(actor, r.taskId);
  } catch {
    throw notFound("Approval not found");
  }
  return r;
};

/**
 * Records one approver's decision. Any rejection rejects the request; it's approved when one
 * approver (ANY) or every approver (ALL) has approved. Approval completes the task (unless it's
 * blocked by unfinished dependencies); rejection sends it back to In progress.
 */
export const decide = async (req: Request, actor: Actor, requestId: string, input: z.infer<typeof decisionBody>) => {
  const r = await findRequest(actor, requestId);
  if (!r.steps.some((s) => s.approverId === actor.userId)) throw forbidden("You're not an approver on this request");
  // Roles are re-read on every request: someone demoted to Viewer after being named loses the right to decide
  if (actor.tenant.role === "VIEWER") throw forbidden("Viewers can't approve tasks");

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${requestId} FOR UPDATE`;
    const fresh = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { steps: true } });
    if (fresh.status !== "PENDING") throw new AppError(409, "APPROVAL_CLOSED", "This approval has already been decided");
    const mine = fresh.steps.find((s) => s.approverId === actor.userId)!;
    if (mine.decision !== "PENDING") throw new AppError(409, "ALREADY_DECIDED", "You've already responded to this approval");

    const decision = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const now = new Date();
    await tx.approvalStep.update({ where: { id: mine.id }, data: { decision, comment: input.comment ?? null, decidedAt: now } });
    const steps = fresh.steps.map((s) => (s.id === mine.id ? { ...s, decision } : s));

    let status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING";
    if (decision === "REJECTED") status = "REJECTED";
    else if (fresh.rule === "ANY" || steps.every((s) => s.decision === "APPROVED")) status = "APPROVED";

    await logActivity(tx, r.taskId, actor.userId, decision === "APPROVED" ? "approval_approved" : "approval_rejected", { comment: input.comment ?? null, final: status !== "PENDING" });
    if (status === "PENDING") return { status, completed: false };

    await tx.approvalRequest.update({ where: { id: requestId }, data: { status, decidedAt: now } });
    const task = await tx.task.findUniqueOrThrow({ where: { id: r.taskId }, select: { status: true, archivedAt: true, deletedAt: true, projectId: true } });
    if (task.deletedAt || task.archivedAt) return { status, completed: false };

    if (status === "REJECTED") {
      if (task.status === "IN_REVIEW") {
        await tx.task.update({ where: { id: r.taskId }, data: { status: "IN_PROGRESS", position: await nextPosition(tx, task.projectId, "IN_PROGRESS") } });
        await logActivity(tx, r.taskId, actor.userId, "updated", { status: { from: "IN_REVIEW", to: "IN_PROGRESS" } });
      }
      return { status, completed: false };
    }

    // Approved: complete the task now, unless unfinished dependencies still block it
    const blocked = await tx.taskDependency.count({ where: { taskId: r.taskId, dependsOn: { status: { not: "DONE" }, deletedAt: null } } });
    if (blocked || task.status === "DONE") {
      if (blocked) await logActivity(tx, r.taskId, actor.userId, "approval_waiting_on_blockers");
      return { status, completed: false };
    }
    await tx.task.update({ where: { id: r.taskId }, data: { status: "DONE", completedAt: now, position: await nextPosition(tx, task.projectId, "DONE") } });
    await logActivity(tx, r.taskId, actor.userId, "updated", { status: { from: task.status, to: "DONE" } });
    await afterCompletion(tx, r.taskId, actor.userId, requestId);
    return { status, completed: true };
  });

  await audit(req, { action: "approval.decided", organizationId: actor.tenant.organizationId, targetType: "task", targetId: r.taskId, metadata: { requestId, decision: input.decision, outcome: outcome.status } });
  return { ...outcome, task: await getTask(actor, r.taskId) };
};

/** The requester, or a project manager, can withdraw a pending request. */
export const cancel = async (req: Request, actor: Actor, requestId: string) => {
  const r = await findRequest(actor, requestId);
  const caps = await resolveProjectAccess(actor, r.task.projectId);
  if (r.requestedById !== actor.userId && !caps.manage) throw forbidden("Only the requester or a project manager can cancel this approval");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${requestId} FOR UPDATE`;
    const fresh = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (fresh.status !== "PENDING") throw new AppError(409, "APPROVAL_CLOSED", "Only pending approvals can be cancelled");
    await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", decidedAt: new Date() } });
    const task = await tx.task.findUniqueOrThrow({ where: { id: r.taskId }, select: { status: true, projectId: true } });
    if (task.status === "IN_REVIEW") {
      await tx.task.update({ where: { id: r.taskId }, data: { status: "IN_PROGRESS", position: await nextPosition(tx, task.projectId, "IN_PROGRESS") } });
      await logActivity(tx, r.taskId, actor.userId, "updated", { status: { from: "IN_REVIEW", to: "IN_PROGRESS" } });
    }
    await logActivity(tx, r.taskId, actor.userId, "approval_cancelled");
  });
  await audit(req, { action: "approval.cancelled", organizationId: actor.tenant.organizationId, targetType: "task", targetId: r.taskId, metadata: { requestId } });
  return getTask(actor, r.taskId);
};

/** "Waiting on me" (pending, I haven't answered) or "requested by me" (recent, any state). */
export const listApprovals = async (actor: Actor, scope: "to-me" | "by-me") => {
  const rows = await prisma.approvalRequest.findMany({
    where:
      scope === "to-me"
        ? { status: "PENDING", task: visibleTasks(actor), steps: { some: { approverId: actor.userId, decision: "PENDING" } } }
        : { requestedById: actor.userId, task: visibleTasks(actor) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: requestSelect,
  });
  return rows.map(withKey);
};

export const pendingCount = (actor: Actor) =>
  prisma.approvalRequest.count({ where: { status: "PENDING", task: visibleTasks(actor), steps: { some: { approverId: actor.userId, decision: "PENDING" } } } });
