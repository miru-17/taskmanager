import { z } from "zod";

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;

const statusSchema = z.enum(TASK_STATUSES, {
  error: "Invalid status. Allowed values are TODO, IN_PROGRESS, DONE.",
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts "YYYY-MM-DD", a full ISO timestamp, null or "" (clears the date).
 * Date-only values are stored at UTC midnight so they mean the same calendar day everywhere.
 */
const dueDateSchema = z
  .union([z.string().trim(), z.null()])
  .transform((value, ctx) => {
    if (value === null || value === "") return null;
    const date = new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid due date" });
      return z.NEVER;
    }
    return date;
  });

const titleSchema = z
  .string({ error: "Title is required" })
  .trim()
  .min(1, "Title is required")
  .max(200, "Title must be at most 200 characters");

const descriptionSchema = z
  .union([z.string().trim().max(5000, "Description must be at most 5000 characters"), z.null()])
  .transform((v) => (v === "" ? null : v));

export const createTaskBody = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  status: statusSchema.optional(),
  dueDate: dueDateSchema.optional(),
});

export const updateTaskBody = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    status: statusSchema.optional(),
    dueDate: dueDateSchema.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "Provide at least one field to update",
  });

export type CreateTaskInput = z.infer<typeof createTaskBody>;
export type UpdateTaskInput = z.infer<typeof updateTaskBody>;
