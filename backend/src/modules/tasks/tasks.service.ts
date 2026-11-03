import type { Request } from "express";
import { Prisma, type Status } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { AppError, badRequest, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import {
  assertOrgMember,
  assertTaskPermission,
  canTouchTask,
  projectAccessWhere,
  resolveProjectAccess,
  type Actor,
  type ProjectCapabilities,
} from "../../core/access";
import type { BulkInput, CreateTaskInput, ListTasksQuery, UpdateTaskInput } from "./tasks.schemas";

export type { Actor } from "../../core/access";

type Db = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 86_400_000;
const POSITION_GAP = 1024;
const MAX_DEPTH = 3; // task → subtask → sub-subtask

const startOfTodayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

/** "In the past" only before yesterday (UTC): the one-day tolerance covers every time zone. */
const isPastDueDate = (date: Date) => date.getTime() < startOfTodayUtc().getTime() - DAY_MS;
const sameInstant = (a: Date | null | undefined, b: Date | null | undefined) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

const userSelect = { id: true, email: true, name: true } as const;

/** Shape used by every list/board/calendar/gantt view. */
const listSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  startDate: true,
  dueDate: true,
  estimateHours: true,
  actualHours: true,
  position: true,
  completedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  projectId: true,
  parentId: true,
  milestoneId: true,
  createdById: true,
  assigneeId: true,
  project: { select: { id: true, key: true, name: true, color: true } },
  createdBy: { select: userSelect },
  assignee: { select: userSelect },
  milestone: { select: { id: true, name: true } },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  checklist: { select: { done: true } },
  dependsOn: { where: { dependsOn: { deletedAt: null } }, select: { dependsOnId: true, dependsOn: { select: { status: true } } } },
  _count: { select: { subtasks: { where: { deletedAt: null } } } },
} satisfies Prisma.TaskSelect;

type ListRow = Prisma.TaskGetPayload<{ select: typeof listSelect }>;

const toListItem = ({ labels, checklist, dependsOn, _count, ...t }: ListRow) => ({
  ...t,
  key: `${t.project.key}-${t.number}`,
  labels: labels.map((l) => l.label),
  checklistTotal: checklist.length,
  checklistDone: checklist.filter((c) => c.done).length,
  subtaskCount: _count.subtasks,
  dependsOnIds: dependsOn.map((d) => d.dependsOnId),
  // Only unfinished blockers count: a task whose blockers are all done is not blocked
  blockedBy: dependsOn.filter((d) => d.dependsOn.status !== "DONE").map((d) => d.dependsOnId),
  isBlocked: dependsOn.some((d) => d.dependsOn.status !== "DONE"),
});

/** Tasks the actor may see: not deleted, in a project they can access. */
const visibleTasks = (actor: Actor): Prisma.TaskWhereInput => ({
  organizationId: actor.tenant.organizationId,
  deletedAt: null,
  project: projectAccessWhere(actor),
});

/** Same 404 for "doesn't exist", "other tenant", "private project" and "deleted". */
const findVisible = async (actor: Actor, id: number, db: Db = prisma) => {
  const task = await db.task.findFirst({ where: { id, ...visibleTasks(actor) }, select: listSelect });
  if (!task) throw notFound("Task not found");
  return task;
};

// ─── Validation of references (all must live in the same org / project) ──────

/** The assignee must be an org member who can actually see this project. */
const assertAssignable = async (actor: Actor, projectId: string, userId: number) => {
  const membership = await assertOrgMember(actor.tenant.organizationId, userId, "Assignee");
  const assigneeActor: Actor = { userId, tenant: { organizationId: actor.tenant.organizationId, role: membership.role } };
  const visible = await prisma.project.count({ where: { id: projectId, ...projectAccessWhere(assigneeActor) } });
  if (!visible) throw badRequest("The assignee doesn't have access to this project");
};

const assertMilestone = async (projectId: string, milestoneId: string) => {
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId } });
  if (!m) throw badRequest("Milestone does not belong to this project");
};

const assertLabels = async (organizationId: string, labelIds: string[]) => {
  const unique = [...new Set(labelIds)];
  const count = await prisma.label.count({ where: { id: { in: unique }, organizationId } });
  if (count !== unique.length) throw badRequest("One or more labels don't exist");
  return unique;
};

