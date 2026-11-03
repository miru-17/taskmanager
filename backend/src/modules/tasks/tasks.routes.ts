import { Router, type Request, type RequestHandler } from "express";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { publishWrites } from "../../core/publishWrites";
import * as tasks from "./tasks.service";
import { clearRecurrence, recurrenceBody, setRecurrence } from "../recurrence/recurrence.service";
import { requestApproval, requestBody as approvalRequestBody } from "../approvals/approvals.service";
import { taskAttachmentsRouter } from "../attachments/attachments.routes";
import {
  bulkBody,
  checklistBody,
  checklistParams,
  checklistUpdateBody,
  createTaskBody,
  dependencyBody,
  dependencyParams,
  listTasksQuery,
  taskIdParams,
  updateTaskBody,
  type ListTasksQuery,
} from "./tasks.schemas";

export const tasksRouter = Router();

tasksRouter.use(authenticate, requireTenant, publishWrites);

const actor = (req: Request): tasks.Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const taskId = (req: Request) => req.params.id as unknown as number;

// Route level: may this role do this at all? Service level: in THIS project, on THIS task?
const canRead = requirePermission("tasks:read");
const canEdit = requirePermission("tasks:update_any", "tasks:update_own");
const canDelete = requirePermission("tasks:delete_any", "tasks:delete_own");

tasksRouter.get("/", canRead, validate({ query: listTasksQuery }), async (req, res) => {
  res.json(await tasks.listTasks(actor(req), res.locals.query as ListTasksQuery));
});

tasksRouter.post("/", requirePermission("tasks:create"), validate({ body: createTaskBody }), async (req, res) => {
  res.status(201).json(await tasks.createTask(actor(req), req.body));
});

// Must come before "/:id" so "bulk" isn't parsed as an id
tasksRouter.post("/bulk", canEdit, validate({ body: bulkBody }), async (req, res) => {
  res.json(await tasks.bulk(req, actor(req), req.body));
});

tasksRouter.get("/:id", canRead, validate({ params: taskIdParams }), async (req, res) => {
  res.json(await tasks.getTask(actor(req), taskId(req)));
});

tasksRouter.get("/:id/activity", canRead, validate({ params: taskIdParams }), async (req, res) => {
  res.json(await tasks.getActivity(actor(req), taskId(req)));
});

const updateHandler: RequestHandler = async (req, res) => {
  res.json(await tasks.updateTask(actor(req), taskId(req), req.body));
};
const update = [canEdit, validate({ params: taskIdParams, body: updateTaskBody }), updateHandler];
// PUT kept for compatibility; PATCH is the semantically correct partial update
tasksRouter.put("/:id", ...update);
tasksRouter.patch("/:id", ...update);

tasksRouter.delete("/:id", canDelete, validate({ params: taskIdParams }), async (req, res) => {
  await tasks.deleteTask(req, actor(req), taskId(req));
  res.json({ message: "Task deleted successfully" });
});

tasksRouter.post("/:id/archive", canEdit, validate({ params: taskIdParams }), async (req, res) => {
  res.json(await tasks.setArchived(actor(req), taskId(req), true));
});
tasksRouter.post("/:id/unarchive", canEdit, validate({ params: taskIdParams }), async (req, res) => {
  res.json(await tasks.setArchived(actor(req), taskId(req), false));
});

// Dependencies: "this task is blocked by dependsOnId"
tasksRouter.post("/:id/dependencies", canEdit, validate({ params: taskIdParams, body: dependencyBody }), async (req, res) => {
  res.status(201).json(await tasks.addDependency(actor(req), taskId(req), req.body.dependsOnId));
});
tasksRouter.delete("/:id/dependencies/:dependsOnId", canEdit, validate({ params: dependencyParams }), async (req, res) => {
  res.json(await tasks.removeDependency(actor(req), taskId(req), req.params.dependsOnId as unknown as number));
});

// Watching is personal: anyone who can see the task may follow it
tasksRouter.post("/:id/watch", canRead, validate({ params: taskIdParams }), async (req, res) => {
  res.json(await tasks.setWatching(actor(req), taskId(req), true));
});
tasksRouter.delete("/:id/watch", canRead, validate({ params: taskIdParams }), async (req, res) => {
  res.json(await tasks.setWatching(actor(req), taskId(req), false));
});

// Recurrence: the next occurrence is created when this one is completed
tasksRouter.put("/:id/recurrence", canEdit, validate({ params: taskIdParams, body: recurrenceBody }), async (req, res) => {
  res.json(await setRecurrence(actor(req), taskId(req), req.body));
});
tasksRouter.delete("/:id/recurrence", canEdit, validate({ params: taskIdParams }), async (req, res) => {
  res.json(await clearRecurrence(actor(req), taskId(req)));
});

// Approvals
tasksRouter.post("/:id/approvals", canEdit, validate({ params: taskIdParams, body: approvalRequestBody }), async (req, res) => {
  res.status(201).json(await requestApproval(req, actor(req), taskId(req), req.body));
});

// Attachments (upload/list); download and delete live under /attachments
tasksRouter.use("/:id/attachments", taskAttachmentsRouter);

// Checklist
tasksRouter.post("/:id/checklist", canEdit, validate({ params: taskIdParams, body: checklistBody }), async (req, res) => {
  res.status(201).json(await tasks.addChecklistItem(actor(req), taskId(req), req.body.text));
});
tasksRouter.patch("/:id/checklist/:itemId", canEdit, validate({ params: checklistParams, body: checklistUpdateBody }), async (req, res) => {
  res.json(await tasks.updateChecklistItem(actor(req), taskId(req), req.params.itemId as string, req.body));
});
tasksRouter.delete("/:id/checklist/:itemId", canEdit, validate({ params: checklistParams }), async (req, res) => {
  await tasks.deleteChecklistItem(actor(req), taskId(req), req.params.itemId as string);
  res.json({ message: "Item removed" });
});
