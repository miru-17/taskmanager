import { prisma } from "../../core/prisma";
import { badRequest, notFound } from "../../core/errors";
import type { CreateTaskInput, UpdateTaskInput } from "./tasks.schemas";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A due date is "in the past" only if it is before yesterday (UTC).
 * The one-day tolerance covers every user time zone (UTC-12 … UTC+14), so a user
 * in IST picking "today" just after midnight is never rejected by a UTC server.
 */
const isPastDueDate = (date: Date): boolean => {
  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return date.getTime() < startOfTodayUtc - DAY_MS;
};

const sameInstant = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Every task query is scoped to its owner; another user's task is indistinguishable from a missing one. */
const findOwnedTask = async (userId: number, id: number) => {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw notFound("Task not found");
  return task;
};

export const listTasks = (userId: number) =>
  prisma.task.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });

export const getTask = (userId: number, id: number) => findOwnedTask(userId, id);

export const createTask = async (userId: number, input: CreateTaskInput) => {
  if (input.dueDate && isPastDueDate(input.dueDate)) {
    throw badRequest("Due date cannot be in the past");
  }

  return prisma.task.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      dueDate: input.dueDate ?? null,
      userId,
    },
  });
};

export const updateTask = async (userId: number, id: number, input: UpdateTaskInput) => {
  const existing = await findOwnedTask(userId, id);

  // Only validate the due date when it is actually being changed, so an overdue
  // task can still be edited or moved to DONE without touching its date.
  if (
    input.dueDate !== undefined &&
    input.dueDate !== null &&
    !sameInstant(input.dueDate, existing.dueDate) &&
    isPastDueDate(input.dueDate)
  ) {
    throw badRequest("Due date cannot be in the past");
  }

  // updateMany keeps the owner condition in the write itself (no check-then-act gap)
  const { count } = await prisma.task.updateMany({
    where: { id, userId },
    data: {
      title: input.title,
      description: input.description,
      status: input.status,
      dueDate: input.dueDate,
    },
  });
  if (count === 0) throw notFound("Task not found");

  return findOwnedTask(userId, id);
};

export const deleteTask = async (userId: number, id: number): Promise<void> => {
  const { count } = await prisma.task.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Task not found");
};
