import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { ThemeProvider } from "../context/ThemeContext";
import { TestProviders } from "./providers";
import { apiMock, makeSession, resetApiMock, restoreAs } from "./mockApi";
import { makeProject, page, routes } from "./fixtures";
import { niceTicks, formatNumber } from "../features/analytics/scale";
import { presetRange } from "../features/analytics/range";
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

const range = { from: "2026-10-05", to: "2026-11-03", tz: "UTC", days: 30 };
const summary = {
  range,
  open: 42,
  overdue: 5,
  created: 30,
  completed: 24,
  cycleTime: { averageDays: 4.6, medianDays: 3.2, sample: 24 },
  onTime: { rate: 0.75, onTime: 15, withDueDate: 20 },
  hours: { estimated: 80, actual: 96, sample: 12 },
  byStatus: [
    { key: "TODO", count: 20 },
    { key: "IN_PROGRESS", count: 15 },
    { key: "IN_REVIEW", count: 7 },
    { key: "DONE", count: 60 },
  ],
  byPriority: [
    { key: "CRITICAL", count: 2 },
    { key: "HIGH", count: 10 },
    { key: "MEDIUM", count: 25 },
    { key: "LOW", count: 5 },
  ],
};
const trend = {
  range,
  bucket: "day",
  points: [
    { start: "2026-11-01", created: 3, completed: 1, scope: 100, done: 58, remaining: 42 },
    { start: "2026-11-02", created: 0, completed: 2, scope: 100, done: 60, remaining: 40 },
    { start: "2026-11-03", created: 4, completed: 0, scope: 104, done: 60, remaining: 44 },
  ],
};
const workload = { range, people: [{ user: { id: 2, name: "Sam Lee", email: "sam@x.test" }, open: 9, overdue: 2, dueSoon: 3, openHours: 21.5, unestimated: 4, completed: 6 }, { user: null, open: 3, overdue: 0, dueSoon: 0, openHours: 0, unestimated: 3, completed: 0 }] };
const projects = { range, projects: [{ id: "p1", key: "GEN", name: "General", color: "#6366f1", status: "ACTIVE", stats: { total: 102, done: 60, open: 42, overdue: 5, progress: 0.588 }, completedInRange: 24, health: "at_risk" }] };

const api = () =>
  apiMock.get.mockImplementation(
    routes([
      ["/analytics/summary", summary],
      ["/analytics/trend", trend],
      ["/analytics/workload", workload],
      ["/analytics/projects", projects],
      ["/projects", [makeProject()]],
      ["/orgs/current/members", [{ userId: 2, email: "sam@x.test", name: "Sam Lee", role: "MEMBER" }]],
      ["/tasks", page([])],
      ["/notifications/count", { unread: 0 }],
      ["/approvals/count", { pending: 0 }],
    ])
  );

beforeEach(() => resetApiMock());

describe("Analytics dashboard", () => {
  it("shows the server's numbers as they are", async () => {
    api();
    renderAt("/analytics");
    const tiles = await screen.findByRole("group", { name: "Key numbers" });
    const tile = async (label: string) => within(tiles).getByText(label).parentElement!;
    expect(await tile("Completed")).toHaveTextContent("24");
    expect(await tile("Open now")).toHaveTextContent("42");
    expect(await tile("Overdue now")).toHaveTextContent("5");
    expect(await tile("Median cycle time")).toHaveTextContent("3.2 d");
    expect(await tile("On time")).toHaveTextContent("75%");
    expect(await tile("On time")).toHaveTextContent("15 of 20 with a due date");
    expect(await tile("Actual vs estimate")).toHaveTextContent("120%");

    const workloadTable = screen.getByRole("region", { name: "Workload" });
    expect(within(workloadTable).getByText("Sam Lee").closest("tr")).toHaveTextContent(/9.*2.*3.*21\.5 h.*\+4 unestimated.*6/);
    expect(within(workloadTable).getByText("Unassigned")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Projects" })).getByText("59%")).toBeInTheDocument();
  });

  it("every chart has a table view with the exact values", async () => {
    api();
    renderAt("/analytics");
    const burnup = await screen.findByRole("region", { name: "Burn-up" });
    expect(within(burnup).getByText(/44 open at the end of the range/)).toBeInTheDocument();
    await userEvent.click(within(burnup).getByRole("button", { name: "Show table" }));
    const rows = within(burnup).getAllByRole("row");
    expect(rows[3]).toHaveTextContent(/Nov 3, 2026.*104.*60.*44/);

    const status = screen.getByRole("region", { name: "Tasks by status" });
    expect(within(status).getByLabelText("In review: 7")).toBeInTheDocument();
  });

  it("sends filters to every request and keeps them in the URL", async () => {
    api();
    renderAt("/analytics");
    await screen.findByText("Open now");
    await userEvent.selectOptions(screen.getByLabelText("Project"), "p1");
    await userEvent.selectOptions(screen.getByLabelText("Assignee"), "2");
    await userEvent.selectOptions(screen.getByLabelText("Date range"), "90d");
    await waitFor(() => {
      const last = apiMock.get.mock.calls.filter(([u]) => u === "/analytics/summary").pop()![1].params;
      expect(last).toMatchObject({ projectId: "p1", assigneeId: "2", from: presetRange("90d", last.tz).from, to: presetRange("90d", last.tz).to });
      expect(last.tz).toBeTruthy();
    });
    for (const kind of ["trend", "workload", "projects"]) {
      expect(apiMock.get.mock.calls.filter(([u]) => u === `/analytics/${kind}`).pop()![1].params).toMatchObject({ projectId: "p1", assigneeId: "2" });
    }
  });

  it("downloads a CSV and warns when the export was cut short", async () => {
    api();
    const blob = new Blob(["a,b"], { type: "text/csv" });
    const base = apiMock.get.getMockImplementation()!;
    apiMock.get.mockImplementation((url: string, cfg?: { params?: Record<string, string> }) =>
      url === "/analytics/export.csv" ? Promise.resolve({ data: blob, headers: { "content-disposition": 'attachment; filename="taskforge-tasks-2026-11-03.csv"', "x-export-truncated": "10000" } }) : base(url, cfg)
    );
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    renderAt("/analytics");
    await userEvent.click(await screen.findByRole("button", { name: "Tasks CSV" }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/analytics/export.csv", expect.objectContaining({ responseType: "blob", params: expect.objectContaining({ dataset: "tasks" }) })));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(await screen.findByText(/Exported the first 10000 rows/)).toBeInTheDocument();
  });

  it("isn't offered to clients", async () => {
    api();
    renderAt("/my-tasks", "CLIENT");
    await screen.findByRole("heading", { name: "My tasks" });
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
  });
});

describe("Chart helpers", () => {
  it("picks clean ticks and formats numbers", () => {
    expect(niceTicks(17)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(formatNumber(9999)).toBe(new Intl.NumberFormat().format(9999));
    expect(formatNumber(12_500)).toMatch(/12\.5K|12,5 k|12.5k/i);
  });

  it("presets end today in the viewer's zone", () => {
    const r = presetRange("7d", "UTC");
    expect(r.to).toBe(new Date().toISOString().slice(0, 10));
    expect((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000).toBe(6);
  });
});
