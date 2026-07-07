import { Request, Response } from "express";
import prisma from "../prisma";

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

    // Validate title
    if (!title || title.trim() === "") {
      res.status(400).json({
        message: "Title is required",
      });
      return;
    }

    // Validate due date
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

    // Validate title
    if (!title || title.trim() === "") {
      res.status(400).json({
        message: "Title is required",
      });
      return;
    }

    // Validate due date
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

    const existingTask = await prisma.task.findUnique({
      where: { id },
    });

    if (!existingTask) {
      res.status(404).json({
        message: "Task not found",
      });
      return;
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        title,
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

    // Check if the task exists
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

    // Delete the task
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