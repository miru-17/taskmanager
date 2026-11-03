import type { Prisma, ProjectRole } from "@prisma/client";
import { prisma } from "./prisma";
import { forbidden, notFound } from "./errors";
import { hasPermission } from "./rbac";
import type { TenantContext } from "./tenant";

export interface Actor {
  userId: number;
  tenant: TenantContext;
}

/** Org roles that see and manage every project in the organisation. */
const isOrgWide = (actor: Actor) => hasPermission(actor.tenant.role, "projects:manage_any");

/**
 * Prisma filter for "projects this actor may see". Used by every project AND task
 * query, so a project (and its tasks) outside this set behaves exactly like one
 * that doesn't exist.
 *
 * - Org admins / project managers: every project in the org
 * - Clients: only projects they were explicitly added to
 * - Everyone else: organisation-visible projects, plus private projects they are
 *   a member of or whose team they belong to
 */
export const projectAccessWhere = (actor: Actor): Prisma.ProjectWhereInput => {
  const { organizationId, role } = actor.tenant;
  if (isOrgWide(actor)) return { organizationId };
  if (role === "CLIENT") return { organizationId, members: { some: { userId: actor.userId } } };
  return {
    organizationId,
    OR: [
      { visibility: "ORGANIZATION" },
      { members: { some: { userId: actor.userId } } },
      { team: { members: { some: { userId: actor.userId } } } },
    ],
  };
};

export type TaskEditScope = "any" | "own" | "none";

export interface ProjectCapabilities {
  projectId: string;
  /** Edit project settings, members, milestones */
  manage: boolean;
  createTasks: boolean;
  editTasks: TaskEditScope;
  deleteTasks: TaskEditScope;
  projectRole: ProjectRole | null;
}

/**
 * Effective rights in one project = org role, adjusted by the project relationship:
 * a project MANAGER (or the lead of the project's team) works like a team lead there;
 * a project VIEWER (and any client) is read-only regardless of org role.
 */
export const resolveProjectAccess = async (actor: Actor, projectId: string): Promise<ProjectCapabilities> => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...projectAccessWhere(actor) },
    select: {
      id: true,
      ownerId: true,
      members: { where: { userId: actor.userId }, select: { role: true } },
      team: { select: { members: { where: { userId: actor.userId }, select: { role: true } } } },
    },
  });
  if (!project) throw notFound("Project not found");

  const { role } = actor.tenant;
  const projectRole = project.members[0]?.role ?? null;
  const teamLead = project.team?.members[0]?.role === "LEAD";

  if (isOrgWide(actor) || projectRole === "MANAGER" || project.ownerId === actor.userId) {
    return { projectId, manage: true, createTasks: true, editTasks: "any", deleteTasks: "any", projectRole };
  }
  if (role === "CLIENT" || projectRole === "VIEWER" || role === "VIEWER") {
    return { projectId, manage: false, createTasks: false, editTasks: "none", deleteTasks: "none", projectRole };
  }
  if (teamLead) {
    return { projectId, manage: false, createTasks: true, editTasks: "any", deleteTasks: "any", projectRole };
  }

  const scope = (action: "update" | "delete"): TaskEditScope =>
    hasPermission(role, `tasks:${action}_any`) ? "any" : hasPermission(role, `tasks:${action}_own`) ? "own" : "none";

  return {
    projectId,
    manage: false,
    createTasks: hasPermission(role, "tasks:create"),
    editTasks: scope("update"),
    deleteTasks: scope("delete"),
    projectRole,
  };
};

/**
 * "Own" means you created it — or, for edits, it's assigned to you
 * (a member should be able to move their assigned work forward).
 */
export const canTouchTask = (
  caps: ProjectCapabilities,
  actor: Actor,
  task: { createdById: number | null; assigneeId: number | null },
  action: "edit" | "delete"
): boolean => {
  const scope = action === "edit" ? caps.editTasks : caps.deleteTasks;
  if (scope === "any") return true;
  if (scope === "none") return false;
  return task.createdById === actor.userId || (action === "edit" && task.assigneeId === actor.userId);
};

export const assertTaskPermission = (
  caps: ProjectCapabilities,
  actor: Actor,
  task: { createdById: number | null; assigneeId: number | null },
  action: "edit" | "delete"
) => {
  if (canTouchTask(caps, actor, task, action)) return;
  const scope = action === "edit" ? caps.editTasks : caps.deleteTasks;
  throw forbidden(
    scope === "own"
      ? action === "edit"
        ? "You can only edit tasks you created or that are assigned to you"
        : "You can only delete tasks you created"
      : `You don't have permission to ${action} tasks in this project`
  );
};

/** Users that may be assigned / added in this org (must be members). */
export const assertOrgMember = async (organizationId: string, userId: number, what = "Assignee") => {
  const m = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (!m) throw forbidden(`${what} must be a member of this organization`);
  return m;
};
