import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { validate } from "../../core/validate";
import { cuidSchema } from "../../core/schemas";
import type { Actor } from "../../core/access";
import * as n from "./notifications.service";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate, requireTenant);

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const readBody = z.object({ ids: z.array(cuidSchema).min(1).max(200) });

notificationsRouter.get("/", validate({ query: n.listQuery }), async (req, res) => {
  res.json(await n.listNotifications(actor(req), res.locals.query as z.infer<typeof n.listQuery>));
});
notificationsRouter.get("/count", async (req, res) => {
  res.json({ unread: await n.unreadCount(actor(req)) });
});
notificationsRouter.post("/read", validate({ body: readBody }), async (req, res) => {
  res.json(await n.markRead(actor(req), req.body.ids));
});
notificationsRouter.post("/read-task/:taskId", validate({ params: z.object({ taskId: z.coerce.number().int().positive().max(2_147_483_647) }) }), async (req, res) => {
  const { count } = await n.markTaskRead(actor(req), req.params.taskId as unknown as number);
  res.json({ updated: count });
});
notificationsRouter.post("/read-all", async (req, res) => {
  res.json(await n.markRead(actor(req), "all"));
});
notificationsRouter.get("/preferences", async (req, res) => {
  res.json(await n.getPreferences(actor(req)));
});
notificationsRouter.put("/preferences", validate({ body: n.prefsBody }), async (req, res) => {
  res.json(await n.setPreferences(actor(req), req.body.emailTypes));
});
