import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { TestProviders } from "./providers";
import { apiMock, makeSession, resetApiMock, restoreAs } from "./mockApi";
import { makeProject, makeTask, page, routes } from "./fixtures";
import { describeRule, describeRun } from "../features/automations/wording";
import { draftProblems } from "../features/automations/RuleBuilder";
import { actorLabel } from "../features/tasks/activityText";
import type { AutomationRule } from "../types/Task";
import type { OrgRole } from "../types/auth";

vi.mock("../services/api", async () => (await import("./mockApi")).apiModule);

const names = { person: (id: number) => (id === 2 ? "Sam Lee" : "a removed person"), label: (id: string) => (id === "l1" ? "“urgent”" : "a deleted label") };

const rule = (o: Partial<AutomationRule> = {}): AutomationRule => ({
  id: "r1",
  projectId: "p1",
  name: "Escalate",
  enabled: true,
  trigger: "STATUS_CHANGED",
  triggerConfig: { to: "DONE" },
  conditions: [{ field: "priority", op: "is", value: ["HIGH", "CRITICAL"] }],
  actions: [
    { type: "NOTIFY", to: "watchers", message: "Shipped" },
    { type: "ADD_LABEL", labelId: "l1" },
  ],
  createdBy: { id: 1, name: "Me", email: "me@example.com" },
  runCount: 3,
  lastRunAt: new Date(Date.now() - 3600_000).toISOString(),
  failureStreak: 0,
  disabledReason: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...o,
});