/** Depth of a task counted from the root (root = 1). Bounded walk. */
const depthOf = async (taskId: number): Promise<number> => {
  let depth = 1;
  let current: number | null = taskId;
  while (current !== null && depth <= MAX_DEPTH + 1) {
    const row: { parentId: number | null } | null = await prisma.task.findUnique({ where: { id: current }, select: { parentId: true } });
    if (!row?.parentId) break;
    current = row.parentId;
    depth++;
  }
  return depth;
};

/** Height of a task's subtree (leaf = 1). Used when moving a task with children. */
const subtreeHeight = async (taskId: number): Promise<number> => {
  const rows = await prisma.$queryRaw<{ height: number }[]>`
    WITH RECURSIVE tree(id, lvl) AS (
      SELECT id, 1 FROM "Task" WHERE id = ${taskId}
      UNION ALL
      SELECT t.id, tree.lvl + 1 FROM "Task" t JOIN tree ON t."parentId" = tree.id WHERE tree.lvl < 10
    )
    SELECT MAX(lvl)::int AS height FROM tree`;
  return rows[0]?.height ?? 1;
};

const isDescendant = async (ancestorId: number, candidateId: number) => {
  const rows = await prisma.$queryRaw<{ found: number }[]>`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM "Task" WHERE "parentId" = ${ancestorId}
      UNION
      SELECT t.id FROM "Task" t JOIN tree ON t."parentId" = tree.id
    )
    SELECT 1 AS found FROM tree WHERE id = ${candidateId} LIMIT 1`;
  return rows.length > 0;
};

const assertParent = async (actor: Actor, projectId: string, parentId: number, selfId?: number) => {
  if (selfId !== undefined && parentId === selfId) throw badRequest("A task can't be its own parent");
  const parent = await prisma.task.findFirst({ where: { id: parentId, ...visibleTasks(actor) }, select: { projectId: true } });
  if (!parent) throw badRequest("Parent task not found");
  if (parent.projectId !== projectId) throw badRequest("Parent task must be in the same project");
  if (selfId !== undefined && (await isDescendant(selfId, parentId))) throw badRequest("A task can't be moved under one of its own subtasks");
  const height = selfId !== undefined ? await subtreeHeight(selfId) : 1;
  if ((await depthOf(parentId)) + height > MAX_DEPTH) throw badRequest(`Subtasks can be nested at most ${MAX_DEPTH} levels deep`);
};

const assertDates = (start: Date | null | undefined, due: Date | null | undefined) => {
  if (start && due && start.getTime() > due.getTime()) throw badRequest("Start date must be on or before the due date");
};

const unfinishedBlockers = (db: Db, taskId: number) =>
  db.taskDependency.findMany({
    where: { taskId, dependsOn: { status: { not: "DONE" }, deletedAt: null } },
    select: { dependsOn: { select: { id: true, number: true, title: true, project: { select: { key: true } } } } },
  });

const assertNotBlocked = async (db: Db, taskId: number) => {
  const blockers = await unfinishedBlockers(db, taskId);
  if (blockers.length) {
    const keys = blockers.map((b) => `${b.dependsOn.project.key}-${b.dependsOn.number}`);
    throw new AppError(409, "TASK_BLOCKED", `This task is blocked by ${keys.join(", ")}. Finish those first.`, { blockedBy: keys });
  }
};

const nextPosition = async (db: Db, projectId: string, status: Status) => {
  const last = await db.task.aggregate({ where: { projectId, status, deletedAt: null }, _max: { position: true } });
  return (last._max.position ?? 0) + POSITION_GAP;
};

const logActivity = (db: Db, taskId: number, actorId: number, type: string, changes?: Prisma.InputJsonValue) =>
  db.taskActivity.create({ data: { taskId, actorId, type, changes } });

/** JSON-safe value for history */
const plain = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null));

// ─── Queries ─────────────────────────────────────────────────────────────────

const ORDER_FIELDS = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  dueDate: "dueDate",
  startDate: "startDate",
  priority: "priority",
  position: "position",
  title: "title",
  number: "number",
  status: "status",
} as const;

