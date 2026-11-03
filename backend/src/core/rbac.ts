import type { OrgRole } from "@prisma/client";
import type { RequestHandler } from "express";
import { forbidden } from "./errors";
import { currentTenant } from "./tenant";

/**
 * Permissions are defined in code (not database tables) so they are versioned,
 * reviewed and tested with the code that enforces them.
 */
export const PERMISSIONS = [
  "org:read",
  "org:update",
  "members:read",
  "members:invite",
  "members:manage", // change roles, remove members
  "invitations:manage",
  "audit:read",
  "tasks:read",
  "tasks:create",
  "tasks:update_any",
  "tasks:update_own",
  "tasks:delete_any",
  "tasks:delete_own",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const TASK_WORKER: Permission[] = ["tasks:read", "tasks:create", "tasks:update_any", "tasks:delete_any"];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  ORG_ADMIN: PERMISSIONS,
  PROJECT_MANAGER: ["org:read", "members:read", "members:invite", "invitations:manage", ...TASK_WORKER],
  TEAM_LEAD: ["org:read", "members:read", ...TASK_WORKER],
  MEMBER: ["org:read", "members:read", "tasks:read", "tasks:create", "tasks:update_own", "tasks:delete_own"],
  // Clients get access to specific projects in Phase 3; until then they see no internal work
  CLIENT: ["org:read"],
  VIEWER: ["org:read", "members:read", "tasks:read"],
};

export const ROLE_RANK: Record<OrgRole, number> = {
  ORG_ADMIN: 100,
  PROJECT_MANAGER: 80,
  TEAM_LEAD: 60,
  MEMBER: 40,
  CLIENT: 20,
  VIEWER: 10,
};

export const hasPermission = (role: OrgRole, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

/**
 * Prevents privilege escalation: only admins may grant any role;
 * everyone else may only grant roles strictly below their own.
 */
export const canAssignRole = (actorRole: OrgRole, targetRole: OrgRole): boolean =>
  actorRole === "ORG_ADMIN" || ROLE_RANK[targetRole] < ROLE_RANK[actorRole];

/** Route guard: passes if the caller's role has ANY of the listed permissions. Use after requireTenant. */
export const requirePermission =
  (...permissions: Permission[]): RequestHandler =>
  (req, _res, next) => {
    const { role } = currentTenant(req);
    if (!permissions.some((p) => hasPermission(role, p))) throw forbidden();
    next();
  };
