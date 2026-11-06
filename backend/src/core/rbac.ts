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
  "projects:create",
  "projects:manage_any", // edit/archive any project and its members/milestones
  "teams:manage",
  "labels:manage",
  "templates:manage", // create/edit/delete task templates (using one only needs tasks:create)
  "analytics:read", // dashboards and exports, always limited to projects the caller can see
  "billing:manage", // plan, trial, Stripe checkout and billing portal (org admins only)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const TASK_WORKER: Permission[] = ["tasks:read", "tasks:create", "tasks:update_any", "tasks:delete_any", "labels:manage", "templates:manage", "analytics:read"];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  ORG_ADMIN: PERMISSIONS,
  PROJECT_MANAGER: [
    "org:read", "members:read", "members:invite", "invitations:manage",
    "projects:create", "projects:manage_any", "teams:manage", ...TASK_WORKER,
  ],
  TEAM_LEAD: ["org:read", "members:read", ...TASK_WORKER],
  MEMBER: ["org:read", "members:read", "tasks:read", "tasks:create", "tasks:update_own", "tasks:delete_own", "analytics:read"],
  // Clients can read tasks, but project access limits them to projects they were explicitly added to
  CLIENT: ["org:read", "tasks:read"],
  VIEWER: ["org:read", "members:read", "tasks:read", "analytics:read"],
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