const project = makeProject();
const api = (list: { canManage: boolean; rules: AutomationRule[] }, extra: [string | RegExp, unknown][] = []) =>
  apiMock.get.mockImplementation(
    routes([
      ...extra,
      ["/projects/p1/automations", list],
      ["/projects", [project]],
      ["/projects/p1", project],
      [/^\/projects\/p1\//, []],
      ["/tasks", page([makeTask({ id: 7, title: "Fix login" })])],
      ["/labels", [{ id: "l1", name: "urgent", color: "#f00" }]],
      ["/orgs/current/members", [{ userId: 2, email: "sam@x.test", name: "Sam Lee", role: "MEMBER" }]],
      ["/approvals/count", { pending: 0 }],
      ["/notifications/count", { unread: 0 }],
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

beforeEach(() => resetApiMock());

describe("Rule wording", () => {
  it("reads a rule as one sentence, naming people and labels, and flags deleted references", () => {
    expect(describeRule(rule(), names)).toBe("When the status changes to Done, if priority is High or Critical: notify watchers and add the label “urgent”.");
    expect(describeRule(rule({ trigger: "DUE_SOON", triggerConfig: { days: 2 }, conditions: [], actions: [{ type: "ASSIGN", to: 99 }] }), names)).toBe("2 days before the due date: assign it to a removed person.");
  });

  it("explains each run outcome", () => {
    expect(describeRun("SUCCEEDED", { actions: ["Set status to DONE"] }, names)).toBe("Set status to DONE");
    expect(describeRun("FAILED", { error: "This task is blocked" }, names)).toBe("This task is blocked");
    expect(describeRun("LOOP_BLOCKED", { reason: "loop" }, names)).toMatch(/loop/);
    expect(describeRun("LOOP_BLOCKED", { reason: "rate_limit", runsLastMinute: 61 }, names)).toMatch(/61 times in a minute/);
    expect(describeRun("SKIPPED", { reason: "conditions", condition: { field: "label", op: "has", value: "l1" } }, names)).toBe("Skipped: not true that it has the label “urgent”");
  });

  it("validates a draft the way the server does", () => {
    const base = { name: "x", trigger: "TASK_CREATED" as const, triggerConfig: {}, conditions: [], actions: [{ type: "SET_PRIORITY" as const, priority: "HIGH" as const }] };
    expect(draftProblems(base)).toEqual([]);
    expect(draftProblems({ ...base, name: " " })).toContain("Give the rule a name");
    expect(draftProblems({ ...base, actions: [] })).toContain("Add at least one action");
    expect(draftProblems({ ...base, trigger: "DUE_SOON", triggerConfig: { days: 31 } })).toContain("Days before the due date must be 0–30");
    expect(draftProblems({ ...base, actions: [{ type: "ADD_COMMENT", body: "  " }] })).toContain("Write the comment text");
    expect(draftProblems({ ...base, actions: [base.actions[0], { type: "SET_PRIORITY", priority: "LOW" }] })).toContain("“Set priority” can be used only once");
  });

  it("names the automation in history instead of 'Someone'", () => {
    const n = (u: { name: string | null; email: string }) => u.name ?? u.email;
    expect(actorLabel({ actor: null, type: "updated", changes: { _automation: "Escalate" } }, n)).toBe("Automation");
    expect(actorLabel({ actor: null, type: "updated", changes: {} }, n)).toBe("Someone");
    expect(actorLabel({ actor: { name: "Sam", email: "s@x" }, type: "updated" }, n)).toBe("Sam");
  });
});

describe("Automations tab", () => {
  it("starts a manager from a recipe and saves exactly what the builder shows", async () => {
    api({ canManage: true, rules: [] });
    apiMock.post.mockResolvedValue({ data: rule() });
    renderAt("/projects/p1/automations");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Ask for review/ }));
    const dialog = await screen.findByRole("dialog", { name: "New automation" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Tell the creator about reviews");
    expect(within(dialog).getByLabelText("Trigger")).toHaveValue("STATUS_CHANGED");
    expect(within(dialog).getByLabelText("To status")).toHaveValue("IN_REVIEW");
    expect(within(dialog).getByText(/When the status changes to In review: notify the creator\./)).toBeInTheDocument();

    // Add a condition and change the message before saving
    await user.selectOptions(within(dialog).getByLabelText("Add a condition"), "priority");
    await user.clear(within(dialog).getByLabelText("Message"));
    await user.type(within(dialog).getByLabelText("Message"), "Please review");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    expect(apiMock.post).toHaveBeenCalledWith("/projects/p1/automations", {
      name: "Tell the creator about reviews",
      trigger: "STATUS_CHANGED",
      triggerConfig: { to: "IN_REVIEW" },
      conditions: [{ field: "priority", op: "is", value: ["HIGH"] }],
      actions: [{ type: "NOTIFY", to: "creator", message: "Please review" }],
    });
  });

  it("won't save an incomplete rule, and says why", async () => {
    api({ canManage: true, rules: [] });
    renderAt("/projects/p1/automations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New automation" }));
    const dialog = await screen.findByRole("dialog", { name: "New automation" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Give the rule a name");
    await user.type(within(dialog).getByLabelText("Name"), "Thing");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Add at least one action");
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it("lists rules in words, toggles them, and shows why the system switched one off", async () => {
    api({ canManage: true, rules: [rule(), rule({ id: "r2", name: "Broken", enabled: false, disabledReason: "it failed 5 times in a row (last error: blocked)" })] });
    apiMock.patch.mockResolvedValue({ data: {} });
    renderAt("/projects/p1/automations");
    const user = userEvent.setup();

    expect(await screen.findAllByText("When the status changes to Done, if priority is High or Critical: notify watchers and add the label “urgent”.")).toHaveLength(2);
    expect(screen.getAllByText(/Ran 3 times/)).toHaveLength(2);
    expect(screen.getByText(/Switched off automatically because it failed 5 times in a row/)).toBeInTheDocument();

    const sw = screen.getByRole("switch", { name: "Turn off Escalate" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    await user.click(sw);
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/automations/r1", { enabled: false }));
  });

  it("shows the run log with outcomes and filters it", async () => {
    const runs = {
      counts: { SUCCEEDED: 1, FAILED: 1 },
      runs: [
        { id: "x1", status: "FAILED", depth: 0, detail: { error: "This task is blocked by unfinished tasks" }, createdAt: new Date().toISOString(), task: { id: 7, key: "GEN-7", title: "Fix login" } },
        { id: "x2", status: "SUCCEEDED", depth: 1, detail: { actions: ["Notify watchers"] }, createdAt: new Date().toISOString(), task: null },
      ],
    };
    api({ canManage: true, rules: [rule()] }, [["/automations/r1/runs", (cfg?: { params?: Record<string, string> }) => (cfg?.params?.status === "FAILED" ? { ...runs, runs: [runs.runs[0]] } : runs)]]);
    renderAt("/projects/p1/automations");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Show run log" }));
    const log = await screen.findByRole("list", { name: "Runs of Escalate" });
    expect(within(log).getByText("This task is blocked by unfinished tasks")).toBeInTheDocument();
    expect(within(log).getByText("Deleted task")).toBeInTheDocument();
    expect(within(log).getByText("chained")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Failed 1/ }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Runs of Escalate" })).queryByText("Deleted task")).not.toBeInTheDocument());
    expect(apiMock.get).toHaveBeenCalledWith("/automations/r1/runs", { params: { limit: 50, status: "FAILED" } });
  });

  it("dry-runs a rule against a task", async () => {
    api({ canManage: true, rules: [rule()] });
    apiMock.post.mockResolvedValue({
      data: { wouldRun: false, enabled: true, triggerNote: "When the status changes to DONE", conditions: [{ condition: { field: "priority", op: "is", value: ["HIGH", "CRITICAL"] }, holds: false }], actions: ["Notify watchers"], problems: [] },
    });
    renderAt("/projects/p1/automations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Test on a task" }));
    const dialog = await screen.findByRole("dialog", { name: "Test “Escalate”" });
    await user.selectOptions(await within(dialog).findByLabelText("Task to test against"), "7");
    await user.click(within(dialog).getByRole("button", { name: "Test" }));
    expect(await within(dialog).findByText("It would not run on this task")).toBeInTheDocument();
    expect(within(dialog).getByText("priority is High or Critical")).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith("/automations/r1/test", { taskId: 7 });
  });

  it("members can read rules but get no controls; clients don't get the tab", async () => {
    api({ canManage: false, rules: [rule()] });
    const { unmount } = renderAt("/projects/p1/automations", "MEMBER");
    expect(await screen.findByText("Escalate")).toBeInTheDocument();
    expect(screen.getByText(/Only project managers can change them/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New automation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Escalate/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show run log" })).toBeInTheDocument();
    unmount();

    renderAt("/projects/p1/board", "CLIENT");
    await screen.findByRole("navigation", { name: "Project views" });
    expect(screen.queryByRole("link", { name: /Automations/ })).not.toBeInTheDocument();
  });
});
