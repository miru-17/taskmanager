import { Router } from "express";
import { z } from "zod";
import { OrgRole } from "@prisma/client";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { authRateLimit } from "../../core/security";
import { cuidSchema, emailSchema, tokenParamSchema } from "../../core/schemas";
import { reselectOrganization, switchSessionOrganization } from "../auth/sessions";
import * as orgs from "./orgs.service";

const orgName = z.string({ error: "Organization name is required" }).trim().min(2, "Organization name must be at least 2 characters").max(100, "Organization name must be at most 100 characters");
const roleSchema = z.enum(OrgRole, { error: "Invalid role" });
const userIdParams = z.object({ userId: z.coerce.number().int().positive().max(2_147_483_647) });

// ─── /orgs ───────────────────────────────────────────────────────────────────

export const orgsRouter = Router();
orgsRouter.use(authenticate);

/** Create a new organisation; the creator becomes its admin and it becomes their active one. */
orgsRouter.post("/", validate({ body: z.object({ name: orgName }) }), async (req, res) => {
  const { userId, sessionId } = currentAuth(req);
  const org = await orgs.createOrganization(req, userId, req.body.name);
  res.status(201).json(await switchSessionOrganization(userId, sessionId, org.id));
});

// Everything below acts on the caller's active organisation, resolved server-side.
const current = Router();
orgsRouter.use("/current", requireTenant, current);

current.get("/", requirePermission("org:read"), async (req, res) => {
  res.status(200).json(await orgs.getOrganization(currentTenant(req)));
});

current.patch("/", requirePermission("org:update"), validate({ body: z.object({ name: orgName }) }), async (req, res) => {
  res.status(200).json(await orgs.updateOrganization(req, currentTenant(req), req.body));
});

current.post("/leave", async (req, res) => {
  const { userId, sessionId } = currentAuth(req);
  await orgs.leaveOrganization(req, currentTenant(req), userId);
  res.status(200).json(await reselectOrganization(userId, sessionId));
});

current.get("/members", requirePermission("members:read"), async (req, res) => {
  res.status(200).json(await orgs.listMembers(currentTenant(req)));
});

current.patch(
  "/members/:userId",
  requirePermission("members:manage"),
  validate({ params: userIdParams, body: z.object({ role: roleSchema }) }),
  async (req, res) => {
    const target = req.params.userId as unknown as number;
    res.status(200).json(await orgs.changeMemberRole(req, currentTenant(req), currentAuth(req).userId, target, req.body.role));
  }
);

current.delete("/members/:userId", requirePermission("members:manage"), validate({ params: userIdParams }), async (req, res) => {
  await orgs.removeMember(req, currentTenant(req), currentAuth(req).userId, req.params.userId as unknown as number);
  res.status(200).json({ message: "Member removed" });
});

current.get("/invitations", requirePermission("invitations:manage"), async (req, res) => {
  res.status(200).json(await orgs.listInvitations(currentTenant(req)));
});

current.post(
  "/invitations",
  requirePermission("members:invite"),
  authRateLimit(3),
  validate({ body: z.object({ email: emailSchema, role: roleSchema }) }),
  async (req, res) => {
    const inv = await orgs.createInvitation(req, currentTenant(req), currentAuth(req).userId, req.body.email, req.body.role);
    res.status(201).json(inv);
  }
);

current.delete(
  "/invitations/:id",
  requirePermission("invitations:manage"),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (req, res) => {
    await orgs.revokeInvitation(req, currentTenant(req), req.params.id as string);
    res.status(200).json({ message: "Invitation revoked" });
  }
);

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cuidSchema.optional(),
});

current.get("/audit-logs", requirePermission("audit:read"), validate({ query: auditQuery }), async (req, res) => {
  const { limit, cursor } = res.locals.query as z.infer<typeof auditQuery>;
  res.status(200).json(await orgs.listAuditLogs(currentTenant(req), limit, cursor));
});

// ─── /invitations (token-addressed) ──────────────────────────────────────────

export const invitationsRouter = Router();
const inviteLimiter = authRateLimit(3);

invitationsRouter.get("/:token", inviteLimiter, validate({ params: tokenParamSchema }), async (req, res) => {
  res.status(200).json(await orgs.previewInvitation(req.params.token as string));
});

invitationsRouter.post(
  "/:token/accept",
  inviteLimiter,
  authenticate,
  validate({ params: tokenParamSchema }),
  async (req, res) => {
    const { userId, sessionId } = currentAuth(req);
    const organizationId = await orgs.acceptInvitation(req, userId, req.params.token as string);
    res.status(200).json(await switchSessionOrganization(userId, sessionId, organizationId));
  }
);
