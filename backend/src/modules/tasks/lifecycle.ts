import { Prisma, type Priority, type Status } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { AppError } from "../../core/errors";
import { writeFieldValues } from "../fields/fields.service";
import { addDays, describeRule, nextOccurrence } from "../recurrence/schedule";

/**
 * Task lifecycle shared by every way a task comes to exist or finish:
 * plain create, template apply, recurrence and approvals. One place, one set of rules.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const POSITION_GAP = 1024;
const MAX_CHECKLIST = 100;

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const todayKey = () => dayKey(new Date());
const keyToDate = (k: string) => new Date(`${k}T00:00:00.000Z`);

export const nextPosition = async (db: Db, projectId: string, status: Status) => {
  const last = await db.task.aggregate({ where: { projectId, status, deletedAt: null }, _max: { position: true } });
  return (last._max.position ?? 0) + POSITION_GAP;
};

export const logActivity = (db: Db, taskId: number, actorId: number | null, type: string, changes?: Prisma.InputJsonValue) =>
  db.taskActivity.create({ data: { taskId, actorId, type, changes } });

export interface NewTask {
  organizationId: string;
  projectId: string;
  createdById: number | null;
  title: string;
  description?: string | null;
  status?: Status;
  priority?: Priority;
  startDate?: Date | null;
  dueDate?: Date | null;
  estimateHours?: number | null;
  actualHours?: number | null;
  assigneeId?: number | null;
  parentId?: number | null;
  milestoneId?: string | null;
  /** Must already be validated as belonging to the organization */
  labelIds?: string[];
  checklist?: string[];
  customFields?: Record<string, unknown>;
  /** Reject when required custom fields are missing (off when copying an existing occurrence) */
  enforceRequired?: boolean;
  seriesId?: string | null;
  previousOccurrenceId?: number | null;
  activity: { type: string; changes?: Prisma.InputJsonValue };
}

/** Inserts a task with the next per-project number. Must run inside a transaction. */
export const insertTask = async (tx: Prisma.TransactionClient, t: NewTask): Promise<number> => {
  // Row lock on the project serialises numbering, so keys never collide
  const { taskCounter } = await tx.project.update({ where: { id: t.projectId }, data: { taskCounter: { increment: 1 } }, select: { taskCounter: true } });
  const status = t.status ?? "TODO";
  const checklist = (t.checklist ?? []).slice(0, MAX_CHECKLIST);
  const task = await tx.task.create({
    data: {
      number: taskCounter,
      title: t.title,
      description: t.description ?? null,
      status,
      priority: t.priority ?? "MEDIUM",
      startDate: t.startDate ?? null,
      dueDate: t.dueDate ?? null,
      estimateHours: t.estimateHours ?? null,
      actualHours: t.actualHours ?? null,
      position: await nextPosition(tx, t.projectId, status),
      completedAt: status === "DONE" ? new Date() : null,
      organizationId: t.organizationId,
      projectId: t.projectId,
      createdById: t.createdById,
      assigneeId: t.assigneeId ?? null,
      parentId: t.parentId ?? null,
      milestoneId: t.milestoneId ?? null,
      seriesId: t.seriesId ?? null,
      previousOccurrenceId: t.previousOccurrenceId ?? null,
      labels: t.labelIds?.length ? { create: [...new Set(t.labelIds)].map((labelId) => ({ labelId })) } : undefined,
      checklist: checklist.length ? { create: checklist.map((text, i) => ({ text, position: (i + 1) * POSITION_GAP })) } : undefined,
    },
    select: { id: true },
  });
  await writeFieldValues(tx, { id: task.id, projectId: t.projectId, organizationId: t.organizationId }, t.customFields ?? {}, { creating: t.enforceRequired ?? true });
  const watcherIds = [...new Set([t.createdById, t.assigneeId].filter((v): v is number => typeof v === "number"))];
  await tx.taskWatcher.createMany({ data: watcherIds.map((userId) => ({ taskId: task.id, userId })), skipDuplicates: true });
  await logActivity(tx, task.id, t.createdById, t.activity.type, t.activity.changes);
  return task.id;
};

