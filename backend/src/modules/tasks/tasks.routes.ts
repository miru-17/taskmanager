import { Router, type Request, type RequestHandler } from "express";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { idParamSchema } from "../../core/schemas";
import * as tasks from "./tasks.service";
import { createTaskBody, updateTaskBody } from "./tasks.schemas";

export const tasksRouter = Router();

tasksRouter.use(authenticate, requireTenant);

const actor = (req: Request): tasks.Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
const taskId = (req: Request) => req.params.id as unknown as number;

tasksRouter.get("/", requirePermission("tasks:read"), async (req, res) => {
  res.status(200).json(await tasks.listTasks(actor(req)));
});

tasksRouter.post("/", requirePermission("tasks:create"), validate({ body: createTaskBody }), async (req, res) => {
  res.status(201).json(await tasks.createTask(actor(req), req.body));
});

tasksRouter.get("/:id", requirePermission("tasks:read"), validate({ params: idParamSchema }), async (req, res) => {
  res.status(200).json(await tasks.getTask(actor(req), taskId(req)));
});

// Route-level: may this role edit tasks at all? Service-level: may it edit THIS task?
const updateHandler: RequestHandler = async (req, res) => {
  res.status(200).json(await tasks.updateTask(actor(req), taskId(req), req.body));
};
const update = [
  requirePermission("tasks:update_any", "tasks:update_own"),
  validate({ params: idParamSchema, body: updateTaskBody }),
  updateHandler,
];
// PUT kept for compatibility; PATCH is the semantically correct partial update
tasksRouter.put("/:id", ...update);
tasksRouter.patch("/:id", ...update);

tasksRouter.delete(
  "/:id",
  requirePermission("tasks:delete_any", "tasks:delete_own"),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await tasks.deleteTask(req, actor(req), taskId(req));
    res.status(200).json({ message: "Task deleted successfully" });
  }
);
