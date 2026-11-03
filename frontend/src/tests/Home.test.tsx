import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Home from "../pages/Home";
import { AuthProvider } from "../context/AuthContext";
import ProtectedRoute from "../routes/ProtectedRoute";
import { apiMock, makeSession, resetApiMock, restoreAs } from "./mockApi";

vi.mock("../services/api", async () => (await import("./mockApi")).apiModule);
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const renderHome = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <ProtectedRoute>
          <Home />
        </ProtectedRoute>
      </AuthProvider>
    </MemoryRouter>
  );

const task = (id: number, title: string, createdById: number, status = "TODO") => ({
  id,
  title,
  status,
  description: null,
  dueDate: null,
  createdById,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

beforeEach(() => {
  resetApiMock();
});

describe("Home", () => {
  it("restores the session silently and shows the organization's tasks", async () => {
    restoreAs(makeSession("ORG_ADMIN"));
    apiMock.get.mockResolvedValue({ data: [task(1, "Ship v2", 9)] });
    renderHome();

    expect(await screen.findByText("Ship v2")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Organization Admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Task/ })).toBeInTheDocument();
  });

  it("clears tokens left in localStorage by older versions", async () => {
    localStorage.setItem("token", "legacy");
    localStorage.setItem("user", "{}");
    restoreAs(makeSession());
    apiMock.get.mockResolvedValue({ data: [] });
    renderHome();
    await screen.findByText(/No Tasks Found/);
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("shows a MEMBER edit/delete only on tasks they created", async () => {
    restoreAs(makeSession("MEMBER"));
    apiMock.get.mockResolvedValue({ data: [task(1, "Mine", 1), task(2, "Someone else's", 2)] });
    renderHome();

    const mine = (await screen.findByText("Mine")).closest("div.group") as HTMLElement;
    const theirs = screen.getByText("Someone else's").closest("div.group") as HTMLElement;
    expect(within(mine).getByRole("button", { name: /Edit/ })).toBeInTheDocument();
    expect(within(mine).getByRole("button", { name: /Delete/ })).toBeInTheDocument();
    expect(within(theirs).queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(within(theirs).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(within(theirs).getByRole("combobox")).toBeDisabled();
  });

  it("gives a VIEWER a read-only board", async () => {
    restoreAs(makeSession("VIEWER"));
    apiMock.get.mockResolvedValue({ data: [task(1, "Read me", 2)] });
    renderHome();
    await screen.findByText("Read me");
    expect(screen.queryByRole("button", { name: /Create Task/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("tells a CLIENT they have no task access instead of failing", async () => {
    restoreAs(makeSession("CLIENT"));
    renderHome();
    expect(await screen.findByText(/No task access yet/)).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalledWith("/tasks");
  });

  it("switches organization from the header", async () => {
    const acme = { id: "org1", name: "Acme", slug: "a", role: "ORG_ADMIN" as const };
    const globex = { id: "org2", name: "Globex", slug: "g", role: "MEMBER" as const };
    restoreAs(makeSession("ORG_ADMIN", { organizations: [acme, globex] }));
    apiMock.get.mockResolvedValue({ data: [] });
    apiMock.post.mockResolvedValue({ data: makeSession("MEMBER", { organization: globex, organizations: [acme, globex] }) });
    renderHome();

    await userEvent.selectOptions(await screen.findByLabelText("Active organization"), "org2");
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/auth/switch-organization", { organizationId: "org2" }));
    expect(await screen.findByText("Team Member")).toBeInTheDocument();
  });

  it("updates status with a partial PATCH", async () => {
    restoreAs(makeSession("ORG_ADMIN"));
    apiMock.get.mockResolvedValue({ data: [task(7, "Overdue", 1)] });
    apiMock.patch.mockResolvedValue({ data: {} });
    renderHome();
    await userEvent.selectOptions(await screen.findByLabelText("Status of Overdue"), "DONE");
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tasks/7", { status: "DONE" }));
  });

  it("offers to create an organization when the user has none", async () => {
    restoreAs(makeSession("ORG_ADMIN", { organization: null, organizations: [], permissions: [] }));
    renderHome();
    expect(await screen.findByText(/not in an organization/)).toBeInTheDocument();
  });

  it("sends an anonymous visitor to the login page", async () => {
    restoreAs(null);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/login" element={<p>login page</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });
});
