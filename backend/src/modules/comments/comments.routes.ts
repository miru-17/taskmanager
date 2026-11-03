import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { cuidSchema } from "../../core/schemas";
import { config } from "../../core/config";
import type { Actor } from "../../core/access";
import * as comments from "./comments.service";

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const taskParams = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });
const commentParams = z.object({ commentId: cuidSchema });
const projectParams = z.object({ projectId: cuidSchema });

/** Per user, not per IP: stops a script flooding a thread (and everyone's inbox) */
const writeLimit = rateLimit({
  windowMs: 60_000,
  limit: config.isTest ? 1000 : 30,
  keyGenerator: (req) => `comments:${currentAuth(req).userId}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "You're commenting very fast. Wait a moment and try again.", code: "RATE_LIMITED" },
});

/** Mounted at /tasks/:id/comments */
export const taskCommentsRouter = Router({ mergeParams: true });
taskCommentsRouter.use(authenticate, requireTenant, requirePermission("tasks:read"));
taskCommentsRouter.get("/", validate({ params: taskParams }), async (req, res) => {
  res.json(await comments.listComments(actor(req), req.params.id as unknown as number));
});
taskCommentsRouter.post("/", writeLimit, validate({ params: taskParams, body: comments.commentBody }), async (req, res) => {
  res.status(201).json(await comments.createComment(req, actor(req), req.params.id as unknown as number, req.body));
});

/** Mounted at /comments */
export const commentsRouter = Router();
commentsRouter.use(authenticate, requireTenant, requirePermission("tasks:read"));
commentsRouter.patch("/:commentId", writeLimit, validate({ params: commentParams, body: comments.editBody }), async (req, res) => {
  res.json(await comments.updateComment(actor(req), req.params.commentId as string, req.body));
});
commentsRouter.delete("/:commentId", validate({ params: commentParams }), async (req, res) => {
  await comments.deleteComment(req, actor(req), req.params.commentId as string);
  res.json({ message: "Comment deleted" });
});
commentsRouter.post("/:commentId/reactions", writeLimit, validate({ params: commentParams, body: comments.reactionBody }), async (req, res) => {
  res.json(await comments.toggleReaction(actor(req), req.params.commentId as string, req.body.emoji));
});

/** Mounted at /projects/:projectId/activity */
export const projectFeedRouter = Router({ mergeParams: true });
projectFeedRouter.use(authenticate, requireTenant, requirePermission("tasks:read"));
projectFeedRouter.get("/", validate({ params: projectParams, query: comments.feedQuery }), async (req, res) => {
  res.json(await comments.projectFeed(actor(req), req.params.projectId as string, (res.locals.query as z.infer<typeof comments.feedQuery>).limit));
});
