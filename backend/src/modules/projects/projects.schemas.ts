import { z } from "zod";
import { ProjectRole, ProjectStatus, ProjectVisibility } from "@prisma/client";
import { cuidSchema } from "../../core/schemas";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" or ISO timestamp → Date; null/"" clears. Shared by projects, milestones and tasks. */
export const optionalDate = z
  .union([z.string().trim(), z.null()])
  .transform((value, ctx) => {
    if (value === null || value === "") return null;
    const date = new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return date;
  });

const name = z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(120, "Name must be at most 120 characters");
const description = z.union([z.string().trim().max(5000), z.null()]).transform((v) => (v === "" ? null : v));
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #6366f1");
const key = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,5}$/, "Key must be 2–6 letters or digits, starting with a letter");

export const createProjectBody = z.object({
  name,
  key: key.optional(),
  description: description.optional(),
  visibility: z.enum(ProjectVisibility).default("ORGANIZATION"),
  color: color.default("#6366f1"),
  startDate: optionalDate.optional(),
  dueDate: optionalDate.optional(),
  teamId: z.union([cuidSchema, z.null()]).optional(),
});

export const updateProjectBody = z
  .object({
    name: name.optional(),
    key: key.optional(),
    description: description.optional(),
    status: z.enum(ProjectStatus).optional(),
    visibility: z.enum(ProjectVisibility).optional(),
    color: color.optional(),
    startDate: optionalDate.optional(),
    dueDate: optionalDate.optional(),
    teamId: z.union([cuidSchema, z.null()]).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Provide at least one field to update" });

export const projectListQuery = z.object({
  status: z.enum(ProjectStatus).optional(),
  q: z.string().trim().max(100).optional(),
  includeArchived: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

export const projectParams = z.object({ projectId: cuidSchema });
export const projectMemberParams = z.object({
  projectId: cuidSchema,
  userId: z.coerce.number().int().positive().max(2_147_483_647),
});
export const milestoneParams = z.object({ projectId: cuidSchema, milestoneId: cuidSchema });

export const projectMemberBody = z.object({
  userId: z.coerce.number().int().positive().max(2_147_483_647),
  role: z.enum(ProjectRole).default("MEMBER"),
});

export const milestoneBody = z.object({
  name: name.optional(),
  description: description.optional(),
  dueDate: optionalDate.optional(),
  completed: z.boolean().optional(),
});
export const createMilestoneBody = milestoneBody.extend({ name });

export type CreateProjectInput = z.infer<typeof createProjectBody>;
export type UpdateProjectInput = z.infer<typeof updateProjectBody>;
export type MilestoneInput = z.infer<typeof milestoneBody>;
