import { z } from "zod";
import { cuidSchema } from "../../core/schemas";

/**
 * The rule language. Everything a rule can say is defined here and validated on save;
 * the engine re-checks references (labels, people) when it runs, because they can change.
 */

const STATUS = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
const PRIORITY = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const userId = z.number().int().positive().max(2_147_483_647);

export const TRIGGERS = ["TASK_CREATED", "STATUS_CHANGED", "ASSIGNEE_CHANGED", "PRIORITY_CHANGED", "COMMENT_ADDED", "DUE_SOON", "OVERDUE"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const triggerConfigFor = (trigger: Trigger) => {
  switch (trigger) {
    case "STATUS_CHANGED":
      return z.object({ from: STATUS.optional(), to: STATUS.optional() }).strict().refine((c) => !c.from || !c.to || c.from !== c.to, "From and to must differ");
    case "PRIORITY_CHANGED":
      return z.object({ to: PRIORITY.optional() }).strict();
    case "DUE_SOON":
      return z.object({ days: z.number().int().min(0).max(30) }).strict();
    default:
      return z.object({}).strict();
  }
};

export const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("status"), op: z.enum(["is", "is_not"]), value: z.array(STATUS).min(1).max(4) }),
  z.object({ field: z.literal("priority"), op: z.enum(["is", "is_not"]), value: z.array(PRIORITY).min(1).max(4) }),
  z.object({ field: z.literal("assignee"), op: z.enum(["is_set", "is_not_set"]) }),
  /** A specific person (separate field name: a discriminated union needs one shape per field) */
  z.object({ field: z.literal("assignee_is"), value: userId }),
  z.object({ field: z.literal("label"), op: z.enum(["has", "has_not"]), value: cuidSchema }),
  z.object({ field: z.literal("title"), op: z.literal("contains"), value: z.string().trim().min(1).max(100) }),
  z.object({ field: z.literal("dueDate"), op: z.enum(["is_set", "is_not_set"]) }),
  z.object({ field: z.literal("subtask"), op: z.enum(["is", "is_not"]) }),
]);
export type Condition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SET_STATUS"), status: STATUS }),
  z.object({ type: z.literal("SET_PRIORITY"), priority: PRIORITY }),
  z.object({ type: z.literal("ASSIGN"), to: z.union([z.literal("creator"), z.literal("unassigned"), userId]) }),
  z.object({ type: z.literal("SET_DUE_DATE"), daysFromNow: z.number().int().min(0).max(365) }),
  z.object({ type: z.literal("ADD_LABEL"), labelId: cuidSchema }),
  z.object({ type: z.literal("REMOVE_LABEL"), labelId: cuidSchema }),
  z.object({ type: z.literal("ADD_COMMENT"), body: z.string().trim().min(1).max(2000) }),
  z.object({
    type: z.literal("NOTIFY"),
    to: z.union([z.literal("assignee"), z.literal("creator"), z.literal("watchers"), z.literal("project_managers"), userId]),
    message: z.string().trim().min(1).max(500),
  }),
]);
export type Action = z.infer<typeof actionSchema>;

export const ruleBody = z
  .object({
    name: z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(100),
    enabled: z.boolean().default(true),
    trigger: z.enum(TRIGGERS),
    triggerConfig: z.record(z.string(), z.unknown()).default({}),
    conditions: z.array(conditionSchema).max(10, "At most 10 conditions").default([]),
    actions: z.array(actionSchema).min(1, "Add at least one action").max(10, "At most 10 actions"),
  })
  .superRefine((r, ctx) => {
    const parsed = triggerConfigFor(r.trigger).safeParse(r.triggerConfig);
    if (!parsed.success) ctx.addIssue({ code: "custom", path: ["triggerConfig"], message: parsed.error.issues[0]?.message ?? "Invalid trigger options" });
    if (r.trigger === "DUE_SOON" && r.triggerConfig.days === undefined) ctx.addIssue({ code: "custom", path: ["triggerConfig"], message: "Say how many days before the due date" });
  });
export type RuleInput = z.infer<typeof ruleBody>;

export const ruleUpdateBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  trigger: z.enum(TRIGGERS).optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  conditions: z.array(conditionSchema).max(10).optional(),
  actions: z.array(actionSchema).min(1).max(10).optional(),
});

/** Events the engine reacts to. */
export interface AutomationEvent {
  eventId: string;
  orgId: string;
  projectId: string;
  taskId: number;
  trigger: Trigger;
  change?: { from?: unknown; to?: unknown };
  actorId: number | null;
  /** 0 when a person caused it; +1 for each automation in the chain */
  depth: number;
  /** Rules that led to this event, oldest first */
  chain: string[];
}