// ─── Completion ──────────────────────────────────────────────────────────────

/**
 * May this task be marked done right now? A pending approval always blocks it; in a
 * project that requires approval, the latest request must be approved and not yet used.
 * Returns the approval to consume (mark as used) once the task is done.
 */
export const assertCanComplete = async (db: Db, task: { id: number; projectId: string }): Promise<string | null> => {
  const pending = await db.approvalRequest.findFirst({ where: { taskId: task.id, status: "PENDING" }, select: { id: true } });
  if (pending) throw new AppError(409, "APPROVAL_PENDING", "This task is waiting for approval. It's completed when the approval is granted.");

  const latest = await db.approvalRequest.findFirst({ where: { taskId: task.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, consumedAt: true } });
  const usable = latest?.status === "APPROVED" && !latest.consumedAt ? latest.id : null;

  const project = await db.project.findUniqueOrThrow({ where: { id: task.projectId }, select: { completionApproval: true } });
  if (project.completionApproval === "REQUIRED" && !usable) {
    throw new AppError(409, "APPROVAL_REQUIRED", "This project requires approval before a task is completed. Request an approval from the task.");
  }
  return usable;
};

/**
 * Runs after a task has been set to DONE (same transaction): marks the approval as used and,
 * for a recurring task, creates the next occurrence exactly once.
 */
export const afterCompletion = async (tx: Prisma.TransactionClient, taskId: number, actorId: number | null, approvalId: string | null) => {
  if (approvalId) await tx.approvalRequest.update({ where: { id: approvalId }, data: { consumedAt: new Date() } });

  // Lock the occurrence so two concurrent completions can't both spawn a successor
  await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
  const t = await tx.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      series: true,
      nextOccurrence: { select: { id: true } },
      labels: { select: { labelId: true } },
      checklist: { orderBy: { position: "asc" }, select: { text: true } },
      fieldValues: { select: { fieldId: true, value: true } },
      milestone: { select: { completedAt: true } },
      project: { select: { key: true, status: true } },
    },
  });
  const s = t.series;
  if (!s || !s.active || t.nextOccurrence || t.parentId || t.deletedAt || t.project.status === "ARCHIVED") return null;

  const stop = () => tx.recurrenceSeries.update({ where: { id: s.id }, data: { active: false } });
  if (s.maxOccurrences && s.occurrences >= s.maxOccurrences) {
    await stop();
    return null;
  }

  // Next date after this occurrence's due date; skip any that are already in the past
  const base = t.dueDate ? dayKey(t.dueDate) : todayKey();
  let due = nextOccurrence(s, base);
  for (let i = 0; due < todayKey() && i < 1000; i++) due = nextOccurrence(s, due);
  if (s.endsOn && due > dayKey(s.endsOn)) {
    await stop();
    return null;
  }
  const shift = Math.round((keyToDate(due).getTime() - keyToDate(base).getTime()) / 86_400_000);

  const id = await insertTask(tx, {
    organizationId: t.organizationId,
    projectId: t.projectId,
    createdById: t.createdById ?? actorId,
    title: t.title,
    description: t.description,
    priority: t.priority,
    estimateHours: t.estimateHours,
    assigneeId: t.assigneeId,
    milestoneId: t.milestone && !t.milestone.completedAt ? t.milestoneId : null,
    dueDate: keyToDate(due),
    startDate: t.startDate ? keyToDate(addDays(dayKey(t.startDate), shift)) : null,
    labelIds: t.labels.map((l) => l.labelId),
    checklist: t.checklist.map((c) => c.text),
    customFields: Object.fromEntries(t.fieldValues.map((v) => [v.fieldId, v.value])),
    enforceRequired: false,
    seriesId: s.id,
    previousOccurrenceId: t.id,
    activity: { type: "created", changes: { recurrence: describeRule(s), previous: `${t.project.key}-${t.number}` } },
  });
  await tx.recurrenceSeries.update({ where: { id: s.id }, data: { occurrences: { increment: 1 } } });
  await logActivity(tx, t.id, actorId, "recurrence_next", { nextId: id, dueDate: due });
  return id;
};
