import type { Request } from "express";
import { randomBytes } from "node:crypto";
import type { CustomField, CustomFieldType, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../core/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import { projectAccessWhere, resolveProjectAccess, type Actor } from "../../core/access";

type Db = Prisma.TransactionClient | typeof prisma;

export interface FieldOption {
  id: string;
  label: string;
  color: string;
}

const MAX_FIELDS_PER_PROJECT = 50;
const MAX_OPTIONS = 100;

const optionInput = z.object({
  id: z.string().regex(/^opt_[a-z0-9]{8,16}$/).optional(),
  label: z.string().trim().min(1, "Option label is required").max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
});

export const fieldBody = z.object({
  name: z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(60),
  type: z.enum(["TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT", "CHECKBOX", "URL", "USER"]),
  options: z.array(optionInput).max(MAX_OPTIONS).optional(),
  required: z.boolean().default(false),
  description: z.union([z.string().trim().max(300), z.null()]).optional(),
  position: z.number().finite().optional(),
});
export const fieldUpdateBody = fieldBody.omit({ type: true }).partial();

const isSelect = (t: CustomFieldType) => t === "SELECT" || t === "MULTI_SELECT";
const optionsOf = (f: Pick<CustomField, "options">): FieldOption[] => (Array.isArray(f.options) ? (f.options as unknown as FieldOption[]) : []);
const newOptionId = () => `opt_${randomBytes(6).toString("hex")}`;

const normalizeOptions = (type: CustomFieldType, input: z.infer<typeof optionInput>[] | undefined): FieldOption[] | null => {
  if (!isSelect(type)) {
    if (input?.length) throw badRequest("Only select fields have options");
    return null;
  }
  const opts = (input ?? []).map((o) => ({ id: o.id ?? newOptionId(), label: o.label, color: o.color }));
  if (!opts.length) throw badRequest("Select fields need at least one option");
  const labels = new Set(opts.map((o) => o.label.toLowerCase()));
  if (labels.size !== opts.length) throw badRequest("Option labels must be unique");
  return opts;
};

// ─── Values ──────────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates one value against its field and returns the JSON to store,
 * or null to clear it. All checks run server-side; the client is only a hint.
 */
export const normalizeValue = async (field: CustomField, raw: unknown, organizationId: string): Promise<Prisma.InputJsonValue | null> => {
  if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) return null;
  const bad = (msg: string) => badRequest(`${field.name}: ${msg}`);
  switch (field.type) {
    case "TEXT":
      if (typeof raw !== "string") throw bad("must be text");
      if (raw.length > 2000) throw bad("is too long (max 2000 characters)");
      return raw.trim() || null;
    case "NUMBER": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) throw bad("must be a number");
      if (Math.abs(n) > 1e12) throw bad("is out of range");
      return n;
    }
    case "DATE":
      if (typeof raw !== "string" || !DATE_ONLY.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) throw bad("must be a date (YYYY-MM-DD)");
      return raw;
    case "CHECKBOX":
      if (typeof raw !== "boolean") throw bad("must be true or false");
      return raw;
    case "URL": {
      if (typeof raw !== "string" || raw.length > 2000) throw bad("must be a link");
      let url: URL;
      try {
        url = new URL(raw.trim());
      } catch {
        throw bad("must be a valid link");
      }
      // No javascript:, data: or file: links — they'd be clickable in the UI
      if (url.protocol !== "https:" && url.protocol !== "http:") throw bad("must start with http:// or https://");
      return url.toString();
    }
    case "SELECT": {
      if (typeof raw !== "string" || !optionsOf(field).some((o) => o.id === raw)) throw bad("isn't one of the options");
      return raw;
    }
    case "MULTI_SELECT": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) throw bad("must be a list of options");
      const ids = [...new Set(raw as string[])];
      const valid = new Set(optionsOf(field).map((o) => o.id));
      if (ids.some((id) => !valid.has(id))) throw bad("contains an unknown option");
      return ids;
    }
    case "USER": {
      const id = typeof raw === "string" ? Number(raw) : raw;
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) throw bad("must be a person");
      const member = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: id } } });
      if (!member) throw bad("must be a member of this organization");
      return id;
    }
  }
};

/**
 * Applies `{ fieldId: value | null }` to a task. Fields must belong to the task's project;
 * required fields can't be cleared. Returns a history entry keyed by field name.
 */
