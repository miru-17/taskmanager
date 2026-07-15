import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TaskCard from "../components/TaskCard";
import type { Task } from "../types/Task";

const task: Task = {
  id: 1,
  title: "Learn Testing",
  description: "Vitest",
  status: "TODO",
  dueDate: "2026-07-20",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("TaskCard", () => {
  it("renders task information", () => {
    render(
      <TaskCard
        task={task}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("Learn Testing")).toBeInTheDocument();
    expect(screen.getByText("Vitest")).toBeInTheDocument();
  });

  it("calls onEdit when Edit button is clicked", () => {
    const onEdit = vi.fn();

    render(
      <TaskCard
        task={task}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /edit/i,
      })
    );

    expect(onEdit).toHaveBeenCalledWith(task);
  });

  it("calls onDelete when Delete button is clicked", () => {
    const onDelete = vi.fn();

    render(
      <TaskCard
        task={task}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /delete/i,
      })
    );

    expect(onDelete).toHaveBeenCalledWith(1);
  });
});