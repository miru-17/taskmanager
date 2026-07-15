import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Home from "../pages/Home";
import api from "../services/api";

vi.mock("../services/api", () => ({
  default: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Dashboard
vi.mock("../components/DashboardStats", () => ({
  default: () => <div>Dashboard</div>,
}));

// Mock Search
vi.mock("../components/TaskSearch", () => ({
  default: ({ value, onChange }: any) => (
    <input
      placeholder="Search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// Mock TaskForm
vi.mock("../components/TaskForm", () => ({
  default: ({ onTaskCreated, editingTask }: any) => (
    <div>
      <button onClick={onTaskCreated}>Mock Create</button>
      {editingTask && <span>Editing: {editingTask.title}</span>}
    </div>
  ),
}));

// Mock TaskCard
vi.mock("../components/TaskCard", () => ({
  default: ({ task, onEdit, onDelete }: any) => (
    <div>
      <span>{task.title}</span>

      <button onClick={() => onEdit(task)}>
        Edit
      </button>

      <button onClick={() => onDelete(task.id)}>
        Delete
      </button>
    </div>
  ),
}));

// Mock ConfirmModal
vi.mock("../components/ConfirmModal", () => ({
  default: ({ isOpen, onConfirm }: any) =>
    isOpen ? (
      <button onClick={onConfirm}>
        Confirm Delete
      </button>
    ) : null,
}));

const tasks = [
  {
    id: 1,
    title: "Learn React",
    description: "Frontend",
    status: "TODO",
    dueDate: "2026-07-20",
    createdAt: "",
    updatedAt: "",
  },
];

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders tasks from API", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: tasks,
    });

    render(<Home />);

    expect(await screen.findByText("Learn React")).toBeInTheDocument();

    expect(api.get).toHaveBeenCalledWith("/tasks");
  });

  it("refreshes tasks after create", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: tasks })
      .mockResolvedValueOnce({ data: tasks });

    render(<Home />);

    await screen.findByText("Learn React");

    fireEvent.click(screen.getByText("Mock Create"));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });

  it("enters edit mode when Edit is clicked", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: tasks,
    });

    render(<Home />);

    await screen.findByText("Learn React");

    fireEvent.click(screen.getByText("Edit"));

    expect(
      screen.getByText("Editing: Learn React")
    ).toBeInTheDocument();
  });

  it("deletes a task and refreshes list", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: tasks })
      .mockResolvedValueOnce({ data: [] });

    vi.mocked(api.delete).mockResolvedValueOnce({
      data: {},
    });

    render(<Home />);

    await screen.findByText("Learn React");

    fireEvent.click(screen.getByText("Delete"));

    fireEvent.click(screen.getByText("Confirm Delete"));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/tasks/1");
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });

  it("filters tasks using search", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        ...tasks,
        {
          id: 2,
          title: "NodeJS",
          description: "",
          status: "DONE",
          dueDate: "",
          createdAt: "",
          updatedAt: "",
        },
      ],
    });

    render(<Home />);

    await screen.findByText("Learn React");

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: {
        value: "Node",
      },
    });

    expect(screen.getByText("NodeJS")).toBeInTheDocument();

    expect(screen.queryByText("Learn React")).not.toBeInTheDocument();
  });
});