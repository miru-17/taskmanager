import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { cuidSchema } from "../../core/schemas";
import type { Actor } from "../../core/access";
import { ruleBody, ruleUpdateBody } from "./definitions";
import * as automations from "./automation.service";

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const projectParams = z.object({ projectId: cuidSchema });
const ruleParams = z.object({ ruleId: cuidSchema });
const runsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(["RUNNING", "SUCCEEDED", "SKIPPED", "FAILED", "LOOP_BLOCKED"]).optional(),
});
const testBody = z.object({ taskId: z.number().int().positive().max(2_147_483_647) });

/** Mounted at /projects/:projectId/automations */
export const projectAutomationsRouter = Router({ mergeParams: true });
projectAutomationsRouter.use(authenticate, requireTenant, requirePermission("tasks:read"));
projectAutomationsRouter.get("/", validate({ params: projectParams }), async (req, res) => {
  res.json(await automations.listRules(actor(req), req.params.projectId as string));
});
projectAutomationsRouter.post("/", validate({ params: projectParams, body: ruleBody }), async (req, res) => {
  res.status(201).json(await automations.createRule(req, actor(req), req.params.projectId as string, req.body));
});

/** Mounted at /automations */
export const automationsRouter = Router();
automationsRouter.use(authenticate, requireTenant, requirePermission("tasks:read"));
const rid = (req: Request) => req.params.ruleId as string;
automationsRouter.patch("/:ruleId", validate({ params: ruleParams, body: ruleUpdateBody }), async (req, res) => {
  res.json(await automations.updateRule(req, actor(req), rid(req), req.body));
});
automationsRouter.delete("/:ruleId", validate({ params: ruleParams }), async (req, res) => {
  await automations.deleteRule(req, actor(req), rid(req));
  res.json({ message: "Automation deleted" });
});
automationsRouter.get("/:ruleId/runs", validate({ params: ruleParams, query: runsQuery }), async (req, res) => {
  res.json(await automations.listRuns(actor(req), rid(req), res.locals.query as z.infer<typeof runsQuery>));
});
automationsRouter.post("/:ruleId/test", validate({ params: ruleParams, body: testBody }), async (req, res) => {
  res.json(await automations.testRule(actor(req), rid(req), req.body.taskId));
});
