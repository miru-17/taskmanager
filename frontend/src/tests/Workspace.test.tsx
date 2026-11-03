import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { ThemeProvider } from "../context/ThemeContext";
import { TestProviders } from "./providers";
import { apiMock, makeSession, resetApiMock, restoreAs } from "./mockApi";
import { makeDetail, makeProject, makeTask, page, routes } from "./fixtures";
import type { OrgRole } from "../types/auth";

vi.mock("../services/api", async () => (await import("./mockApi")).apiModule);

const renderAt = (path: string, role: OrgRole = "ORG_ADMIN") => {
  restoreAs(makeSession(role));
  return render(
    <ThemeProvider>
      <TestProviders>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
        <Toaster />
      </TestProviders>
    </ThemeProvider>
  );
};

const members = [
  { userId: 1, email: "me@example.com", name: null, role: "ORG_ADMIN" },
  { userId: 2, email: "sam@example.com", name: "Sam", role: "MEMBER" },
];

beforeEach(() => {
  resetApiMock();
  document.documentElement.removeAttribute("data-theme");
});

describe("App shell", () => {
  it("shows navigation and real projects; clients get no Teams or New task", async () => {
    apiMock.get.mockImplementation(routes([["/projects", [makeProject({ name: "Website", key: "WEB" })]], ["/tasks", page([])]]));
    renderAt("/my-tasks", "CLIENT");
    expect(await screen.findByRole("link", { name: /Website/ })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Teams" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: /New task/ })).not.toBeInTheDocument();
  });

  it("toggles the theme on <html>", async () => {
    apiMock.get.mockImplementation(routes([["/projects", []], ["/tasks", page([])]]));
    renderAt("/my-tasks");
    const toggle = await screen.findByRole("button", { name: /Switch to (dark|light) theme/ });
    const before = document.documentElement.getAttribute("data-theme");
    await userEvent.click(toggle);
    expect(document.documentElement.getAttribute("data-theme")).not.toBe(before);
  });
});

describe("My tasks", () => {
  it("asks the server for my open tasks and groups them by due date", async () => {
    const overdue = makeTask({ id: 1, title: "Late report", dueDate: "2020-01-01T00:00:00.000Z" });
    const later = makeTask({ id: 2, title: "Plan offsite" });
    apiMock.get.mockImplementation(routes([["/projects", []], ["/tasks", page([overdue, later])]]));
    renderAt("/my-tasks");

    expect(await screen.findByRole("region", { name: "Overdue" })).toHaveTextContent("Late report");
    expect(screen.getByRole("region", { name: "No due date" })).toHaveTextContent("Plan offsite");
    const params = apiMock.get.mock.calls.find(([url]) => url === "/tasks")![1].params;
    expect(params).toMatchObject({ assigneeId: "me", status: "TODO,IN_PROGRESS,IN_REVIEW", sort: "dueDate" });
  });

  it("switches to created-by-me", async () => {
    apiMock.get.mockImplementation(routes([["/projects", []], ["/tasks", page([])]]));
    renderAt("/my-tasks");
    await userEvent.click(await screen.findByRole("button", { name: "Created by me" }));
    await waitFor(() => expect(apiMock.get.mock.calls.some(([url, c]) => url === "/tasks" && c?.params?.createdById === "me")).toBe(true));
    expect(await screen.findByText(/haven't created any open tasks/)).toBeInTheDocument();
  });
});

describe("Project board", () => {
  const project = makeProject();

  it("renders a column per status with real counts and opens a task in the drawer", async () => {
    const tasks = [makeTask({ id: 11, title: "Design login" }), makeTask({ id: 12, title: "Ship it", status: "DONE" })];
    apiMock.get.mockImplementation(
      routes([
        ["/projects", [project]],
        ["/projects/p1", project],
        [/^\/projects\/p1\/(milestones|members)$/, []],
        ["/tasks", page(tasks)],
        ["/tasks/11", makeDetail({ id: 11, title: "Design login" })],
        ["/orgs/current/members", members],
        ["/labels", []],
        ["/views", []],
      ])
    );
    renderAt("/projects/p1/board");

    const todo = await screen.findByRole("region", { name: "To do" });
    expect(within(todo).getByText("Design login")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Done" })).getByText("Ship it")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "In review" })).getByText("No tasks")).toBeInTheDocument();

    await userEvent.click(within(todo).getByText("Design login"));
    const drawer = await screen.findByRole("dialog", { name: "Task details" });
    expect(await within(drawer).findByLabelText("Title")).toHaveValue("Design login");
  });

  it("is read-only for a project viewer: no New task, no add buttons", async () => {
    const readonly = makeProject({ capabilities: { projectId: "p1", manage: false, createTasks: false, editTasks: "none", deleteTasks: "none", projectRole: "VIEWER" } });
    apiMock.get.mockImplementation(routes([["/projects", [readonly]], ["/projects/p1", readonly], ["/tasks", page([makeTask({ id: 5 })])], ["/labels", []], ["/views", []], ["/orgs/current/members", members]]));
    renderAt("/projects/p1/board", "VIEWER");
    await screen.findByRole("region", { name: "To do" });
    expect(screen.queryByRole("button", { name: "New task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add task to/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only for you/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("shows a not-found state for a project you can't see", async () => {
    apiMock.get.mockImplementation(routes([["/projects", []]]));
    renderAt("/projects/secret/board");
    expect(await screen.findByText("Project not found")).toBeInTheDocument();
  });
});

describe("List view and bulk actions", () => {
  it("sends the selected ids and the chosen status in one bulk request", async () => {
    const project = makeProject();
    const tasks = [makeTask({ id: 21, title: "Alpha" }), makeTask({ id: 22, title: "Beta" }), makeTask({ id: 23, title: "Gamma" })];
    apiMock.get.mockImplementation(routes([["/projects", [project]], ["/projects/p1", project], [/^\/projects\/p1\//, []], ["/tasks", page(tasks)], ["/labels", []], ["/views", []], ["/orgs/current/members", members]]));
    apiMock.post.mockResolvedValue({ data: { updated: 2 } });
    renderAt("/projects/p1/list");

    await userEvent.click(await screen.findByRole("checkbox", { name: "Select GEN-21" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select GEN-23" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(bar).toHaveTextContent("2 selected");
    await userEvent.selectOptions(within(bar).getByRole("combobox", { name: "Set status" }), "DONE");

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tasks/bulk", { ids: [21, 23], action: "update", data: { status: "DONE" } }));
  });

  it("sorts by a column through the API", async () => {
    const project = makeProject();
    apiMock.get.mockImplementation(routes([["/projects", [project]], ["/projects/p1", project], [/^\/projects\/p1\//, []], ["/tasks", page([makeTask({ id: 31 })])], ["/labels", []], ["/views", []], ["/orgs/current/members", members]]));
    renderAt("/projects/p1/list");
    await userEvent.click(await screen.findByRole("button", { name: "Priority" }));
    await waitFor(() => expect(apiMock.get.mock.calls.some(([u, c]) => u === "/tasks" && c?.params?.sort === "priority" && c.params.order === "asc")).toBe(true));
  });
});

describe("Task drawer", () => {
  const project = makeProject();
  const base = routes([["/projects", [project]], ["/projects/p1", project], [/^\/projects\/p1\//, []], ["/tasks", page([])], ["/labels", []], ["/views", []], ["/orgs/current/members", members]]);

  it("explains a blocked task and adds checklist items", async () => {
    const detail = makeDetail({ id: 40, title: "Deploy", isBlocked: true, blockedBy: [39], dependencies: [{ id: 39, key: "GEN-39", title: "Review", status: "IN_REVIEW" }] });
    apiMock.get.mockImplementation(async (url: string, c?: { params?: Record<string, string> }) => (url === "/tasks/40" ? { data: detail } : base(url, c)));
    apiMock.post.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/board?task=40");

    const drawer = await screen.findByRole("dialog", { name: "Task details" });
    expect(await within(drawer).findByText(/Blocked by GEN-39/)).toBeInTheDocument();
    await userEvent.type(within(drawer).getByLabelText("Add checklist item"), "Write runbook{Enter}");
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tasks/40/checklist", { text: "Write runbook" }));
  });

  it("disables editing when the server says you can't edit", async () => {
    const detail = makeDetail({ id: 41, title: "Locked", permissions: { edit: false, delete: false, createSubtasks: false } });
    apiMock.get.mockImplementation(async (url: string, c?: { params?: Record<string, string> }) => (url === "/tasks/41" ? { data: detail } : base(url, c)));
    renderAt("/projects/p1/board?task=41", "VIEWER");
    const drawer = await screen.findByRole("dialog", { name: "Task details" });
    expect(await within(drawer).findByLabelText("Title")).toBeDisabled();
    expect(within(drawer).getByLabelText("Status")).toBeDisabled();
    expect(within(drawer).queryByRole("button", { name: "Delete task" })).not.toBeInTheDocument();
    expect(within(drawer).queryByLabelText("Add checklist item")).not.toBeInTheDocument();
  });

  it("shows the server's 404 as an access message", async () => {
    apiMock.get.mockImplementation(async (url: string, c?: { params?: Record<string, string> }) => base(url, c));
    renderAt("/projects/p1/board?task=999");
    expect(await screen.findByText(/doesn't exist or you don't have access/)).toBeInTheDocument();
  });

  it("saves a status change and reverts with the server's message when blocked", async () => {
    const detail = makeDetail({ id: 42, title: "Blocked one" });
    apiMock.get.mockImplementation(async (url: string, c?: { params?: Record<string, string> }) => (url === "/tasks/42" ? { data: detail } : base(url, c)));
    apiMock.patch.mockRejectedValue({ response: { status: 409, data: { code: "TASK_BLOCKED", message: "This task is blocked by GEN-1. Finish those first." } } });
    renderAt("/projects/p1/board?task=42");
    const drawer = await screen.findByRole("dialog", { name: "Task details" });
    await userEvent.selectOptions(await within(drawer).findByLabelText("Status"), "DONE");
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tasks/42", { status: "DONE" }));
    expect(await screen.findByText("This task is blocked by GEN-1. Finish those first.")).toBeInTheDocument();
    // The server is the source of truth: after the refusal the field shows the stored value again
    await waitFor(() => expect(within(drawer).getByLabelText("Status")).toHaveValue("TODO"));
  });
});

describe("Task composer", () => {
  it("creates a task with the chosen fields in the current project", async () => {
    const project = makeProject();
    apiMock.get.mockImplementation(routes([["/projects", [project]], ["/projects/p1", project], [/^\/projects\/p1\//, []], ["/tasks", page([])], ["/labels", []], ["/views", []], ["/orgs/current/members", members]]));
    apiMock.post.mockResolvedValue({ data: makeTask({ id: 77, key: "GEN-77" }) });
    renderAt("/projects/p1/board");

    await userEvent.click(await screen.findByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    await userEvent.type(within(dialog).getByLabelText("Task title"), "Write tests");
    await userEvent.selectOptions(within(dialog).getByLabelText("Priority"), "HIGH");
    await userEvent.selectOptions(within(dialog).getByLabelText("Assignee"), "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith("/tasks", expect.objectContaining({ title: "Write tests", priority: "HIGH", assigneeId: 2, projectId: "p1", status: "TODO" }))
    );
  });
});
