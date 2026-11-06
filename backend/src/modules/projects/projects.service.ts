import type { Request } from "express";
import type { Prisma, ProjectRole, ProjectStatus } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import { hasPermission } from "../../core/rbac";
import { assertOrgMember, projectAccessWhere, resolveProjectAccess, type Actor } from "../../core/access";
import { removeStoredFiles, storageKeysForProject } from "../attachments/attachments.service";
import { assertCanAddProject, lockOrg } from "../../core/plans";
import type { CreateProjectInput, MilestoneInput, UpdateProjectInput } from "./projects.schemas";

const DAY_MS = 86_400_000;
const startOfTodayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

/** "Website Redesign" → "WR"; "Payments" → "PAY" */
export const suggestKey = (name: string): string => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : (words[0] ?? "PRJ").slice(0, 3);
  return /^[A-Z]/.test(key) && key.length >= 2 ? key : `P${key}`.slice(0, 4).padEnd(2, "X");
};

/** Every new organisation starts with one shared project so there is somewhere to put tasks. */
export const createDefaultProject = (tx: Prisma.TransactionClient, organizationId: string, ownerId: number) =>
  tx.project.create({
    data: { organizationId, key: "GEN", name: "General", description: "Default project for general work", ownerId },
  });

// ─── Progress & health ───────────────────────────────────────────────────────

export interface ProjectStats {
  total: number;
  done: number;
  open: number;
  overdue: number;
  progress: number; // 0..1
}

export type ProjectHealth = "on_track" | "at_risk" | "off_track" | "completed" | "on_hold";

/**
 * Transparent, rule-based health so people can see *why* a project is flagged:
 * - off track: past its due date and unfinished, or ≥25% of open tasks overdue
 * - at risk:   any overdue task, or progress lags elapsed time by more than 20 points
 */
export const computeHealth = (
  p: { status: ProjectStatus; startDate: Date | null; dueDate: Date | null },
  s: ProjectStats,
  now = new Date()
): ProjectHealth => {
  if (p.status === "COMPLETED") return "completed";
  if (p.status === "ON_HOLD") return "on_hold";
  if (p.dueDate && p.dueDate.getTime() + DAY_MS <= now.getTime() && s.open > 0) return "off_track";
  if (s.open > 0 && s.overdue / s.open >= 0.25) return "off_track";
  if (p.startDate && p.dueDate && p.dueDate > p.startDate) {
    const elapsed = Math.min(1, Math.max(0, (now.getTime() - p.startDate.getTime()) / (p.dueDate.getTime() - p.startDate.getTime())));
    if (elapsed - s.progress > 0.2) return "at_risk";
  }
  if (s.overdue > 0) return "at_risk";
  return "on_track";
};

/** Counts for many projects in two grouped queries (no N+1). Subtasks count toward progress. */
export const statsFor = async (projectIds: string[]): Promise<Map<string, ProjectStats>> => {
  const base = { projectId: { in: projectIds }, deletedAt: null, archivedAt: null };
  const [byStatus, overdue] = await Promise.all([
    prisma.task.groupBy({ by: ["projectId", "status"], where: base, _count: { _all: true } }),
    prisma.task.groupBy({
      by: ["projectId"],
      where: { ...base, status: { not: "DONE" }, dueDate: { lt: startOfTodayUtc() } },
      _count: { _all: true },
    }),
  ]);

  const map = new Map<string, ProjectStats>();
  for (const id of projectIds) map.set(id, { total: 0, done: 0, open: 0, overdue: 0, progress: 0 });
  for (const row of byStatus) {
    const s = map.get(row.projectId)!;
    s.total += row._count._all;
    if (row.status === "DONE") s.done += row._count._all;
  }
  for (const row of overdue) map.get(row.projectId)!.overdue = row._count._all;
  for (const s of map.values()) {
    s.open = s.total - s.done;
    s.progress = s.total ? Math.round((s.done / s.total) * 1000) / 1000 : 0;
  }
  return map;
};

// ─── Projects ────────────────────────────────────────────────────────────────

const projectSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  status: true,
  visibility: true,
  color: true,
  startDate: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, email: true, name: true } },
  team: { select: { id: true, name: true } },
  completionApproval: true,
  _count: { select: { members: true, milestones: true } },
} as const;

