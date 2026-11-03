import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TaskForm from "../components/TaskForm";
import api from "../services/api";
import type { Task } from "../types/Task";

vi.mock("../services/api", () => ({
  default: { post: vi.fn(), put: vi.fn() },
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const mockedApi = vi.mocked(api);

const task = (overrides: Partial<Task>): Task => ({
  id: 1,
  title: "T",
  status: "TODO",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("TaskForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears the due date when switching to a task that has none (regression)", () => {
    const { rerender } = render(
      <TaskForm editingTask={task({ id: 1, dueDate: "2026-12-25T00:00:00.000Z" })} onTaskCreated={vi.fn()} />
    );
    expect(screen.getByLabelText("Due Date")).toHaveValue("2026-12-25");

    rerender(<TaskForm editingTask={task({ id: 2, dueDate: undefined })} onTaskCreated={vi.fn()} />);
    expect(screen.getByLabelText("Due Date")).toHaveValue("");
  });

  it("lets an overdue task be edited (no min date in edit mode)", () => {
    render(<TaskForm editingTask={task({ dueDate: "2020-01-01T00:00:00.000Z" })} onTaskCreated={vi.fn()} />);
    expect(screen.getByLabelText("Due Date")).not.toHaveAttribute("min");
  });

  it("blocks past dates for new tasks", () => {
    render(<TaskForm editingTask={null} onTaskCreated={vi.fn()} />);
    expect(screen.getByLabelText("Due Date")).toHaveAttribute("min");
  });

  it("creates a task and sends null for an empty due date", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    const onCreated = vi.fn();
    render(<TaskForm editingTask={null} onTaskCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("Title"), "Write tests");
    await userEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/tasks", {
        title: "Write tests",
        description: "",
        status: "TODO",
        dueDate: null,
      })
    );
    expect(onCreated).toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("offers Cancel only while editing", async () => {
    const onCancel = vi.fn();
    const { rerender } = render(<TaskForm editingTask={null} onTaskCreated={vi.fn()} onCancelEdit={onCancel} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    rerender(<TaskForm editingTask={task({})} onTaskCreated={vi.fn()} onCancelEdit={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
