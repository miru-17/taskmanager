import { z } from "zod";
import { Priority, Status } from "@prisma/client";
import { cuidSchema } from "../../core/schemas";
import { optionalDate } from "../projects/projects.schemas";

export const TASK_STATUSES = Object.values(Status);

const statusSchema = z.enum(Status, { error: `Invalid status. Allowed values are ${Object.values(Status).join(", ")}.` });
const prioritySchema = z.enum(Priority, { error: `Invalid priority. Allowed values are ${Object.values(Priority).join(", ")}.` });

const titleSchema = z
  .string({ error: "Title is required" })
  .trim()
  .min(1, "Title is required")
  .max(200, "Title must be at most 200 characters");

const descriptionSchema = z
  .union([z.string().trim().max(20000, "Description is too long"), z.null()])
  .transform((v) => (v === "" ? null : v));

const intId = z.coerce.number().int().positive().max(2_147_483_647);
const nullableIntId = z.union([intId, z.null()]);
const hours = z.union([z.number().min(0, "Hours can't be negative").max(10000), z.null()]);

const fields = {
  title: titleSchema,
  description: descriptionSchema,
  status: statusSchema,
  priority: prioritySchema,
  assigneeId: nullableIntId,
  parentId: nullableIntId,
  milestoneId: z.union([cuidSchema, z.null()]),
  startDate: optionalDate,
  dueDate: optionalDate,
  estimateHours: hours,
  actualHours: hours,
  position: z.number().finite(),
  labelIds: z.array(cuidSchema).max(20, "At most 20 labels per task"),
};

export const createTaskBody = z.object({
  title: fields.title,
  description: fields.description.optional(),
  status: fields.status.optional(),
  priority: fields.priority.optional(),
  /** Optional for backwards compatibility: falls back to the organisation's oldest active project */
  projectId: cuidSchema.optional(),
  assigneeId: fields.assigneeId.optional(),
  parentId: fields.parentId.optional(),
  milestoneId: fields.milestoneId.optional(),
  startDate: fields.startDate.optional(),
  dueDate: fields.dueDate.optional(),
  estimateHours: fields.estimateHours.optional(),
  actualHours: fields.actualHours.optional(),
  labelIds: fields.labelIds.optional(),
});

export const updateTaskBody = z
  .object({
    title: fields.title.optional(),
    description: fields.description.optional(),
    status: fields.status.optional(),
    priority: fields.priority.optional(),
    assigneeId: fields.assigneeId.optional(),
    parentId: fields.parentId.optional(),
    milestoneId: fields.milestoneId.optional(),
    startDate: fields.startDate.optional(),
    dueDate: fields.dueDate.optional(),
    estimateHours: fields.estimateHours.optional(),
    actualHours: fields.actualHours.optional(),
    position: fields.position.optional(),
    labelIds: fields.labelIds.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Provide at least one field to update" });

/** Comma-separated list in a query string → array of enum values. */
const csvEnum = <T extends string>(values: readonly T[], label: string) =>
  z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values as [T, ...T[]], { error: `Invalid ${label}` })).min(1));

export const SORTABLE = ["createdAt", "updatedAt", "dueDate", "startDate", "priority", "position", "title", "number", "status"] as const;

export const listTasksQuery = z.object({
  projectId: cuidSchema.optional(),
  status: csvEnum(TASK_STATUSES, "status").optional(),
  priority: csvEnum(Object.values(Priority), "priority").optional(),
  assigneeId: z.union([z.literal("me"), z.literal("none"), intId]).optional(),
  createdById: z.union([z.literal("me"), intId]).optional(),
  labelId: cuidSchema.optional(),
  milestoneId: z.union([z.literal("none"), cuidSchema]).optional(),
  /** "none" = top-level tasks only; a number = subtasks of that task; omitted = everything */
  parentId: z.union([z.literal("none"), intId]).optional(),
  q: z.string().trim().max(200).optional(),
  dueFrom: optionalDate.optional(),
  dueTo: optionalDate.optional(),
  overdue: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
  watching: z.enum(["true"]).transform(() => true).optional(),
  sort: z.enum(SORTABLE).default("position"),
  order: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const bulkBody = z.object({
  ids: z.array(intId).min(1, "Select at least one task").max(200, "At most 200 tasks at a time"),
  action: z.enum(["update", "archive", "unarchive", "delete"]),
  data: z
    .object({
      status: fields.status.optional(),
      priority: fields.priority.optional(),
      assigneeId: fields.assigneeId.optional(),
      milestoneId: fields.milestoneId.optional(),
      dueDate: fields.dueDate.optional(),
      addLabelIds: fields.labelIds.optional(),
      removeLabelIds: fields.labelIds.optional(),
    })
    .optional(),
});

export const taskIdParams = z.object({ id: intId });
export const dependencyBody = z.object({ dependsOnId: intId });
export const dependencyParams = z.object({ id: intId, dependsOnId: intId });
export const checklistBody = z.object({ text: z.string().trim().min(1, "Text is required").max(500) });
export const checklistUpdateBody = z
  .object({ text: z.string().trim().min(1).max(500).optional(), done: z.boolean().optional(), position: z.number().finite().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Provide at least one field to update" });
export const checklistParams = z.object({ id: intId, itemId: cuidSchema });

export type CreateTaskInput = z.infer<typeof createTaskBody>;
export type UpdateTaskInput = z.infer<typeof updateTaskBody>;
export type ListTasksQuery = z.infer<typeof listTasksQuery>;
export type BulkInput = z.infer<typeof bulkBody>;
