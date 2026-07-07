import { Router } from "express";
import {
  getAllTasks,
  createTask,
  getTaskById,
  updateTask,
   deleteTask,
} from "../controllers/taskController";

const router = Router();

// Get all tasks
router.get("/", getAllTasks);

// Create a new task
router.post("/", createTask);

// Get a task by ID
router.get("/:id", getTaskById);
router.put("/:id", updateTask);
router.delete("/:id", deleteTask);
export default router;