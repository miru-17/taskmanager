import { randomUUID } from "node:crypto";
import { prisma } from "../../core/prisma";
import { enqueue } from "../../core/queue";
import { logger } from "../../core/logger";
import { currentAutomation } from "./context";
import type { AutomationEvent, Trigger } from "./definitions";

export const AUTOMATION_JOB = "automation.event";

/**
 * Queues an event for the automation engine, but only when the project has an enabled rule
 * for that trigger (so ordinary edits cost one indexed count). Inside an automation's actions
 * the event inherits the chain, which is what the loop guard reads.
 */
export const emitTrigger = async (e: { orgId: string; projectId: string; taskId: number; trigger: Trigger; change?: { from?: unknown; to?: unknown }; actorId: number | null; eventId?: string }) => {
  try {
    const rules = await prisma.automationRule.count({ where: { projectId: e.projectId, organizationId: e.orgId, trigger: e.trigger, enabled: true } });
    if (!rules) return;
    const ctx = currentAutomation();
    const event: AutomationEvent = {
      eventId: e.eventId ?? randomUUID(),
      orgId: e.orgId,
      projectId: e.projectId,
      taskId: e.taskId,
      trigger: e.trigger,
      change: e.change,
      actorId: e.actorId && e.actorId > 0 ? e.actorId : null,
      depth: ctx ? ctx.depth : 0,
      chain: ctx ? ctx.chain : [],
    };
    await enqueue(AUTOMATION_JOB, event);
  } catch (err) {
    // Automations never break the change that triggered them
    logger.error({ err, trigger: e.trigger }, "Could not queue automation event");
  }
};

/** The trigger events implied by one task's field changes. */
export const emitForChanges = async (orgId: string, projectId: string, taskId: number, actorId: number | null, changes: Record<string, { from: unknown; to: unknown }>) => {
  const map: [string, Trigger][] = [
    ["status", "STATUS_CHANGED"],
    ["assigneeId", "ASSIGNEE_CHANGED"],
    ["priority", "PRIORITY_CHANGED"],
  ];
  for (const [field, trigger] of map) {
    if (changes[field]) await emitTrigger({ orgId, projectId, taskId, trigger, change: changes[field], actorId });
  }
};
