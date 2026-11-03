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
import type { CustomField, TaskDetail } from "../types/Task";

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

const me = { id: 1, email: "me@example.com", name: null };
const sam = { id: 2, email: "sam@example.com", name: "Sam" };
const members = [
  { userId: 1, email: me.email, name: null, role: "ORG_ADMIN" },
  { userId: 2, email: sam.email, name: "Sam", role: "MEMBER" },
  { userId: 3, email: "client@example.com", name: "Cleo", role: "CLIENT" },
];
const project = makeProject();
const priorityField: CustomField = {
  id: "f1",
  projectId: "p1",
  name: "Severity",
  type: "SELECT",
  options: [
    { id: "opt_aaaaaaaa", label: "Minor", color: "#64748b" },
    { id: "opt_bbbbbbbb", label: "Major", color: "#ef4444" },
  ],
  required: false,
  description: null,
  position: 1,
};

/** Base API: a project, its fields, members; `detail` answers GET /tasks/:id. */
const api = (detail?: TaskDetail, extra: [string | RegExp, unknown][] = []) =>
  apiMock.get.mockImplementation(
    routes([
      ...extra,
      ["/projects", [project]],
      ["/projects/p1", project],
      ["/projects/p1/fields", [priorityField]],
      [/^\/projects\/p1\//, []],
      ["/tasks", page([])],
      ...(detail ? ([[`/tasks/${detail.id}`, detail]] as [string, unknown][]) : []),
      ["/labels", []],
      ["/views", []],
      ["/templates", []],
      ["/orgs/current/members", members],
      ["/approvals/count", { pending: 0 }],
      ["/attachments/usage", { usedBytes: 2048, files: 1, quotaBytes: 1024 * 1024 * 1024, maxFileBytes: 10 * 1024 * 1024, allowedExtensions: ["png", "pdf"] }],
    ])
  );

const openDrawer = async () => {
  const drawer = await screen.findByRole("dialog", { name: "Task details" });
  await within(drawer).findByLabelText("Title");
  return drawer;
};

beforeEach(() => resetApiMock());

describe("Custom fields in the task drawer", () => {
  it("shows the project's fields and saves a choice as a customFields patch", async () => {
    api(makeDetail({ id: 50, title: "Crash on save" }));
    apiMock.patch.mockResolvedValue({ data: makeTask({ id: 50 }) });
    renderAt("/projects/p1/board?task=50");
    const drawer = await openDrawer();
    await userEvent.selectOptions(await within(drawer).findByLabelText("Severity"), "opt_bbbbbbbb");
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tasks/50", { customFields: { f1: "opt_bbbbbbbb" } }));
  });
});

describe("Approvals", () => {
  it("lets a named approver approve from the drawer", async () => {
    const detail = makeDetail({
      id: 60,
      title: "Final logo",
      status: "IN_REVIEW",
      approvals: [
        {
          id: "apr1",
          rule: "ANY",
          status: "PENDING",
          note: "Please check colours",
          createdAt: "2026-11-02T10:00:00.000Z",
          decidedAt: null,
          consumedAt: null,
          requestedBy: sam,
          steps: [{ decision: "PENDING", comment: null, decidedAt: null, approver: me }],
        },
      ],
    });
    api(detail);
    apiMock.post.mockResolvedValue({ data: { status: "APPROVED", completed: true } });
    renderAt("/projects/p1/board?task=60");
    const drawer = await openDrawer();
    expect(within(drawer).getByText("Please check colours")).toBeInTheDocument();
    await userEvent.type(within(drawer).getByLabelText("Comment for the requester"), "Ship it");
    await userEvent.click(within(drawer).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/approvals/apr1/decision", { decision: "APPROVE", comment: "Ship it" }));
  });

  it("requests approval from chosen people, never offering yourself", async () => {
    api(makeDetail({ id: 61, title: "Brochure" }));
    apiMock.post.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/board?task=61");
    const drawer = await openDrawer();
    await userEvent.click(within(drawer).getByRole("button", { name: "Request approval" }));
    const dialog = await screen.findByRole("dialog", { name: "Request approval" });
    expect(within(dialog).queryByRole("checkbox", { name: /me/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Cleo/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tasks/61/approvals", { approverIds: [3], rule: "ANY", note: null }));
  });

  it("lists approvals waiting on me", async () => {
    api(undefined, [
      [
        "/approvals",
        [
          {
            id: "apr2",
            rule: "ANY",
            status: "PENDING",
            note: null,
            createdAt: "2026-11-02T10:00:00.000Z",
            decidedAt: null,
            consumedAt: null,
            requestedBy: sam,
            steps: [{ decision: "PENDING", comment: null, decidedAt: null, approver: me }],
            task: { id: 70, key: "GEN-70", number: 70, title: "Contract draft", status: "IN_REVIEW", dueDate: null, project: project },
          },
        ],
      ],
    ]);
    renderAt("/approvals");
    expect(await screen.findByText("Contract draft")).toBeInTheDocument();
    expect(screen.getByText("GEN-70")).toBeInTheDocument();
    expect(screen.getByText(/from Sam/)).toBeInTheDocument();
  });
});

describe("Recurring tasks", () => {
  it("saves a weekly rule on chosen days", async () => {
    api(makeDetail({ id: 80, title: "Standup notes", dueDate: "2026-11-05T00:00:00.000Z" }));
    apiMock.put.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/board?task=80");
    const drawer = await openDrawer();
    await userEvent.click(within(drawer).getByRole("button", { name: "Make recurring" }));
    const dialog = await screen.findByRole("dialog", { name: "Repeat task" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Mon" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Thu" }));
    await userEvent.click(within(dialog).getByRole("radio", { name: /After/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiMock.put).toHaveBeenCalledWith("/tasks/80/recurrence", { frequency: "WEEKLY", interval: 1, weekdays: [0, 3], monthDay: null, endsOn: null, maxOccurrences: 10 })
    );
  });

  it("shows an active rule and links to the next occurrence", async () => {
    api(
      makeDetail({
        id: 81,
        title: "Invoice",
        isRecurring: true,
        recurrence: { id: "s1", frequency: "MONTHLY", interval: 1, weekdays: [], monthDay: 1, endsOn: null, maxOccurrences: null, occurrences: 2, active: true, summary: "Every month on day 1" },
        nextOccurrence: { id: 82, key: "GEN-82" },
      })
    );
    renderAt("/projects/p1/board?task=81");
    const drawer = await openDrawer();
    expect(within(drawer).getByText("Every month on day 1")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /Next: GEN-82/ })).toBeInTheDocument();
  });
});

describe("Attachments", () => {
  it("uploads the chosen file as multipart form data", async () => {
    api(makeDetail({ id: 90, title: "Specs" }));
    apiMock.post.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/board?task=90");
    await openDrawer();
    const file = new File(["%PDF-1.4"], "spec.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Choose a file to upload"), file);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    const [url, body] = apiMock.post.mock.calls[0];
    expect(url).toBe("/tasks/90/attachments");
    expect((body as FormData).get("file")).toBe(file);
  });

  it("read-only users can download but not upload or delete", async () => {
    api(
      makeDetail({
        id: 91,
        permissions: { edit: false, delete: false, createSubtasks: false },
        attachments: [{ id: "a1", fileName: "brief.pdf", mimeType: "application/pdf", size: 52_000, createdAt: "2026-11-02T10:00:00.000Z", uploadedBy: sam }],
      })
    );
    renderAt("/projects/p1/board?task=91", "VIEWER");
    const drawer = await openDrawer();
    expect(within(drawer).getByText("brief.pdf")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Download brief.pdf" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Remove brief.pdf" })).not.toBeInTheDocument();
  });
});

