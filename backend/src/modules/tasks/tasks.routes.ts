import { Router, type RequestHandler } from "express";
import { authenticate, currentUser } from "../../core/auth";
import { validate } from "../../core/validate";
import { idParamSchema } from "../../core/schemas";
import * as tasks from "./tasks.service";
import { createTaskBody, updateTaskBody } from "./tasks.schemas";

export const tasksRouter = Router();

tasksRouter.use(authenticate);

const taskId = (params: Record<string, unknown>) => params.id as unknown as number;

tasksRouter.get("/", async (req, res) => {
  res.status(200).json(await tasks.listTasks(currentUser(req).id));
});

tasksRouter.post("/", validate({ body: createTaskBody }), async (req, res) => {
  res.status(201).json(await tasks.createTask(currentUser(req).id, req.body));
});

tasksRouter.get("/:id", validate({ params: idParamSchema }), async (req, res) => {
  res.status(200).json(await tasks.getTask(currentUser(req).id, taskId(req.params)));
});

// PUT kept for the existing frontend; PATCH is the semantically correct partial update
const updateHandler: RequestHandler = async (req, res) => {
  res.status(200).json(await tasks.updateTask(currentUser(req).id, taskId(req.params), req.body));
};
const update = [validate({ params: idParamSchema, body: updateTaskBody }), updateHandler];
tasksRouter.put("/:id", ...update);
tasksRouter.patch("/:id", ...update);

tasksRouter.delete("/:id", validate({ params: idParamSchema }), async (req, res) => {
  await tasks.deleteTask(currentUser(req).id, taskId(req.params));
  res.status(200).json({ message: "Task deleted successfully" });
});