export const listTasks = async (actor: Actor, q: ListTasksQuery) => {
  const and: Prisma.TaskWhereInput[] = [visibleTasks(actor)];

  if (q.projectId) and.push({ projectId: q.projectId });
  if (q.status) and.push({ status: { in: q.status } });
  if (q.priority) and.push({ priority: { in: q.priority } });
  if (q.assigneeId !== undefined) {
    and.push({ assigneeId: q.assigneeId === "me" ? actor.userId : q.assigneeId === "none" ? null : q.assigneeId });
  }
  if (q.createdById !== undefined) and.push({ createdById: q.createdById === "me" ? actor.userId : q.createdById });
  if (q.labelId) and.push({ labels: { some: { labelId: q.labelId } } });
  if (q.milestoneId) and.push({ milestoneId: q.milestoneId === "none" ? null : q.milestoneId });
  if (q.parentId !== undefined) and.push({ parentId: q.parentId === "none" ? null : q.parentId });
  if (q.watching) and.push({ watchers: { some: { userId: actor.userId } } });
  if (q.q) {
    const term = q.q;
    const numeric = /^(?:[A-Za-z][A-Za-z0-9]{1,5}-)?(\d+)$/.exec(term);
    and.push({
      OR: [
        { title: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        ...(numeric ? [{ number: Number(numeric[1]) }] : []),
      ],
    });
  }
  if (q.dueFrom || q.dueTo) and.push({ dueDate: { ...(q.dueFrom ? { gte: q.dueFrom } : {}), ...(q.dueTo ? { lte: q.dueTo } : {}) } });
  if (q.overdue !== undefined) {
    and.push(
      q.overdue
        ? { status: { not: "DONE" }, dueDate: { lt: startOfTodayUtc() } }
        : { OR: [{ status: "DONE" }, { dueDate: null }, { dueDate: { gte: startOfTodayUtc() } }] }
    );
  }
  if (q.archived === "exclude") and.push({ archivedAt: null });
  if (q.archived === "only") and.push({ archivedAt: { not: null } });

  const where: Prisma.TaskWhereInput = { AND: and };
  const field = ORDER_FIELDS[q.sort];
  const nullable = field === "dueDate" || field === "startDate";
  const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
    nullable ? { [field]: { sort: q.order, nulls: "last" } } : { [field]: q.order },
    { id: "asc" },
  ];

  const [rows, total] = await Promise.all([
    prisma.task.findMany({ where, orderBy, take: q.limit, skip: q.offset, select: listSelect }),
    prisma.task.count({ where }),
  ]);
  return { items: rows.map(toListItem), total, limit: q.limit, offset: q.offset };
};

export const getTask = async (actor: Actor, id: number) => {
  const base = await findVisible(actor, id);
  const caps = await resolveProjectAccess(actor, base.projectId);

  const [detail, subtasks] = await Promise.all([
    prisma.task.findUniqueOrThrow({
      where: { id },
      select: {
        parent: { select: { id: true, number: true, title: true, status: true, deletedAt: true } },
        checklist: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, text: true, done: true, position: true } },
        dependsOn: {
          where: { dependsOn: { deletedAt: null } },
          select: { dependsOn: { select: { id: true, number: true, title: true, status: true, project: { select: { key: true } } } } },
        },
        blocks: {
          where: { task: { deletedAt: null } },
          select: { task: { select: { id: true, number: true, title: true, status: true, project: { select: { key: true } } } } },
        },
        watchers: { select: { user: { select: userSelect } } },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, type: true, changes: true, createdAt: true, actor: { select: userSelect } },
        },
      },
    }),
    prisma.task.findMany({
      where: { parentId: id, ...visibleTasks(actor) },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: listSelect,
    }),
  ]);

  const ref = (t: { id: number; number: number; title: string; status: Status; project: { key: string } }) => ({
    id: t.id,
    key: `${t.project.key}-${t.number}`,
    title: t.title,
    status: t.status,
  });

  return {
    ...toListItem(base),
    parent: detail.parent && !detail.parent.deletedAt
      ? { id: detail.parent.id, key: `${base.project.key}-${detail.parent.number}`, title: detail.parent.title, status: detail.parent.status }
      : null,
    subtasks: subtasks.map(toListItem),
    checklist: detail.checklist,
    dependencies: detail.dependsOn.map((d) => ref(d.dependsOn)),
    blocking: detail.blocks.map((d) => ref(d.task)),
    watchers: detail.watchers.map((w) => w.user),
    isWatching: detail.watchers.some((w) => w.user.id === actor.userId),
    activity: detail.activities,
    permissions: {
      edit: canTouchTask(caps, actor, base, "edit"),
      delete: canTouchTask(caps, actor, base, "delete"),
      createSubtasks: caps.createTasks,
    },
  };
};

