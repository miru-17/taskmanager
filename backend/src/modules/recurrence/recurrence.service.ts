import { z } from "zod";
import { prisma } from "../../core/prisma";
import { badRequest } from "../../core/errors";
import type { Actor } from "../../core/access";
import { optionalDate } from "../projects/projects.schemas";
import { assertProjectWritable, editableTask, getTask } from "../tasks/tasks.service";
import { logActivity } from "../tasks/lifecycle";
import { describeRule, weekdayOf } from "./schedule";

export const recurrenceBody = z
  .object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.number().int().min(1).max(365).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    monthDay: z.number().int().min(1).max(31).nullable().optional(),
    endsOn: optionalDate.optional(),
    maxOccurrences: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .refine((r) => r.frequency === "WEEKLY" || r.weekdays.length === 0, { message: "Weekdays only apply to weekly repeats", path: ["weekdays"] });

export type RecurrenceInput = z.infer<typeof recurrenceBody>;

/**
 * Makes a task repeat. The next occurrence is created when this one is completed
 * (see lifecycle.afterCompletion), so there is no background job that could double-fire.
 */
export const setRecurrence = async (actor: Actor, taskId: number, input: RecurrenceInput) => {
  const { task } = await editableTask(actor, taskId);
  if (task.parentId) throw badRequest("Subtasks can't repeat; make the parent task repeat instead");
  if (task.archivedAt) throw badRequest("Unarchive this task first");
  if (task.status === "DONE") throw badRequest("Reopen the task before making it repeat");
  await assertProjectWritable(task.projectId);

  const anchor = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  if (input.endsOn && task.dueDate && input.endsOn < task.dueDate) throw badRequest("The end date must be after the task's due date");

  const rule = {
    frequency: input.frequency,
    interval: input.interval,
    weekdays: input.frequency === "WEEKLY" ? [...new Set(input.weekdays.length ? input.weekdays : [weekdayOf(anchor)])].sort() : [],
    monthDay: input.frequency === "MONTHLY" || input.frequency === "YEARLY" ? (input.monthDay ?? Number(anchor.slice(8))) : null,
    endsOn: input.endsOn ?? null,
    maxOccurrences: input.maxOccurrences ?? null,
  };

  await prisma.$transaction(async (tx) => {
    const current = task.seriesId ? await tx.recurrenceSeries.findUnique({ where: { id: task.seriesId } }) : null;
    if (current?.active) {
      await tx.recurrenceSeries.update({ where: { id: current.id }, data: rule });
    } else {
      const series = await tx.recurrenceSeries.create({ data: { ...rule, projectId: task.projectId, createdById: actor.userId } });
      await tx.task.update({ where: { id: taskId }, data: { seriesId: series.id } });
    }
    await logActivity(tx, taskId, actor.userId, "recurrence_set", { rule: describeRule(rule) });
  });
  return getTask(actor, taskId);
};

/** Stops the series. Occurrences already created stay as they are. */
export const clearRecurrence = async (actor: Actor, taskId: number) => {
  const { task } = await editableTask(actor, taskId);
  if (!task.seriesId) throw badRequest("This task doesn't repeat");
  await prisma.$transaction([
    prisma.recurrenceSeries.update({ where: { id: task.seriesId }, data: { active: false } }),
    prisma.task.update({ where: { id: taskId }, data: { seriesId: null } }),
  ]);
  await logActivity(prisma, taskId, actor.userId, "recurrence_stopped");
  return getTask(actor, taskId);
};
