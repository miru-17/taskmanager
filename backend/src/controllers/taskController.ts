import { Request, Response } from "express";
import prisma from "../prisma";

const VALID_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;

export const getAllTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const tasks = await prisma.task.findMany({
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

export const createTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { title, description, status, dueDate } = req.body;

    // Trim title
    const trimmedTitle = title?.trim();

    // Validate title
    if (!trimmedTitle) {
      res.status(400).json({
        message: "Title is required",
      });
      return;
    }

    // Validate status
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({
        message:
          "Invalid status. Allowed values are TODO, IN_PROGRESS, DONE.",
      });
      return;
    }

    // Validate due date
    if (dueDate) {
      const today = new Date();

      const todayString = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      )
        .toISOString()
        .split("T")[0];

      if (dueDate < todayString) {
        res.status(400).json({
          message: "Due date cannot be in the past",
        });
        return;
      }
    }

    const task = await prisma.task.create({
      data: {
        title: trimmedTitle,
        description,
        status,
        dueDate: dueDate ? new Date(dueDate) : null,
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

export const getTaskById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = Number(req.params.id);

    const task = await prisma.task.findUnique({
      where: {
        id,
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

export const updateTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = Number(req.params.id);

    const { title, description, status, dueDate } = req.body;

    // Trim title
    const trimmedTitle = title?.trim();

    // Validate title
    if (!trimmedTitle) {
      res.status(400).json({
        message: "Title is required",
      });
      return;
    }

    // Validate status
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({
        message:
          "Invalid status. Allowed values are TODO, IN_PROGRESS, DONE.",
      });
      return;
    }

    // Validate due date
    if (dueDate) {
      const today = new Date();

      const todayString = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      )
        .toISOString()
        .split("T")[0];

      if (dueDate < todayString) {
        res.status(400).json({
          message: "Due date cannot be in the past",
        });
        return;
      }
    }

    const existingTask = await prisma.task.findUnique({
      where: {
        id,
      },
    });

    if (!existingTask) {
      res.status(404).json({
        message: "Task not found",
      });
      return;
    }

    const updatedTask = await prisma.task.update({
      where: {
        id,
      },
      data: {
        title: trimmedTitle,
        description,
        status,
        dueDate: dueDate ? new Date(dueDate) : null,
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

export const deleteTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = Number(req.params.id);

    const existingTask = await prisma.task.findUnique({
      where: {
        id,
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