export const getActivity = async (actor: Actor, id: number) => {
  await findVisible(actor, id);
  return prisma.taskActivity.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, type: true, changes: true, createdAt: true, actor: { select: userSelect } },
  });
};

// ─── Create ──────────────────────────────────────────────────────────────────

const defaultProjectId = async (actor: Actor) => {
  const project = await prisma.project.findFirst({
    where: { ...projectAccessWhere(actor), status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!project) throw badRequest("Create a project first");
  return project.id;
};

const assertProjectWritable = async (projectId: string) => {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true } });
  if (p.status === "ARCHIVED") throw badRequest("This project is archived. Restore it before adding or changing tasks.");
};

export const createTask = async (actor: Actor, input: CreateTaskInput) => {
  const projectId = input.projectId ?? (await defaultProjectId(actor));
  const caps = await resolveProjectAccess(actor, projectId);
  if (!caps.createTasks) throw forbidden("You can't create tasks in this project");
  await assertProjectWritable(projectId);

  if (input.dueDate && isPastDueDate(input.dueDate)) throw badRequest("Due date cannot be in the past");
  assertDates(input.startDate, input.dueDate);
  if (input.assigneeId) await assertAssignable(actor, projectId, input.assigneeId);
  if (input.parentId) await assertParent(actor, projectId, input.parentId);
  if (input.milestoneId) await assertMilestone(projectId, input.milestoneId);
  const labelIds = input.labelIds?.length ? await assertLabels(actor.tenant.organizationId, input.labelIds) : [];

  const status = input.status ?? "TODO";
  const id = await prisma.$transaction(async (tx) => {
    // Row lock on the project serialises numbering, so keys never collide
    const { taskCounter } = await tx.project.update({
      where: { id: projectId },
      data: { taskCounter: { increment: 1 } },
      select: { taskCounter: true },
    });
    const task = await tx.task.create({
      data: {
        number: taskCounter,
        title: input.title,
        description: input.description ?? null,
        status,
        priority: input.priority ?? "MEDIUM",
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        estimateHours: input.estimateHours ?? null,
        actualHours: input.actualHours ?? null,
        position: await nextPosition(tx, projectId, status),
        completedAt: status === "DONE" ? new Date() : null,
        // Tenant, project and creator come from server-side context, never the body
        organizationId: actor.tenant.organizationId,
        projectId,
        createdById: actor.userId,
        assigneeId: input.assigneeId ?? null,
        parentId: input.parentId ?? null,
        milestoneId: input.milestoneId ?? null,
        labels: labelIds.length ? { create: labelIds.map((labelId) => ({ labelId })) } : undefined,
      },
      select: { id: true },
    });
    const watcherIds = [...new Set([actor.userId, input.assigneeId].filter((v): v is number => typeof v === "number"))];
    await tx.taskWatcher.createMany({ data: watcherIds.map((userId) => ({ taskId: task.id, userId })), skipDuplicates: true });
    await logActivity(tx, task.id, actor.userId, "created", { title: input.title, status });
    return task.id;
  });

  return toListItem(await findVisible(actor, id));
};

// ─── Update ──────────────────────────────────────────────────────────────────

type Existing = ListRow;

/**
 * Validates and applies one update, writing a field-level history entry.
 * Shared by PATCH and bulk updates so both enforce identical rules.
 */