export const writeFieldValues = async (
  db: Db,
  task: { id: number; projectId: string; organizationId: string },
  input: Record<string, unknown>,
  opts: { creating: boolean }
): Promise<Record<string, { from: unknown; to: unknown }>> => {
  const fields = await db.customField.findMany({ where: { projectId: task.projectId } });
  const byId = new Map(fields.map((f) => [f.id, f]));
  const unknown = Object.keys(input).filter((id) => !byId.has(id));
  if (unknown.length) throw badRequest("Some custom fields don't belong to this project");

  if (opts.creating) {
    const missing = fields.filter((f) => f.required && (input[f.id] === undefined || input[f.id] === null || input[f.id] === ""));
    if (missing.length) throw badRequest(`Required field${missing.length > 1 ? "s" : ""} missing: ${missing.map((f) => f.name).join(", ")}`);
  }

  const existing = opts.creating ? [] : await db.taskFieldValue.findMany({ where: { taskId: task.id } });
  const current = new Map(existing.map((v) => [v.fieldId, v.value]));
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [fieldId, raw] of Object.entries(input)) {
    const field = byId.get(fieldId)!;
    const value = await normalizeValue(field, raw, task.organizationId);
    if (value === null && field.required) throw badRequest(`${field.name} is required`);
    const before = current.get(fieldId) ?? null;
    if (JSON.stringify(before) === JSON.stringify(value)) continue;
    if (value === null) await db.taskFieldValue.deleteMany({ where: { taskId: task.id, fieldId } });
    else
      await db.taskFieldValue.upsert({
        where: { taskId_fieldId: { taskId: task.id, fieldId } },
        create: { taskId: task.id, fieldId, value },
        update: { value },
      });
    changes[`field:${field.name}`] = { from: before, to: value };
  }
  return changes;
};

// ─── Definitions ─────────────────────────────────────────────────────────────

const requireManage = async (actor: Actor, projectId: string) => {
  const caps = await resolveProjectAccess(actor, projectId);
  if (!caps.manage) throw forbidden("Only project managers can change custom fields");
};

export const listFields = async (actor: Actor, projectId: string) => {
  const visible = await prisma.project.count({ where: { id: projectId, ...projectAccessWhere(actor) } });
  if (!visible) throw notFound("Project not found");
  return prisma.customField.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
};

export const createField = async (req: Request, actor: Actor, projectId: string, input: z.infer<typeof fieldBody>) => {
  await requireManage(actor, projectId);
  const count = await prisma.customField.count({ where: { projectId } });
  if (count >= MAX_FIELDS_PER_PROJECT) throw badRequest(`A project can have at most ${MAX_FIELDS_PER_PROJECT} custom fields`);
  if (await prisma.customField.findFirst({ where: { projectId, name: { equals: input.name, mode: "insensitive" } } })) throw conflict("A field with that name already exists");

  const field = await prisma.customField.create({
    data: {
      projectId,
      name: input.name,
      type: input.type,
      options: (normalizeOptions(input.type, input.options) ?? undefined) as Prisma.InputJsonValue | undefined,
      required: input.required,
      description: input.description ?? null,
      position: input.position ?? (count + 1) * 1024,
    },
  });
  await audit(req, { action: "custom_field.created", organizationId: actor.tenant.organizationId, targetType: "custom_field", targetId: field.id, metadata: { projectId, name: field.name, type: field.type } });
  return field;
};

export const updateField = async (req: Request, actor: Actor, projectId: string, fieldId: string, input: z.infer<typeof fieldUpdateBody>) => {
  await requireManage(actor, projectId);
  const field = await prisma.customField.findFirst({ where: { id: fieldId, projectId } });
  if (!field) throw notFound("Field not found");
  if (input.name && input.name.toLowerCase() !== field.name.toLowerCase()) {
    if (await prisma.customField.findFirst({ where: { projectId, name: { equals: input.name, mode: "insensitive" }, id: { not: fieldId } } })) throw conflict("A field with that name already exists");
  }

  const options = input.options !== undefined ? normalizeOptions(field.type, input.options) : undefined;
  const updated = await prisma.$transaction(async (tx) => {
    // Removing an option removes it from every task that had it selected
    if (options) {
      const kept = new Set(options.map((o) => o.id));
      const removed = optionsOf(field).filter((o) => !kept.has(o.id)).map((o) => o.id);
      if (removed.length) {
        const values = await tx.taskFieldValue.findMany({ where: { fieldId } });
        for (const v of values) {
          if (field.type === "SELECT" && removed.includes(v.value as string)) await tx.taskFieldValue.delete({ where: { taskId_fieldId: { taskId: v.taskId, fieldId } } });
          if (field.type === "MULTI_SELECT") {
            const next = (v.value as string[]).filter((id) => !removed.includes(id));
            if (next.length !== (v.value as string[]).length) {
              if (next.length) await tx.taskFieldValue.update({ where: { taskId_fieldId: { taskId: v.taskId, fieldId } }, data: { value: next } });
              else await tx.taskFieldValue.delete({ where: { taskId_fieldId: { taskId: v.taskId, fieldId } } });
            }
          }
        }
      }
    }
    return tx.customField.update({
      where: { id: fieldId },
      data: {
        name: input.name,
        required: input.required,
        description: input.description,
        position: input.position,
        ...(options ? { options: options as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  });
  await audit(req, { action: "custom_field.updated", organizationId: actor.tenant.organizationId, targetType: "custom_field", targetId: fieldId, metadata: { projectId } });
  return updated;
};

export const deleteField = async (req: Request, actor: Actor, projectId: string, fieldId: string) => {
  await requireManage(actor, projectId);
  const field = await prisma.customField.findFirst({ where: { id: fieldId, projectId } });
  if (!field) throw notFound("Field not found");
  await prisma.customField.delete({ where: { id: fieldId } });
  await audit(req, { action: "custom_field.deleted", organizationId: actor.tenant.organizationId, targetType: "custom_field", targetId: fieldId, metadata: { projectId, name: field.name } });
};
