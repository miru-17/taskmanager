import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Home from "../pages/Home";
import { AuthProvider } from "../context/AuthContext";
import api from "../services/api";

vi.mock("../services/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockedApi = vi.mocked(api);

const renderHome = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <Home />
      </AuthProvider>
    </MemoryRouter>
  );

const overdueTask = {
  id: 7,
  title: "Overdue report",
  description: "late",
  status: "TODO" as const,
  dueDate: "2020-01-01T00:00:00.000Z",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("Home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("token", "t");
    localStorage.setItem("user", JSON.stringify({ id: 1, email: "me@example.com" }));
  });

  it("shows the loading state, then the empty state", async () => {
    mockedApi.get.mockResolvedValue({ data: [] });
    renderHome();

    expect(screen.getByText(/Loading Task Manager/i)).toBeInTheDocument();
    expect(await screen.findByText(/No Tasks Found/i)).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
  });

  it("computes dashboard counts from the loaded tasks", async () => {
    mockedApi.get.mockResolvedValue({
      data: [overdueTask, { ...overdueTask, id: 8, title: "Done one", status: "DONE" }],
    });
    renderHome();

    await screen.findByText("Overdue report");
    const total = screen.getByText("Total Tasks").parentElement!;
    expect(total).toHaveTextContent("2");
  });

  it("changes status with a partial update that does not resend the due date", async () => {
    mockedApi.get.mockResolvedValue({ data: [overdueTask] });
    mockedApi.patch.mockResolvedValue({ data: { ...overdueTask, status: "DONE" } });
    renderHome();

    await screen.findByText("Overdue report");
    const statusSelect = screen.getAllByRole("combobox").find((el) => (el as HTMLSelectElement).value === "TODO" && !el.id)!;
    await userEvent.selectOptions(statusSelect, "DONE");

    await waitFor(() => expect(mockedApi.patch).toHaveBeenCalledWith("/tasks/7", { status: "DONE" }));
    expect(mockedApi.put).not.toHaveBeenCalled();
  });

  it("shows an error screen with a working retry", async () => {
    mockedApi.get.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ data: [] });
    renderHome();

    await userEvent.click(await screen.findByRole("button", { name: /retry/i }));
    expect(await screen.findByText(/No Tasks Found/i)).toBeInTheDocument();
  });
});
