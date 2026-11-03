import express from "express";
import cookieParser from "cookie-parser";
import { corsPolicy, securityHeaders } from "./core/security";
import { errorHandler, notFoundHandler } from "./core/errors";
import { prisma } from "./core/prisma";
import { authRouter } from "./modules/auth/auth.routes";
import { usersRouter } from "./modules/users/users.routes";
import { tasksRouter } from "./modules/tasks/tasks.routes";
import { orgsRouter, invitationsRouter } from "./modules/orgs/orgs.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { projectsRouter } from "./modules/projects/projects.routes";
import { teamsRouter } from "./modules/teams/teams.routes";
import { labelsRouter, viewsRouter } from "./modules/labels/labels.routes";
import { fieldsRouter } from "./modules/fields/fields.routes";
import { templatesRouter } from "./modules/templates/templates.routes";
import { attachmentsRouter } from "./modules/attachments/attachments.routes";
import { approvalsRouter } from "./modules/approvals/approvals.routes";
import { commentsRouter, projectFeedRouter, taskCommentsRouter } from "./modules/comments/comments.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { eventsRouter } from "./modules/realtime/events.routes";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  // Behind one reverse proxy in production (needed for correct client IPs in rate limiting)
  app.set("trust proxy", 1);

  app.use(securityHeaders);
  app.use(corsPolicy);
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/health/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: "ok", database: "up" });
    } catch {
      res.status(503).json({ status: "unavailable", database: "down" });
    }
  });

  app.use("/auth", authRouter);
  app.use("/user", usersRouter);
  app.use("/orgs", orgsRouter);
  app.use("/invitations", invitationsRouter);
  app.use("/tasks", tasksRouter);
  app.use("/projects/:projectId/fields", fieldsRouter);
  app.use("/projects", projectsRouter);
  app.use("/teams", teamsRouter);
  app.use("/labels", labelsRouter);
  app.use("/views", viewsRouter);
  app.use("/templates", templatesRouter);
  app.use("/attachments", attachmentsRouter);
  app.use("/approvals", approvalsRouter);
  app.use("/tasks/:id/comments", taskCommentsRouter);
  app.use("/comments", commentsRouter);
  app.use("/projects/:projectId/activity", projectFeedRouter);
  app.use("/notifications", notificationsRouter);
  app.use("/events", eventsRouter);
  app.use("/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
