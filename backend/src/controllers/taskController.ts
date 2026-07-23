import { Request, Response } from "express";
import { AuthRequest } from "../types/auth";
import prisma from "../prisma";
const VALID_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;

// ======================================================
// GET ALL TASKS
// ======================================================

export const getAllTasks = async (
  req:AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user!.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json(tasks);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

// ======================================================
// CREATE TASK
// ======================================================

export const createTask = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    let { title, description, status, dueDate } = req.body;

    title = title?.trim();

    if (!title) {
      res.status(400).json({
        message: "Title is required",
      });
      return;
    }

    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({
        message:
          "Invalid status. Allowed values are TODO, IN_PROGRESS, DONE.",
      });
      return;
    }

    if (dueDate) {
      const selectedDate = new Date(dueDate);
      const today = new Date();

      today.setHours(0, 0, 0, 0);
      selectedDate.setHours(0, 0, 0, 0);

      if (selectedDate < today) {
        res.status(400).json({
          message: "Due date cannot be in the past",
        });
        return;
      }
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        status,
        dueDate: dueDate ? new Date(dueDate) : null,
        user: {
          connect: {
            id: req.user!.id,
          },
        },
      },
    });

    res.status(201).json(task);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

// ======================================================
// GET TASK BY ID
// ======================================================

export const getTaskById = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = Number(req.params.id);

    const task = await prisma.task.findFirst({
      where: {
        id,
        userId: req.user!.id,
      },
    });

    if (!task) {
      res.status(404).json({
        message: "Task not found",
      });
      return;
    }

    res.status(200).json(task);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

// ======================================================
// UPDATE TASK
// ======================================================

export const updateTask = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = Number(req.params.id);

    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        userId: req.user!.id,
      },
    });

    if (!existingTask) {
      res.status(404).json({
        message: "Task not found",
      });
      return;
    }

    let { title, description, status, dueDate } = req.body;

    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({
        message:
          "Invalid status. Allowed values are TODO, IN_PROGRESS, DONE.",
      });
      return;
    }

    if (dueDate) {
      const selectedDate = new Date(dueDate);
      const today = new Date();

      today.setHours(0, 0, 0, 0);
      selectedDate.setHours(0, 0, 0, 0);

      if (selectedDate < today) {
        res.status(400).json({
          message: "Due date cannot be in the past",
        });
        return;
      }
    }

    const updatedTask = await prisma.task.update({
      where: {
        id,
      },
      data: {
        title:
          title !== undefined
            ? title.trim()
            : existingTask.title,

        description:
          description !== undefined
            ? description
            : existingTask.description,

        status:
          status !== undefined
            ? status
            : existingTask.status,

        dueDate:
          dueDate !== undefined
            ? dueDate
              ? new Date(dueDate)
              : null
            : existingTask.dueDate,
      },
    });

    res.status(200).json(updatedTask);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

// ======================================================
// DELETE TASK
// ======================================================

export const deleteTask = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = Number(req.params.id);

    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        userId: req.user!.id,
      },
    });

    if (!existingTask) {
      res.status(404).json({
        message: "Task not found",
      });
      return;
    }

    await prisma.task.delete({
      where: {
        id,
      },
    });

    res.status(200).json({
      message: "Task deleted successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};