export const listProjects = async (actor: Actor, filter: { status?: ProjectStatus; q?: string; includeArchived?: boolean }) => {
  const where: Prisma.ProjectWhereInput = {
    AND: [
      projectAccessWhere(actor),
      filter.status ? { status: filter.status } : filter.includeArchived ? {} : { status: { not: "ARCHIVED" } },
      filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { key: { contains: filter.q, mode: "insensitive" } }] } : {},
    ],
  };
  const projects = await prisma.project.findMany({ where, orderBy: [{ status: "asc" }, { name: "asc" }], select: projectSelect, take: 500 });
  const stats = await statsFor(projects.map((p) => p.id));
  return projects.map((p) => {
    const s = stats.get(p.id)!;
    return { ...p, stats: s, health: computeHealth(p, s) };
  });
};

export const getProject = async (actor: Actor, projectId: string) => {
  const caps = await resolveProjectAccess(actor, projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: projectSelect });
  const s = (await statsFor([projectId])).get(projectId)!;
  return { ...project, stats: s, health: computeHealth(project, s), capabilities: caps };
};

const assertKeyAvailable = async (organizationId: string, key: string, exceptId?: string) => {
  const clash = await prisma.project.findFirst({ where: { organizationId, key, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw conflict(`Another project already uses the key ${key}`);
};

const assertTeamInOrg = async (organizationId: string, teamId: string | null | undefined) => {
  if (!teamId) return;
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId } });
  if (!team) throw badRequest("Team not found in this organization");
};

const assertDates = (start?: Date | null, due?: Date | null) => {
  if (start && due && due < start) throw badRequest("Due date must be on or after the start date");
};

export const createProject = async (req: Request, actor: Actor, input: CreateProjectInput) => {
  const { organizationId } = actor.tenant;
  const key = input.key ?? suggestKey(input.name);
  await assertKeyAvailable(organizationId, key);
  await assertTeamInOrg(organizationId, input.teamId);
  assertDates(input.startDate, input.dueDate);

  const project = await prisma.$transaction(async (tx) => {
    await lockOrg(tx, organizationId, "projects");
    await assertCanAddProject(organizationId, tx);
    const created = await tx.project.create({
      data: {
        organizationId,
        key,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility,
        color: input.color,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        teamId: input.teamId ?? null,
        ownerId: actor.userId,
      },
    });
    // The creator manages their project even if their org role is later changed
    await tx.projectMember.create({ data: { projectId: created.id, userId: actor.userId, role: "MANAGER" } });
    return created;
  });

  await audit(req, { action: "project.created", organizationId, targetType: "project", targetId: project.id, metadata: { key, name: input.name } });
  return getProject(actor, project.id);
};

const requireManage = async (actor: Actor, projectId: string) => {
  const caps = await resolveProjectAccess(actor, projectId);
  if (!caps.manage) throw forbidden("Only project managers can change this project");
  return caps;
};

export const updateProject = async (req: Request, actor: Actor, projectId: string, input: UpdateProjectInput) => {
  await requireManage(actor, projectId);
  const { organizationId } = actor.tenant;
  const current = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  if (input.key && input.key !== current.key) await assertKeyAvailable(organizationId, input.key, projectId);
  if (input.teamId !== undefined) await assertTeamInOrg(organizationId, input.teamId);
  assertDates(
    input.startDate !== undefined ? input.startDate : current.startDate,
    input.dueDate !== undefined ? input.dueDate : current.dueDate
  );

  // Bringing a project back from the archive counts against the plan again
  if (current.status === "ARCHIVED" && input.status && input.status !== "ARCHIVED") await assertCanAddProject(organizationId);
  await prisma.project.update({ where: { id: projectId }, data: input });
  if (input.completionApproval && input.completionApproval !== current.completionApproval) {
    await audit(req, { action: "project.approval_policy_changed", organizationId, targetType: "project", targetId: projectId, metadata: { from: current.completionApproval, to: input.completionApproval } });
  }
  await audit(req, {
    action: input.status === "ARCHIVED" ? "project.archived" : "project.updated",
    organizationId,
    targetType: "project",
    targetId: projectId,
    metadata: JSON.parse(JSON.stringify(input)),
  });
  return getProject(actor, projectId);
};

