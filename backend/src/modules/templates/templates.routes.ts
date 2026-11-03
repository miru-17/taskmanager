import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { cuidSchema } from "../../core/schemas";
import type { Actor } from "../../core/access";
import * as templates from "./templates.service";

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const params = z.object({ templateId: cuidSchema });
const listQuery = z.object({ projectId: cuidSchema.optional() });
const taskParams = z.object({ taskId: z.coerce.number().int().positive().max(2_147_483_647) });
const tid = (req: Request) => req.params.templateId as string;

/** Mounted at /templates */
export const templatesRouter = Router();
templatesRouter.use(authenticate, requireTenant, requirePermission("tasks:read"));

templatesRouter.get("/", validate({ query: listQuery }), async (req, res) => {
  res.json(await templates.listTemplates(actor(req), (res.locals.query as z.infer<typeof listQuery>).projectId));
});
templatesRouter.post("/", validate({ body: templates.templateBody }), async (req, res) => {
  res.status(201).json(await templates.createTemplate(req, actor(req), req.body));
});
templatesRouter.post("/from-task/:taskId", validate({ params: taskParams, body: templates.fromTaskBody }), async (req, res) => {
  res.status(201).json(await templates.templateFromTask(req, actor(req), req.params.taskId as unknown as number, req.body));
});
templatesRouter.get("/:templateId", validate({ params }), async (req, res) => {
  res.json(await templates.getTemplate(actor(req), tid(req)));
});
templatesRouter.patch("/:templateId", validate({ params, body: templates.templateUpdateBody }), async (req, res) => {
  res.json(await templates.updateTemplate(req, actor(req), tid(req), req.body));
});
templatesRouter.delete("/:templateId", validate({ params }), async (req, res) => {
  await templates.deleteTemplate(req, actor(req), tid(req));
  res.json({ message: "Template deleted" });
});
templatesRouter.post("/:templateId/apply", requirePermission("tasks:create"), validate({ params, body: templates.applyBody }), async (req, res) => {
  res.status(201).json(await templates.applyTemplate(actor(req), tid(req), req.body));
});
