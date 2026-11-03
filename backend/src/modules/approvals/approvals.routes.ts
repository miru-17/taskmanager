import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { validate } from "../../core/validate";
import { publishWrites } from "../../core/publishWrites";
import { cuidSchema } from "../../core/schemas";
import type { Actor } from "../../core/access";
import * as approvals from "./approvals.service";

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const params = z.object({ requestId: cuidSchema });

/** Mounted at /approvals. Deciding needs no task-edit permission: being named an approver is the permission. */
export const approvalsRouter = Router();
approvalsRouter.use(authenticate, requireTenant, publishWrites);

approvalsRouter.get("/", validate({ query: approvals.listQuery }), async (req, res) => {
  res.json(await approvals.listApprovals(actor(req), (res.locals.query as z.infer<typeof approvals.listQuery>).scope));
});
approvalsRouter.get("/count", async (req, res) => {
  res.json({ pending: await approvals.pendingCount(actor(req)) });
});
approvalsRouter.post("/:requestId/decision", validate({ params, body: approvals.decisionBody }), async (req, res) => {
  res.json(await approvals.decide(req, actor(req), req.params.requestId as string, req.body));
});
approvalsRouter.post("/:requestId/cancel", validate({ params }), async (req, res) => {
  res.json(await approvals.cancel(req, actor(req), req.params.requestId as string));
});
