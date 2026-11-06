import { createDefaultProject } from "../projects/projects.service";
import type { Request } from "express";
import type { OrgRole } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { config } from "../../core/config";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../core/errors";
import { randomToken, sha256 } from "../../core/crypto";
import { sendMail } from "../../core/mailer";
import { audit } from "../../core/audit";
import { canAssignRole } from "../../core/rbac";
import { requireVerifiedEmail } from "../../core/auth";
import type { TenantContext } from "../../core/tenant";
import { assertCanInvite, assertSeatFree, changesSeatKind, lockOrg } from "../../core/plans";
import { makeSlug } from "./slug";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ROLE_LABEL: Record<OrgRole, string> = {
  ORG_ADMIN: "Organization Admin",
  PROJECT_MANAGER: "Project Manager",
  TEAM_LEAD: "Team Lead",
  MEMBER: "Team Member",
  CLIENT: "Client",
  VIEWER: "Viewer",
};

// ─── Organisations ───────────────────────────────────────────────────────────

export const createOrganization = async (req: Request, userId: number, name: string) => {
  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({ data: { name, slug: makeSlug(name) } });
    await tx.membership.create({ data: { organizationId: created.id, userId, role: "ORG_ADMIN" } });
    await createDefaultProject(tx, created.id, userId);
    return created;
  });
  await audit(req, { action: "org.created", organizationId: org.id, targetType: "organization", targetId: org.id });
  return org;
};

export const getOrganization = async (tenant: TenantContext) => {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: tenant.organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: { select: { memberships: true, tasks: true } },
    },
  });
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt,
    memberCount: org._count.memberships,
    taskCount: org._count.tasks,
    role: tenant.role,
  };
};

export const updateOrganization = async (req: Request, tenant: TenantContext, data: { name: string }) => {
  const org = await prisma.organization.update({
    where: { id: tenant.organizationId },
    data: { name: data.name },
    select: { id: true, name: true, slug: true },
  });
  await audit(req, {
    action: "org.updated",
    organizationId: tenant.organizationId,
    targetType: "organization",
    targetId: org.id,
    metadata: { name: data.name },
  });
  return org;
};

// ─── Members ─────────────────────────────────────────────────────────────────

export const listMembers = (tenant: TenantContext) =>
  prisma.membership
    .findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    })
    .then((rows) =>
      rows.map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name, role: m.role, joinedAt: m.createdAt }))
    );

const findMember = async (organizationId: string, userId: number) => {
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!membership) throw notFound("Member not found");
  return membership;
};

const countAdmins = (organizationId: string) =>
  prisma.membership.count({ where: { organizationId, role: "ORG_ADMIN" } });

export const changeMemberRole = async (
  req: Request,
  tenant: TenantContext,
  actorId: number,
  targetUserId: number,
  role: OrgRole
) => {
  const target = await findMember(tenant.organizationId, targetUserId);
  if (target.role === role) return { userId: targetUserId, role };

  // Never leave an organisation without an admin
  if (target.role === "ORG_ADMIN" && (await countAdmins(tenant.organizationId)) <= 1) {
    throw badRequest("An organization needs at least one admin. Promote someone else first.");
  }

  // Moving someone between internal and client seats needs a free seat of the new kind
  if (changesSeatKind(target.role, role)) await assertSeatFree(tenant.organizationId, role);
  await prisma.membership.update({ where: { id: target.id }, data: { role } });
  await audit(req, {
    action: "member.role_changed",
    actorId,
    organizationId: tenant.organizationId,
    targetType: "user",
    targetId: targetUserId,
    metadata: { from: target.role, to: role },
  });
  return { userId: targetUserId, role };
};

const detachSessions = (userId: number, organizationId: string) =>
  prisma.session.updateMany({
    where: { userId, activeOrganizationId: organizationId },
    data: { activeOrganizationId: null },
  });

export const removeMember = async (req: Request, tenant: TenantContext, actorId: number, targetUserId: number) => {
  if (targetUserId === actorId) throw badRequest("Use 'Leave organization' to remove yourself");
  const target = await findMember(tenant.organizationId, targetUserId);

  await prisma.membership.delete({ where: { id: target.id } });
  await detachSessions(targetUserId, tenant.organizationId);
  await audit(req, {
    action: "member.removed",
    actorId,
    organizationId: tenant.organizationId,
    targetType: "user",
    targetId: targetUserId,
    metadata: { role: target.role },
  });
};

export const leaveOrganization = async (req: Request, tenant: TenantContext, userId: number) => {
  if (tenant.role === "ORG_ADMIN" && (await countAdmins(tenant.organizationId)) <= 1) {
    throw badRequest("You are the only admin. Make someone else an admin before leaving.");
  }
  await prisma.membership.delete({
    where: { organizationId_userId: { organizationId: tenant.organizationId, userId } },
  });
  await detachSessions(userId, tenant.organizationId);
  await audit(req, { action: "member.left", organizationId: tenant.organizationId, targetType: "user", targetId: userId });
};

