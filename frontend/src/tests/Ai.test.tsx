import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { TestProviders } from "./providers";
import { apiMock, makeSession, resetApiMock, restoreAs } from "./mockApi";
import { makeDetail, makeProject, makeTask, page, routes } from "./fixtures";
import OrganizationSettings from "../pages/OrganizationSettings";
import type { OrgRole } from "../types/auth";

vi.mock("../services/api", async () => (await import("./mockApi")).apiModule);

const project = makeProject();
const members = [
  { userId: 1, email: "me@example.com", name: "Me", role: "ORG_ADMIN" },
  { userId: 2, email: "sam@x.test", name: "Sam Lee", role: "MEMBER" },
];
const rulesStatus = { configured: false, model: null, orgEnabled: true, mode: "rules", reason: "not_configured" };
const api = (extra: [string | RegExp, unknown][] = [], status: unknown = rulesStatus) =>
  apiMock.get.mockImplementation(
    routes([
      ...extra,
      ["/ai/status", status],
      ["/projects", [project]],
      ["/projects/p1", project],
      [/^\/projects\/p1\//, []],
      [/^\/tasks\/\d+\/comments$/, []],
      ["/tasks", page([])],
      ["/labels", [{ id: "l1", name: "urgent", color: "#f00" }]],
      ["/views", []],
      ["/templates", []],
      ["/orgs/current/members", members],
      ["/approvals/count", { pending: 0 }],
      ["/notifications/count", { unread: 0 }],
      ["/attachments/usage", { usedBytes: 0, files: 0, quotaBytes: 1, maxFileBytes: 1, allowedExtensions: [] }],
    ])
  );

const renderAt = (path: string, role: OrgRole = "ORG_ADMIN") => {
  restoreAs(makeSession(role));
  return render(
    <TestProviders>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
      <Toaster />
    </TestProviders>
  );
};
const post = (handlers: Record<string, unknown>) =>
  apiMock.post.mockImplementation(async (url: string) => {
    for (const [k, v] of Object.entries(handlers)) if (url === k || new RegExp(`^${k}$`).test(url)) return { data: typeof v === "function" ? (v as () => unknown)() : v };
    throw { response: { status: 404, data: { message: `No mock for POST ${url}` } } };
  });

beforeEach(() => resetApiMock());

describe("Describe-it task entry", () => {
  it("fills the form from text, labels where it came from, and creates nothing until Create", async () => {
    api();
    post({
      "/ai/parse": { source: "rules", fallbackReason: "not_configured", draft: { title: "Fix checkout bug", description: null, priority: "HIGH", dueDate: "2026-11-06", assigneeId: 2, labelIds: ["l1"], projectId: "p1" }, understood: ["label", "priority", "due date", "assignee"], dropped: [] },
      "/tasks": makeTask({ id: 77, key: "GEN-77" }),
    });
    renderAt("/projects/p1/board");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    await user.type(within(dialog).getByLabelText("Describe the task"), "Fix checkout bug for @sam by friday #urgent high priority");
    await user.click(within(dialog).getByRole("button", { name: "Fill in" }));

    await waitFor(() => expect(within(dialog).getByLabelText("Task title")).toHaveValue("Fix checkout bug"));
    expect(apiMock.post).toHaveBeenCalledWith("/ai/parse", expect.objectContaining({ text: "Fix checkout bug for @sam by friday #urgent high priority", projectId: "p1", tz: expect.any(String) }));
    expect(within(dialog).getByLabelText("Priority")).toHaveValue("HIGH");
    expect(within(dialog).getByLabelText("Assignee")).toHaveValue("2");
    expect(within(dialog).getByText("Rule-based")).toBeInTheDocument();
    expect(within(dialog).getByText(/Filled in the title and label, priority, due date, assignee\. Review before creating\./)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalledWith("/tasks", expect.anything());

    await user.click(within(dialog).getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tasks", expect.objectContaining({ title: "Fix checkout bug", priority: "HIGH", assigneeId: 2, dueDate: "2026-11-06", labelIds: ["l1"], projectId: "p1" })));
  });

  it("says when a model's suggestion was ignored", async () => {
    api();
    post({ "/ai/parse": { source: "ai", fallbackReason: null, draft: { title: "Ship it", description: "With QA", labelIds: [] }, understood: ["description"], dropped: ["assignee"] } });
    renderAt("/projects/p1/board");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    await user.type(within(dialog).getByLabelText("Describe the task"), "ship it{Enter}");
    expect(await within(dialog).findByText("AI suggestion")).toBeInTheDocument();
    expect(within(dialog).getByText(/Ignored a suggested assignee/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Description")).toHaveValue("With QA");
  });
});

describe("Task panel assist", () => {
  it("summarizes, and adds only the subtasks you keep", async () => {
    api([["/tasks/10", makeDetail({ id: 10, key: "GEN-10", projectId: "p1" })]]);
    post({
      "/ai/tasks/10/summary": { source: "rules", fallbackReason: "not_configured", summary: "To do, medium priority, unassigned, no due date.", highlights: ["1 comment; latest from Sam"] },
      "/ai/tasks/10/breakdown": { source: "rules", fallbackReason: "not_configured", basis: "template", subtasks: [{ title: "Reproduce it", estimateHours: null }, { title: "Fix it", estimateHours: null }, { title: "Verify", estimateHours: null }] },
      "/tasks": makeTask({ id: 11 }),
    });
    renderAt("/projects/p1/board?task=10");
    const user = userEvent.setup();
    const drawer = await screen.findByRole("dialog", { name: "Task details" });

    await user.click(await within(drawer).findByRole("button", { name: "Summarize" }));
    expect(await within(drawer).findByText("To do, medium priority, unassigned, no due date.")).toBeInTheDocument();
    expect(within(drawer).getByText("1 comment; latest from Sam")).toBeInTheDocument();

    await user.click(within(drawer).getByRole("button", { name: "Break down" }));
    const dlg = await screen.findByRole("dialog", { name: "Break down GEN-10" });
    expect(within(dlg).getByText("A general plan for this kind of task.")).toBeInTheDocument();
    await user.click(within(dlg).getByLabelText("Include subtask 3"));
    await user.clear(within(dlg).getByLabelText("Subtask 1 title"));
    await user.type(within(dlg).getByLabelText("Subtask 1 title"), "Reproduce on Safari");
    await user.type(within(dlg).getByLabelText("Subtask 2 estimate in hours"), "2");
    await user.click(within(dlg).getByRole("button", { name: "Add 2 subtasks" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Break down GEN-10" })).not.toBeInTheDocument());
    const created = apiMock.post.mock.calls.filter(([u]) => u === "/tasks").map(([, b]) => b);
    expect(created).toEqual([
      { title: "Reproduce on Safari", projectId: "p1", parentId: 10, estimateHours: null },
      { title: "Fix it", projectId: "p1", parentId: 10, estimateHours: 2 },
    ]);
  });

  it("hides Break down from people who can't add subtasks", async () => {
    api([["/tasks/10", makeDetail({ id: 10, permissions: { edit: false, delete: false, createSubtasks: false } })]]);
    renderAt("/projects/p1/board?task=10", "VIEWER");
    const drawer = await screen.findByRole("dialog", { name: "Task details" });
    expect(await within(drawer).findByRole("button", { name: "Summarize" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Break down" })).not.toBeInTheDocument();
  });
});

describe("Project assist", () => {
  it("shows risks with workload, and applies only the ticked priority changes, grouped", async () => {
    api();
    post({
      "/ai/projects/p1/risks": {
        source: "ai",
        fallbackReason: null,
        narrative: "Assign the payment bug today.",
        openTasks: 5,
        risks: [{ kind: "critical_unassigned", severity: "high", title: "1 high-priority task with no owner", detail: "Nobody is assigned.", tasks: [{ id: 7, key: "GEN-7", title: "Payments down" }] }],
        workload: [{ user: { id: 2, name: "Sam Lee" }, open: 4, overdue: 1, dueNext7: 3, hoursNext7: 12, unestimatedNext7: 1 }, { user: null, open: 1, overdue: 0, dueNext7: 0, hoursNext7: 0, unestimatedNext7: 0 }],
      },
      "/ai/projects/p1/prioritize": {
        source: "rules",
        fallbackReason: "not_configured",
        suggestions: [
          { taskId: 1, key: "GEN-1", title: "Late", current: "LOW", suggested: "HIGH", reason: "Overdue by 3 days" },
          { taskId: 2, key: "GEN-2", title: "Soon", current: "MEDIUM", suggested: "HIGH", reason: "Due in 1 day" },
          { taskId: 3, key: "GEN-3", title: "Stale", current: "HIGH", suggested: "MEDIUM", reason: "Untouched" },
        ],
      },
      "/tasks/bulk": {},
    });
    renderAt("/projects/p1/overview");
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Project assistant" });

    await user.click(within(card).getByRole("button", { name: "Check risks" }));
    expect(await within(card).findByText("Assign the payment bug today.")).toBeInTheDocument();
    expect(within(card).getByText("AI suggestion")).toBeInTheDocument();
    expect(within(card).getByText("1 high-priority task with no owner")).toBeInTheDocument();
    const table = within(card).getByRole("table", { name: "Workload, next 7 days" });
    expect(within(table).getByText("Sam Lee").closest("tr")).toHaveTextContent("Sam Lee4312 (+1 unestimated)1");

    await user.click(within(card).getByRole("button", { name: "Suggest priorities" }));
    const dlg = await screen.findByRole("dialog", { name: "Suggested priorities" });
    expect(within(dlg).getByText("Overdue by 3 days")).toBeInTheDocument();
    await user.click(within(dlg).getByLabelText("Apply to GEN-2"));
    await user.click(within(dlg).getByRole("button", { name: "Apply 2 changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Suggested priorities" })).not.toBeInTheDocument());
    const bulk = apiMock.post.mock.calls.filter(([u]) => u === "/tasks/bulk").map(([, b]) => b);
    expect(bulk).toEqual([
      { ids: [1], action: "update", data: { priority: "HIGH" } },
      { ids: [3], action: "update", data: { priority: "MEDIUM" } },
    ]);
  });

  it("read-only users get risks and the report but no priority changes; clients get none of it", async () => {
    api([["/projects/p1", makeProject({ capabilities: { projectId: "p1", manage: false, createTasks: false, editTasks: "none", deleteTasks: "none", projectRole: null } })]]);
    const { unmount } = renderAt("/projects/p1/overview", "VIEWER");
    const card = await screen.findByRole("region", { name: "Project assistant" });
    expect(within(card).getByRole("button", { name: "Check risks" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Suggest priorities" })).not.toBeInTheDocument();
    unmount();
    renderAt("/projects/p1/overview", "CLIENT");
    await screen.findByText("Total tasks");
    expect(screen.queryByRole("region", { name: "Project assistant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assistant" })).not.toBeInTheDocument();
  });
});

describe("Assistant", () => {
  it("answers with links to tasks and sends the conversation so far", async () => {
    api([["/tasks/7", makeDetail({ id: 7, key: "GEN-7", title: "Payments down" })]]);
    let n = 0;
    post({
      "/ai/assistant": () =>
        ++n === 1
          ? { source: "rules", fallbackReason: "not_configured", answer: "Overdue (1):\n• GEN-7 Payments down", references: [{ id: 7, key: "GEN-7", title: "Payments down" }] }
          : { source: "rules", fallbackReason: "not_configured", answer: "Nothing is blocked.", references: [] },
    });
    renderAt("/my-tasks");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Assistant" }));
    const panel = await screen.findByRole("dialog", { name: "Assistant" });
    expect(await within(panel).findByText("Offline mode: built-in answers")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "What's overdue?" }));
    expect(await within(panel).findByText(/Overdue \(1\):/)).toBeInTheDocument();
    expect(within(panel).getByText("Rule-based")).toBeInTheDocument();

    await user.type(within(panel).getByLabelText("Ask the assistant"), "anything blocked?{Enter}");
    expect(await within(panel).findByText("Nothing is blocked.")).toBeInTheDocument();
    const second = apiMock.post.mock.calls.filter(([u]) => u === "/ai/assistant")[1][1];
    expect(second).toMatchObject({ message: "anything blocked?", history: [{ role: "user", content: "What's overdue?" }, { role: "assistant", content: "Overdue (1):\n• GEN-7 Payments down" }] });

    // A reference opens the task
    await user.click(within(panel).getByRole("button", { name: "GEN-7" }));
    expect(await screen.findByRole("dialog", { name: "Task details" })).toBeInTheDocument();
  });

  it("shows errors in the conversation instead of failing silently", async () => {
    api();
    apiMock.post.mockRejectedValue({ response: { status: 429, data: { message: "Too many AI requests. Try again in a few minutes." } } });
    renderAt("/my-tasks");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Assistant" }));
    const panel = await screen.findByRole("dialog", { name: "Assistant" });
    await user.type(within(panel).getByLabelText("Ask the assistant"), "hi{Enter}");
    expect(await within(panel).findByText("Too many AI requests. Try again in a few minutes.")).toBeInTheDocument();
  });
});

describe("AI setting", () => {
  const renderOrg = (role: OrgRole, status: unknown) => {
    restoreAs(makeSession(role));
    apiMock.get.mockImplementation(
      routes([
        ["/ai/status", status],
        ["/orgs/current/members", members],
        ["/orgs/current/invitations", []],
        [/^\/orgs\/current\/audit-logs/, { items: [], nextCursor: null }],
      ])
    );
    return render(
      <MemoryRouter>
        <TestProviders>
          <OrganizationSettings />
        </TestProviders>
      </MemoryRouter>
    );
  };

  it("explains that nothing is sent when AI isn't set up, and offers no switch", async () => {
    renderOrg("ORG_ADMIN", rulesStatus);
    expect(await screen.findByText(/AI isn't set up on this server/)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Use AI for this organization" })).not.toBeInTheDocument();
  });

  it("lets an admin turn AI off; others only read the setting", async () => {
    const on = { configured: true, model: "llama3.2", orgEnabled: true, mode: "ai", reason: null };
    apiMock.patch.mockResolvedValue({ data: { ...on, orgEnabled: false, mode: "rules", reason: "disabled_by_org" } });
    const { unmount } = renderOrg("ORG_ADMIN", on);
    const user = userEvent.setup();
    expect(await screen.findByText(/Using llama3\.2/)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Use AI for this organization" }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/ai/settings", { enabled: false }));
    expect(await screen.findByText(/Turned off\. AI features use built-in rules/)).toBeInTheDocument();
    unmount();
    renderOrg("MEMBER", on);
    expect(await screen.findByText(/Using llama3\.2/)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Use AI for this organization" })).not.toBeInTheDocument();
  });
});