const applyUpdate = async (db: Db, actor: Actor, existing: Existing, input: UpdateTaskInput & { addLabelIds?: string[]; removeLabelIds?: string[] }) => {
  const { projectId } = existing;
  const data: Prisma.TaskUncheckedUpdateInput = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  const track = <K extends keyof Existing & keyof UpdateTaskInput>(field: K) => {
    const next = input[field];
    if (next === undefined) return;
    const prev = existing[field];
    const equal = prev instanceof Date || next instanceof Date ? sameInstant(prev as Date | null, next as Date | null) : prev === next;
    if (equal) return;
    (data as Record<string, unknown>)[field] = next;
    // Position changes are noise in the history; board drags log as a status change if the column changed
    if (field !== "position") changes[field] = { from: plain(prev), to: plain(next) };
  };

  if (input.dueDate && !sameInstant(input.dueDate, existing.dueDate) && isPastDueDate(input.dueDate)) {
    throw badRequest("Due date cannot be in the past");
  }
  assertDates(
    input.startDate !== undefined ? input.startDate : existing.startDate,
    input.dueDate !== undefined ? input.dueDate : existing.dueDate
  );
  if (input.assigneeId && input.assigneeId !== existing.assigneeId) await assertAssignable(actor, projectId, input.assigneeId);
  if (input.parentId && input.parentId !== existing.parentId) await assertParent(actor, projectId, input.parentId, existing.id);
  if (input.milestoneId && input.milestoneId !== existing.milestoneId) await assertMilestone(projectId, input.milestoneId);

  for (const f of ["title", "description", "status", "priority", "assigneeId", "parentId", "milestoneId", "startDate", "dueDate", "estimateHours", "actualHours", "position"] as const) {
    track(f);
  }

  if (data.status !== undefined) {
    if (data.status === "DONE") {
      await assertNotBlocked(db, existing.id);
      data.completedAt = new Date();
    } else if (existing.status === "DONE") {
      data.completedAt = null;
    }
    // Moving to another column without an explicit position → bottom of that column
    if (input.position === undefined) data.position = await nextPosition(db, projectId, data.status as Status);
  }

  // Labels: full replace (PATCH) or add/remove (bulk)
  const currentLabels = existing.labels.map((l) => l.label.id);
  let nextLabels: string[] | null = null;
  if (input.labelIds) nextLabels = await assertLabels(actor.tenant.organizationId, input.labelIds);
  if (input.addLabelIds?.length || input.removeLabelIds?.length) {
    const add = input.addLabelIds?.length ? await assertLabels(actor.tenant.organizationId, input.addLabelIds) : [];
    const remove = new Set(input.removeLabelIds ?? []);
    nextLabels = [...new Set([...currentLabels, ...add])].filter((id) => !remove.has(id));
  }
  if (nextLabels) {
    const same = nextLabels.length === currentLabels.length && nextLabels.every((l) => currentLabels.includes(l));
    if (!same) {
      await db.taskLabel.deleteMany({ where: { taskId: existing.id } });
      if (nextLabels.length) await db.taskLabel.createMany({ data: nextLabels.map((labelId) => ({ taskId: existing.id, labelId })) });
      changes.labels = { from: currentLabels, to: nextLabels };
    }
  }

  if (Object.keys(data).length) await db.task.update({ where: { id: existing.id }, data });
  if (typeof data.assigneeId === "number") {
    await db.taskWatcher.createMany({ data: [{ taskId: existing.id, userId: data.assigneeId }], skipDuplicates: true });
  }
  if (Object.keys(changes).length) await logActivity(db, existing.id, actor.userId, "updated", changes as Prisma.InputJsonValue);
  return Object.keys(changes);
};

export const updateTask = async (actor: Actor, id: number, input: UpdateTaskInput) => {
  const existing = await findVisible(actor, id);
  const caps = await resolveProjectAccess(actor, existing.projectId);
  assertTaskPermission(caps, actor, existing, "edit");
  if (existing.archivedAt) throw badRequest("Unarchive this task before editing it");
  await assertProjectWritable(existing.projectId);

  await prisma.$transaction((tx) => applyUpdate(tx, actor, existing, input));
  return toListItem(await findVisible(actor, id));
};