// ─── Invitations ─────────────────────────────────────────────────────────────

const pendingWhere = () => ({ acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } });

export const listInvitations = (tenant: TenantContext) =>
  prisma.invitation.findMany({
    where: { organizationId: tenant.organizationId, ...pendingWhere() },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      expiresAt: true,
      invitedBy: { select: { email: true, name: true } },
    },
  });

export const createInvitation = async (
  req: Request,
  tenant: TenantContext,
  actorId: number,
  email: string,
  role: OrgRole
) => {
  if (!canAssignRole(tenant.role, role)) {
    throw forbidden("You can only invite people to roles below your own");
  }
  await requireVerifiedEmail(actorId);

  const existingMember = await prisma.membership.findFirst({
    where: { organizationId: tenant.organizationId, user: { email } },
  });
  if (existingMember) throw conflict("That person is already a member of this organization");

  await assertCanInvite(tenant.organizationId, role, email);
  const token = randomToken();
  const [, invitation, org, inviter] = await prisma.$transaction([
    // Re-inviting replaces any earlier pending invitation for the same email
    prisma.invitation.updateMany({
      where: { organizationId: tenant.organizationId, email, ...pendingWhere() },
      data: { revokedAt: new Date() },
    }),
    prisma.invitation.create({
      data: {
        organizationId: tenant.organizationId,
        email,
        role,
        tokenHash: sha256(token),
        invitedById: actorId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
    }),
    prisma.organization.findUniqueOrThrow({ where: { id: tenant.organizationId }, select: { name: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { email: true, name: true } }),
  ]);

  const link = `${config.frontendUrl}/invite/${token}`;
  const who = inviter.name || inviter.email;
  await sendMail({
    to: email,
    subject: `${who} invited you to ${org.name} on TaskForge`,
    text: `${who} invited you to join ${org.name} as ${ROLE_LABEL[role]}. Accept within 7 days: ${link}`,
    html: `<p><strong>${escapeHtml(who)}</strong> invited you to join <strong>${escapeHtml(org.name)}</strong> as ${ROLE_LABEL[role]}.</p><p><a href="${link}">Accept the invitation</a></p><p>This link expires in 7 days.</p>`,
  });

  await audit(req, {
    action: "invitation.created",
    actorId,
    organizationId: tenant.organizationId,
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { email, role },
  });
  return invitation;
};

export const revokeInvitation = async (req: Request, tenant: TenantContext, invitationId: string) => {
  // Scoped by organisation: another tenant's invitation id behaves like a missing one
  const { count } = await prisma.invitation.updateMany({
    where: { id: invitationId, organizationId: tenant.organizationId, ...pendingWhere() },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw notFound("Invitation not found");
  await audit(req, {
    action: "invitation.revoked",
    organizationId: tenant.organizationId,
    targetType: "invitation",
    targetId: invitationId,
  });
};

const findPendingInvitation = async (token: string) => {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      organization: { select: { id: true, name: true } },
      invitedBy: { select: { email: true, name: true } },
    },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
    throw notFound("This invitation is invalid or has expired");
  }
  return invitation;
};

/** Public preview shown on the invitation page before signing in. */
export const previewInvitation = async (token: string) => {
  const inv = await findPendingInvitation(token);
  const accountExists = Boolean(await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
  return {
    organizationName: inv.organization.name,
    email: inv.email,
    role: inv.role,
    invitedBy: inv.invitedBy?.name || inv.invitedBy?.email || null,
    expiresAt: inv.expiresAt,
    accountExists,
  };
};

export const acceptInvitation = async (req: Request, userId: number, token: string) => {
  const inv = await findPendingInvitation(token);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });

  // Only the person the invitation was addressed to can use it
  if (user.email !== inv.email) {
    throw new AppError(
      403,
      "INVITATION_EMAIL_MISMATCH",
      `This invitation was sent to ${inv.email}. Sign in with that account to accept it.`
    );
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (count === 0) throw notFound("This invitation is invalid or has expired");
    // A plan may have shrunk (trial ended, downgrade) since the invitation was sent
    const already = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: inv.organizationId, userId } } });
    if (!already) {
      await lockOrg(tx, inv.organizationId, "seats");
      await assertSeatFree(inv.organizationId, inv.role, tx);
    }

    await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId } },
      create: { organizationId: inv.organizationId, userId, role: inv.role },
      update: {}, // already a member: keep the existing role
    });
    // The link reached this inbox
    await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  });

  await audit(req, {
    action: "member.joined",
    organizationId: inv.organizationId,
    targetType: "user",
    targetId: userId,
    metadata: { role: inv.role, via: "invitation" },
  });
  return inv.organizationId;
};

// ─── Audit log ───────────────────────────────────────────────────────────────

export const listAuditLogs = async (tenant: TenantContext, limit: number, cursor?: string) => {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      ipAddress: true,
      createdAt: true,
      actor: { select: { id: true, email: true, name: true } },
    },
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
