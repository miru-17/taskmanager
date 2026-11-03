import { Router, type Request } from "express";
import type { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import type { Actor } from "../../core/access";
import * as projects from "./projects.service";
import {
  createMilestoneBody,
  createProjectBody,
  milestoneBody,
  milestoneParams,
  projectListQuery,
  projectMemberBody,
  projectMemberParams,
  projectParams,
  updateProjectBody,
} from "./projects.schemas";

export const projectsRouter = Router();
projectsRouter.use(authenticate, requireTenant);

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const pid = (req: Request) => req.params.projectId as string;

projectsRouter.get("/", validate({ query: projectListQuery }), async (req, res) => {
  res.json(await projects.listProjects(actor(req), res.locals.query as z.infer<typeof projectListQuery>));
});

projectsRouter.post("/", requirePermission("projects:create"), validate({ body: createProjectBody }), async (req, res) => {
  res.status(201).json(await projects.createProject(req, actor(req), req.body));
});

projectsRouter.get("/:projectId", validate({ params: projectParams }), async (req, res) => {
  res.json(await projects.getProject(actor(req), pid(req)));
});

projectsRouter.patch("/:projectId", validate({ params: projectParams, body: updateProjectBody }), async (req, res) => {
  res.json(await projects.updateProject(req, actor(req), pid(req), req.body));
});

projectsRouter.delete("/:projectId", validate({ params: projectParams }), async (req, res) => {
  await projects.deleteProject(req, actor(req), pid(req));
  res.json({ message: "Project deleted" });
});

// Members
projectsRouter.get("/:projectId/members", validate({ params: projectParams }), async (req, res) => {
  res.json(await projects.listProjectMembers(actor(req), pid(req)));
});

projectsRouter.post("/:projectId/members", validate({ params: projectParams, body: projectMemberBody }), async (req, res) => {
  res.status(201).json(await projects.upsertProjectMember(req, actor(req), pid(req), req.body.userId, req.body.role));
});

projectsRouter.delete("/:projectId/members/:userId", validate({ params: projectMemberParams }), async (req, res) => {
  await projects.removeProjectMember(req, actor(req), pid(req), req.params.userId as unknown as number);
  res.json({ message: "Member removed" });
});

// Milestones
projectsRouter.get("/:projectId/milestones", validate({ params: projectParams }), async (req, res) => {
  res.json(await projects.listMilestones(actor(req), pid(req)));
});

projectsRouter.post("/:projectId/milestones", validate({ params: projectParams, body: createMilestoneBody }), async (req, res) => {
  res.status(201).json(await projects.createMilestone(actor(req), pid(req), req.body));
});

projectsRouter.patch("/:projectId/milestones/:milestoneId", validate({ params: milestoneParams, body: milestoneBody }), async (req, res) => {
  res.json(await projects.updateMilestone(actor(req), pid(req), req.params.milestoneId as string, req.body));
});

projectsRouter.delete("/:projectId/milestones/:milestoneId", validate({ params: milestoneParams }), async (req, res) => {
  await projects.deleteMilestone(actor(req), pid(req), req.params.milestoneId as string);
  res.json({ message: "Milestone deleted" });
});
