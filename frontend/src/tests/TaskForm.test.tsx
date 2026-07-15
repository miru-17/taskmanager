import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TaskForm from "../components/TaskForm";
import api from "../services/api";
import type { Task } from "../types/Task";

vi.mock("../services/api", () => ({
  default: {
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("TaskForm", () => {
  it("creates a task", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {},
    });

    const onTaskCreated = vi.fn();

    render(
      <TaskForm
        editingTask={null}
        onTaskCreated={onTaskCreated}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("Enter task title"),
      {
        target: {
          value: "My Task",
        },
      }
    );

    fireEvent.change(
      screen.getByPlaceholderText("Enter task description..."),
      {
        target: {
          value: "Testing",
        },
      }
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /create task/i,
      })
    );

    await waitFor(() => {
      expect(api.post).toHaveBeenCalled();
      expect(onTaskCreated).toHaveBeenCalled();
    });
  });

  it("updates a task", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({
      data: {},
    });

    const task: Task = {
      id: 1,
      title: "Old Task",
      description: "Old",
      status: "TODO",
      dueDate: "2026-07-20",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    const onTaskCreated = vi.fn();

    render(
      <TaskForm
        editingTask={task}
        onTaskCreated={onTaskCreated}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("Enter task title"),
      {
        target: {
          value: "Updated Task",
        },
      }
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /update task/i,
      })
    );

    await waitFor(() => {
      expect(api.put).toHaveBeenCalled();
      expect(onTaskCreated).toHaveBeenCalled();
    });
  });
});