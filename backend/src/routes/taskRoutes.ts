import { Router } from "express";
import {
  getAllTasks,
  createTask,
  getTaskById,
  updateTask,
  deleteTask,
} from "../controllers/taskController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

// =====================================
// Protected Task Routes
// =====================================

// Get all tasks
router.get("/", authenticateToken, getAllTasks);

// Create a new task
router.post("/", authenticateToken, createTask);

// Get a single task
router.get("/:id", authenticateToken, getTaskById);

// Update task (Edit form + Inline Status Update)
router.put("/:id", authenticateToken, updateTask);

// Delete task
router.delete("/:id", authenticateToken, deleteTask);

export default router;
