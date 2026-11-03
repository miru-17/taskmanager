import { Router, type Request } from "express";
import { z } from "zod";
import { TeamRole } from "@prisma/client";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { hasPermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { prisma } from "../../core/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import { cuidSchema } from "../../core/schemas";
import { assertOrgMember } from "../../core/access";

export const teamsRouter = Router();
teamsRouter.use(authenticate, requireTenant);

const teamName = z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(80);
const teamBody = z.object({
  name: teamName,
  description: z.union([z.string().trim().max(1000), z.null()]).optional(),
});
const teamParams = z.object({ teamId: cuidSchema });
const memberParams = z.object({ teamId: cuidSchema, userId: z.coerce.number().int().positive().max(2_147_483_647) });
const memberBody = z.object({ userId: z.coerce.number().int().positive().max(2_147_483_647), role: z.enum(TeamRole).default("MEMBER") });

const ctx = (req: Request) => ({ userId: currentAuth(req).userId, ...currentTenant(req) });

/** Clients don't see the internal team structure. */
const assertInternal = (req: Request) => {
  if (currentTenant(req).role === "CLIENT") throw forbidden();
};

const findTeam = async (organizationId: string, teamId: string) => {
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId } });
  if (!team) throw notFound("Team not found");
  return team;
};

/** Org-level team managers, or the team's own lead (for its membership). */
const assertCanManage = async (req: Request, teamId: string, allowLead: boolean) => {
  const { role, userId } = ctx(req);
  if (hasPermission(role, "teams:manage")) return;
  if (allowLead) {
    const m = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (m?.role === "LEAD") return;
  }
  throw forbidden("You don't have permission to manage this team");
};

const teamDetail = (teamId: string) =>
  prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      members: {
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: { role: true, user: { select: { id: true, email: true, name: true } } },
      },
      projects: { select: { id: true, key: true, name: true, color: true } },
    },
  });

teamsRouter.get("/", async (req, res) => {
  assertInternal(req);
  const { organizationId, userId } = ctx(req);
  const teams = await prisma.team.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      _count: { select: { members: true, projects: true } },
      members: { where: { userId }, select: { role: true } },
    },
  });
  res.json(teams.map(({ members, _count, ...t }) => ({ ...t, memberCount: _count.members, projectCount: _count.projects, myRole: members[0]?.role ?? null })));
});

teamsRouter.post("/", validate({ body: teamBody }), async (req, res) => {
  const { organizationId, role } = ctx(req);
  if (!hasPermission(role, "teams:manage")) throw forbidden();
  if (await prisma.team.findFirst({ where: { organizationId, name: req.body.name } })) throw conflict("A team with that name already exists");
  const team = await prisma.team.create({ data: { organizationId, name: req.body.name, description: req.body.description ?? null } });
  await audit(req, { action: "team.created", organizationId, targetType: "team", targetId: team.id, metadata: { name: team.name } });
  res.status(201).json(await teamDetail(team.id));
});

teamsRouter.get("/:teamId", validate({ params: teamParams }), async (req, res) => {
  assertInternal(req);
  await findTeam(ctx(req).organizationId, req.params.teamId as string);
  res.json(await teamDetail(req.params.teamId as string));
});

teamsRouter.patch("/:teamId", validate({ params: teamParams, body: teamBody.partial() }), async (req, res) => {
  const { organizationId } = ctx(req);
  const teamId = req.params.teamId as string;
  await findTeam(organizationId, teamId);
  await assertCanManage(req, teamId, false);
  if (req.body.name && (await prisma.team.findFirst({ where: { organizationId, name: req.body.name, id: { not: teamId } } }))) {
    throw conflict("A team with that name already exists");
  }
  await prisma.team.update({ where: { id: teamId }, data: req.body });
  await audit(req, { action: "team.updated", organizationId, targetType: "team", targetId: teamId });
  res.json(await teamDetail(teamId));
});

teamsRouter.delete("/:teamId", validate({ params: teamParams }), async (req, res) => {
  const { organizationId } = ctx(req);
  const teamId = req.params.teamId as string;
  const team = await findTeam(organizationId, teamId);
  await assertCanManage(req, teamId, false);
  await prisma.team.delete({ where: { id: teamId } });
  await audit(req, { action: "team.deleted", organizationId, targetType: "team", targetId: teamId, metadata: { name: team.name } });
  res.json({ message: "Team deleted" });
});

teamsRouter.post("/:teamId/members", validate({ params: teamParams, body: memberBody }), async (req, res) => {
  const { organizationId } = ctx(req);
  const teamId = req.params.teamId as string;
  await findTeam(organizationId, teamId);
  await assertCanManage(req, teamId, true);
  const membership = await assertOrgMember(organizationId, req.body.userId, "User");
  if (membership.role === "CLIENT") throw badRequest("Clients can't join internal teams");
  // Only org-level managers may appoint leads (a lead can't create more leads)
  if (req.body.role === "LEAD" && !hasPermission(ctx(req).role, "teams:manage")) throw forbidden("Only managers can appoint team leads");

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId, userId: req.body.userId } },
    create: { teamId, userId: req.body.userId, role: req.body.role },
    update: { role: req.body.role },
  });
  await audit(req, { action: "team.member_set", organizationId, targetType: "team", targetId: teamId, metadata: { userId: req.body.userId, role: req.body.role } });
  res.status(201).json(await teamDetail(teamId));
});

teamsRouter.delete("/:teamId/members/:userId", validate({ params: memberParams }), async (req, res) => {
  const { organizationId } = ctx(req);
  const teamId = req.params.teamId as string;
  await findTeam(organizationId, teamId);
  await assertCanManage(req, teamId, true);
  const { count } = await prisma.teamMember.deleteMany({ where: { teamId, userId: req.params.userId as unknown as number } });
  if (count === 0) throw notFound("Member not found");
  await audit(req, { action: "team.member_removed", organizationId, targetType: "team", targetId: teamId, metadata: { userId: req.params.userId } });
  res.json(await teamDetail(teamId));
});