/** Soft delete: the task and all its subtasks leave every view; history is kept. */
const softDelete = async (db: Db, rootId: number) => {
  const ids = await db.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM "Task" WHERE id = ${rootId}
      UNION
      SELECT t.id FROM "Task" t JOIN tree ON t."parentId" = tree.id
    )
    SELECT id FROM tree`;
  await db.task.updateMany({ where: { id: { in: ids.map((r) => r.id) }, deletedAt: null }, data: { deletedAt: new Date() } });
  return ids.length;
};

export const deleteTask = async (req: Request, actor: Actor, id: number) => {
  const existing = await findVisible(actor, id);
  const caps = await resolveProjectAccess(actor, existing.projectId);
  assertTaskPermission(caps, actor, existing, "delete");

  const removed = await prisma.$transaction(async (tx) => {
    const n = await softDelete(tx, id);
    await logActivity(tx, id, actor.userId, "deleted");
    return n;
  });

  await audit(req, {
    action: "task.deleted",
    organizationId: actor.tenant.organizationId,
    targetType: "task",
    targetId: id,
    metadata: { title: existing.title, key: `${existing.project.key}-${existing.number}`, withSubtasks: removed - 1 },
  });
};

export const setArchived = async (actor: Actor, id: number, archived: boolean) => {
  const existing = await findVisible(actor, id);
  const caps = await resolveProjectAccess(actor, existing.projectId);
  assertTaskPermission(caps, actor, existing, "edit");
  if (Boolean(existing.archivedAt) === archived) return toListItem(existing);
  await prisma.$transaction([
    prisma.task.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } }),
    prisma.taskActivity.create({ data: { taskId: id, actorId: actor.userId, type: archived ? "archived" : "unarchived" } }),
  ]);
  return toListItem(await findVisible(actor, id));
};

// ─── Dependencies ────────────────────────────────────────────────────────────

const editableTask = async (actor: Actor, id: number) => {
  const task = await findVisible(actor, id);
  const caps = await resolveProjectAccess(actor, task.projectId);
  assertTaskPermission(caps, actor, task, "edit");
  return { task, caps };
};

/** Would "taskId depends on dependsOnId" close a loop? (Recursive CTE; UNION stops on cycles.) */
const createsCycle = async (taskId: number, dependsOnId: number) => {
  const rows = await prisma.$queryRaw<{ found: number }[]>`
    WITH RECURSIVE chain(id) AS (
      SELECT "dependsOnId" FROM "TaskDependency" WHERE "taskId" = ${dependsOnId}
      UNION
      SELECT d."dependsOnId" FROM "TaskDependency" d JOIN chain c ON d."taskId" = c.id
    )
    SELECT 1 AS found FROM chain WHERE id = ${taskId} LIMIT 1`;
  return rows.length > 0;
};

export const addDependency = async (actor: Actor, id: number, dependsOnId: number) => {
  if (id === dependsOnId) throw badRequest("A task can't depend on itself");
  const { task } = await editableTask(actor, id);
  const blocker = await prisma.task.findFirst({ where: { id: dependsOnId, ...visibleTasks(actor) }, select: { id: true, number: true, project: { select: { key: true } } } });
  if (!blocker) throw notFound("Blocking task not found");
  if (await createsCycle(id, dependsOnId)) throw badRequest("That would create a circular dependency");

  const exists = await prisma.taskDependency.findUnique({ where: { taskId_dependsOnId: { taskId: id, dependsOnId } } });
  if (!exists) {
    await prisma.$transaction([
      prisma.taskDependency.create({ data: { taskId: id, dependsOnId } }),
      prisma.taskActivity.create({
        data: { taskId: id, actorId: actor.userId, type: "dependency_added", changes: { dependsOn: `${blocker.project.key}-${blocker.number}` } },
      }),
    ]);
  }
  return getTask(actor, task.id);
};

export const removeDependency = async (actor: Actor, id: number, dependsOnId: number) => {
  await editableTask(actor, id);
  const { count } = await prisma.taskDependency.deleteMany({ where: { taskId: id, dependsOnId } });
  if (count === 0) throw notFound("Dependency not found");
  await logActivity(prisma, id, actor.userId, "dependency_removed", { dependsOnId });
  return getTask(actor, id);
};

// ─── Watchers ────────────────────────────────────────────────────────────────

export const setWatching = async (actor: Actor, id: number, watching: boolean) => {
  await findVisible(actor, id);
  if (watching) {
    await prisma.taskWatcher.createMany({ data: [{ taskId: id, userId: actor.userId }], skipDuplicates: true });
  } else {
    await prisma.taskWatcher.deleteMany({ where: { taskId: id, userId: actor.userId } });
  }
  return { watching };
};

// ─── Checklist ───────────────────────────────────────────────────────────────

const MAX_CHECKLIST = 100;

export const addChecklistItem = async (actor: Actor, id: number, text: string) => {
  await editableTask(actor, id);
  const agg = await prisma.checklistItem.aggregate({ where: { taskId: id }, _max: { position: true }, _count: { _all: true } });
  if (agg._count._all >= MAX_CHECKLIST) throw badRequest(`A checklist can have at most ${MAX_CHECKLIST} items`);
  const item = await prisma.checklistItem.create({
    data: { taskId: id, text, position: (agg._max.position ?? 0) + POSITION_GAP },
    select: { id: true, text: true, done: true, position: true },
  });
  await logActivity(prisma, id, actor.userId, "checklist_added", { text });
  return item;
};

export const updateChecklistItem = async (actor: Actor, id: number, itemId: string, input: { text?: string; done?: boolean; position?: number }) => {
  await editableTask(actor, id);
  const item = await prisma.checklistItem.findFirst({ where: { id: itemId, taskId: id } });
  if (!item) throw notFound("Checklist item not found");
  const updated = await prisma.checklistItem.update({ where: { id: itemId }, data: input, select: { id: true, text: true, done: true, position: true } });
  if (input.done !== undefined && input.done !== item.done) {
    await logActivity(prisma, id, actor.userId, input.done ? "checklist_checked" : "checklist_unchecked", { text: item.text });
  }
  return updated;
};

export const deleteChecklistItem = async (actor: Actor, id: number, itemId: string) => {
  await editableTask(actor, id);
  const item = await prisma.checklistItem.findFirst({ where: { id: itemId, taskId: id } });
  if (!item) throw notFound("Checklist item not found");
  await prisma.checklistItem.delete({ where: { id: itemId } });
  await logActivity(prisma, id, actor.userId, "checklist_removed", { text: item.text });
};

// ─── Bulk ────────────────────────────────────────────────────────────────────

/**
 * All-or-nothing: every task must be visible AND editable by the caller, otherwise
 * nothing changes. Each task goes through the same rules as a single PATCH.
 */
export const bulk = async (req: Request, actor: Actor, input: BulkInput) => {
  const ids = [...new Set(input.ids)];
  const tasks = await prisma.task.findMany({ where: { id: { in: ids }, ...visibleTasks(actor) }, select: listSelect });
  if (tasks.length !== ids.length) {
    const found = new Set(tasks.map((t) => t.id));
    throw new AppError(404, "NOT_FOUND", "Some tasks were not found", { missing: ids.filter((i) => !found.has(i)) });
  }

  const capsByProject = new Map<string, ProjectCapabilities>();
  for (const projectId of new Set(tasks.map((t) => t.projectId))) capsByProject.set(projectId, await resolveProjectAccess(actor, projectId));
  const action = input.action === "delete" ? "delete" : "edit";
  const denied = tasks.filter((t) => !canTouchTask(capsByProject.get(t.projectId)!, actor, t, action)).map((t) => t.id);
  if (denied.length) throw new AppError(403, "FORBIDDEN", `You don't have permission to ${action} ${denied.length} of the selected tasks`, { denied });

  if (input.action === "update") {
    const data = input.data ?? {};
    if (!Object.values(data).some((v) => v !== undefined)) throw badRequest("Nothing to update");
    if (data.milestoneId && new Set(tasks.map((t) => t.projectId)).size > 1) throw badRequest("Milestones can only be set on tasks from one project");
    const archived = await prisma.project.count({ where: { id: { in: [...capsByProject.keys()] }, status: "ARCHIVED" } });
    if (archived) throw badRequest("Some tasks belong to an archived project");
  }

  await prisma.$transaction(
    async (tx) => {
      for (const task of tasks) {
        if (input.action === "update") await applyUpdate(tx, actor, task, input.data ?? {});
        else if (input.action === "delete") {
          await softDelete(tx, task.id);
          await logActivity(tx, task.id, actor.userId, "deleted");
        } else {
          const archive = input.action === "archive";
          if (Boolean(task.archivedAt) === archive) continue;
          await tx.task.update({ where: { id: task.id }, data: { archivedAt: archive ? new Date() : null } });
          await logActivity(tx, task.id, actor.userId, archive ? "archived" : "unarchived");
        }
      }
    },
    { timeout: 20_000 }
  );

  await audit(req, {
    action: "task.bulk",
    organizationId: actor.tenant.organizationId,
    targetType: "task",
    metadata: { action: input.action, count: tasks.length, ids },
  });
  return { updated: tasks.length };
};