/** Permanent deletion: org admins only, and only once a project has been archived. */
export const deleteProject = async (req: Request, actor: Actor, projectId: string) => {
  if (actor.tenant.role !== "ORG_ADMIN") throw forbidden("Only organization admins can delete projects");
  await resolveProjectAccess(actor, projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.status !== "ARCHIVED") throw badRequest("Archive the project before deleting it");

  // Database rows cascade; stored files are removed once the delete has committed
  const fileKeys = await storageKeysForProject(projectId);
  await prisma.project.delete({ where: { id: projectId } });
  await removeStoredFiles(fileKeys);
  await audit(req, { action: "project.deleted", organizationId: actor.tenant.organizationId, targetType: "project", targetId: projectId, metadata: { key: project.key, name: project.name } });
};

// ─── Project members ─────────────────────────────────────────────────────────

export const listProjectMembers = async (actor: Actor, projectId: string) => {
  await resolveProjectAccess(actor, projectId);
  const rows = await prisma.projectMember.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { role: true, createdAt: true, user: { select: { id: true, email: true, name: true } } },
  });
  return rows.map((r) => ({ userId: r.user.id, email: r.user.email, name: r.user.name, role: r.role, addedAt: r.createdAt }));
};

export const upsertProjectMember = async (req: Request, actor: Actor, projectId: string, userId: number, role: ProjectRole) => {
  await requireManage(actor, projectId);
  const membership = await assertOrgMember(actor.tenant.organizationId, userId, "User");
  // A client can never be made a project manager
  if (membership.role === "CLIENT" && role === "MANAGER") throw badRequest("Clients can't manage projects");

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId, role },
    update: { role },
  });
  await audit(req, { action: "project.member_set", organizationId: actor.tenant.organizationId, targetType: "project", targetId: projectId, metadata: { userId, role } });
  return listProjectMembers(actor, projectId);
};

export const removeProjectMember = async (req: Request, actor: Actor, projectId: string, userId: number) => {
  await requireManage(actor, projectId);
  const { count } = await prisma.projectMember.deleteMany({ where: { projectId, userId } });
  if (count === 0) throw notFound("Member not found");
  await audit(req, { action: "project.member_removed", organizationId: actor.tenant.organizationId, targetType: "project", targetId: projectId, metadata: { userId } });
};

// ─── Milestones ──────────────────────────────────────────────────────────────

export const listMilestones = async (actor: Actor, projectId: string) => {
  await resolveProjectAccess(actor, projectId);
  const [milestones, counts] = await Promise.all([
    prisma.milestone.findMany({ where: { projectId }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] }),
    prisma.task.groupBy({
      by: ["milestoneId", "status"],
      where: { projectId, milestoneId: { not: null }, deletedAt: null, archivedAt: null },
      _count: { _all: true },
    }),
  ]);
  return milestones.map((m) => {
    const rows = counts.filter((c) => c.milestoneId === m.id);
    const total = rows.reduce((n, r) => n + r._count._all, 0);
    const done = rows.filter((r) => r.status === "DONE").reduce((n, r) => n + r._count._all, 0);
    return { ...m, stats: { total, done, progress: total ? Math.round((done / total) * 1000) / 1000 : 0 } };
  });
};

const findMilestone = async (projectId: string, milestoneId: string) => {
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId } });
  if (!m) throw notFound("Milestone not found");
  return m;
};

export const createMilestone = async (actor: Actor, projectId: string, input: MilestoneInput) => {
  await requireManage(actor, projectId);
  return prisma.milestone.create({
    data: { projectId, name: input.name!, description: input.description ?? null, dueDate: input.dueDate ?? null, completedAt: input.completed ? new Date() : null },
  });
};

export const updateMilestone = async (actor: Actor, projectId: string, milestoneId: string, input: MilestoneInput) => {
  await requireManage(actor, projectId);
  const current = await findMilestone(projectId, milestoneId);
  return prisma.milestone.update({
    where: { id: milestoneId },
    data: {
      name: input.name,
      description: input.description,
      dueDate: input.dueDate,
      completedAt: input.completed === undefined ? undefined : input.completed ? (current.completedAt ?? new Date()) : null,
    },
  });
};

export const deleteMilestone = async (actor: Actor, projectId: string, milestoneId: string) => {
  await requireManage(actor, projectId);
  await findMilestone(projectId, milestoneId);
  await prisma.milestone.delete({ where: { id: milestoneId } });
};

export const canCreateProjects = (actor: Actor) => hasPermission(actor.tenant.role, "projects:create");
