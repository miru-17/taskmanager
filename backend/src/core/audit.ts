import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.account_locked"
  | "auth.logout"
  | "auth.logout_all"
  | "auth.refresh_reuse_detected"
  | "auth.email_verified"
  | "auth.password_reset_requested"
  | "auth.password_reset"
  | "auth.password_changed"
  | "session.revoked"
  | "org.created"
  | "org.updated"
  | "org.switched"
  | "member.role_changed"
  | "member.removed"
  | "member.left"
  | "member.joined"
  | "invitation.created"
  | "invitation.revoked"
  | "task.deleted"
  | "task.bulk"
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "project.deleted"
  | "project.member_set"
  | "project.member_removed"
  | "team.created"
  | "team.updated"
  | "team.deleted"
  | "team.member_set"
  | "team.member_removed";

interface AuditEntry {
  action: AuditAction;
  actorId?: number | null;
  organizationId?: string | null;
  targetType?: string;
  targetId?: string | number;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes an audit record. Failures are logged but never break the user's request:
 * the action itself has already been validated and committed.
 */
export const audit = async (req: Request | null, entry: AuditEntry): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? req?.auth?.userId ?? null,
        organizationId: entry.organizationId ?? null,
        targetType: entry.targetType,
        targetId: entry.targetId !== undefined ? String(entry.targetId) : undefined,
        metadata: entry.metadata,
        ipAddress: req?.ip?.slice(0, 64),
        userAgent: req?.get("user-agent")?.slice(0, 256),
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "Failed to write audit log");
  }
};
