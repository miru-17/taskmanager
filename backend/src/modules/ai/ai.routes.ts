import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../../core/config";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { cuidSchema } from "../../core/schemas";
import type { Actor } from "../../core/access";
import * as ai from "./ai.service";

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const tz = z.string().trim().min(1).max(64).optional();
const tzBody = z.object({ tz }).default({});
const taskParams = z.object({ taskId: z.coerce.number().int().positive().max(2_147_483_647) });
const projectParams = z.object({ projectId: cuidSchema });

/** Per user, not per IP: every AI request may cost money or laptop CPU. */
const aiLimit = rateLimit({
  windowMs: 5 * 60_000,
  limit: () => config.AI_RATE_LIMIT,
  keyGenerator: (req) => `ai:${currentTenant(req).organizationId}:${currentAuth(req).userId}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many AI requests. Try again in a few minutes.", code: "RATE_LIMITED" },
});

/** Mounted at /ai */
export const aiRouter = Router();
aiRouter.use(authenticate, requireTenant, requirePermission("tasks:read"));

aiRouter.get("/status", async (req, res) => {
  res.json(await ai.status(actor(req)));
});
aiRouter.patch("/settings", requirePermission("org:update"), validate({ body: z.object({ enabled: z.boolean() }) }), async (req, res) => {
  res.json(await ai.updateSettings(req, actor(req), req.body.enabled));
});

aiRouter.use(aiLimit);
aiRouter.post(
  "/parse",
  requirePermission("tasks:create"),
  validate({ body: z.object({ text: z.string().trim().min(1, "Describe the task").max(500), projectId: cuidSchema.optional(), tz }) }),
  async (req, res) => {
    res.json(await ai.parse(actor(req), req.body));
  }
);
aiRouter.post("/tasks/:taskId/breakdown", validate({ params: taskParams, body: tzBody }), async (req, res) => {
  res.json(await ai.breakdown(actor(req), Number(req.params.taskId)));
});
aiRouter.post("/tasks/:taskId/summary", validate({ params: taskParams, body: tzBody }), async (req, res) => {
  res.json(await ai.taskSummary(actor(req), Number(req.params.taskId), req.body.tz));
});
aiRouter.post("/projects/:projectId/summary", validate({ params: projectParams, body: tzBody }), async (req, res) => {
  res.json(await ai.projectSummary(actor(req), req.params.projectId as string, req.body.tz));
});
aiRouter.post("/projects/:projectId/prioritize", validate({ params: projectParams, body: tzBody }), async (req, res) => {
  res.json(await ai.prioritize(actor(req), req.params.projectId as string, req.body.tz));
});
aiRouter.post("/projects/:projectId/risks", validate({ params: projectParams, body: tzBody }), async (req, res) => {
  res.json(await ai.risks(actor(req), req.params.projectId as string, req.body.tz));
});
aiRouter.post(
  "/assistant",
  validate({
    body: z.object({
      message: z.string().trim().min(1, "Ask something").max(1000),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(20).default([]),
      tz,
    }),
  }),
  async (req, res) => {
    res.json(await ai.assistant(actor(req), req.body));
  }
);