describe("Templates", () => {
  it("creates a task from a template through the apply endpoint", async () => {
    const template = {
      id: "t1",
      name: "Bug report",
      description: null,
      projectId: "p1",
      subtaskCount: 2,
      checklistCount: 3,
      payload: { title: "Bug: ", priority: "HIGH", dueInDays: 2, checklist: ["a", "b", "c"], subtasks: [{ title: "x" }, { title: "y" }] },
    };
    api(undefined, [["/templates", [template]]]);
    apiMock.post.mockResolvedValue({ data: makeTask({ id: 95, key: "GEN-95" }) });
    renderAt("/projects/p1/board");
    await userEvent.click(await screen.findByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    await userEvent.selectOptions(await within(dialog).findByLabelText("Template"), "t1");
    expect(within(dialog).getByLabelText("Task title")).toHaveValue("Bug: ");
    expect(within(dialog).getByText(/3 checklist items and 2 subtasks/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Task title"), "login fails");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith("/templates/t1/apply", { projectId: "p1", title: "Bug: login fails", assigneeId: null, customFields: {} })
    );
  });
});

describe("Project settings", () => {
  it("adds a single-select custom field with its options", async () => {
    api();
    apiMock.post.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "New custom field" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Stage");
    await userEvent.selectOptions(within(dialog).getByLabelText("Type"), "SELECT");
    await userEvent.type(within(dialog).getByLabelText("New option"), "Draft{Enter}");
    await userEvent.type(within(dialog).getByLabelText("New option"), "Final{Enter}");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Required/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith("/projects/p1/fields", {
        name: "Stage",
        type: "SELECT",
        required: true,
        description: null,
        options: [
          { label: "Draft", color: "#64748b" },
          { label: "Final", color: "#ef4444" },
        ],
      })
    );
  });

  it("turns on required completion approval", async () => {
    api();
    apiMock.patch.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/settings");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Require an approval/ }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/projects/p1", { completionApproval: "REQUIRED" }));
  });
});
