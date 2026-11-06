import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { TestProviders } from "./providers";
import { apiMock, makeSession, resetApiMock, restoreAs } from "./mockApi";
import { makeProject, page, routes } from "./fixtures";
import type { OrgRole } from "../types/auth";

vi.mock("../services/api", async () => (await import("./mockApi")).apiModule);

const limits = (o: Record<string, unknown> = {}) => ({ members: 5, clients: 2, projects: 3, storageMb: 500, automations: 3, aiRequestsPerMonth: 50, branding: false, ...o });
const summary = (o: Record<string, unknown> = {}) => ({
  plan: "FREE",
  paidPlan: "FREE",
  limits: limits(),
  usage: { members: 4, clients: 0, pendingMembers: 1, pendingClients: 0, projects: 3, storageBytes: 10 * 1024 * 1024, automations: 1, aiThisMonth: 12 },
  trial: { active: false, endsAt: null, available: true, days: 14, plan: "PRO" },
  subscription: null,
  billing: { configured: true, testMode: true, purchasable: ["PRO", "BUSINESS"] },
  plans: {
    FREE: { name: "Free", priceNote: "Free", limits: limits() },
    PRO: { name: "Pro", priceNote: "Billed monthly through Stripe", limits: limits({ members: 25, clients: 25, projects: 50, storageMb: 10240, automations: 50, aiRequestsPerMonth: 2000, branding: true }) },
    BUSINESS: { name: "Business", priceNote: "Billed monthly through Stripe", limits: limits({ members: null, clients: null, projects: null, storageMb: 102400, automations: null, aiRequestsPerMonth: 20000, branding: true }) },
  },
  ...o,
});
const project = makeProject({ name: "Website redesign", stats: { total: 10, done: 4, open: 6, overdue: 1, progress: 40 } });
const api = (extra: [string | RegExp, unknown][] = []) =>
  apiMock.get.mockImplementation(
    routes([
      ...extra,
      ["/billing", summary()],
      ["/orgs/current/branding", { name: "Acme", brandColor: null, hasLogo: false, version: 1 }],
      ["/projects", [project]],
      ["/approvals", []],
      ["/approvals/count", { pending: 0 }],
      ["/notifications/count", { unread: 0 }],
      ["/ai/status", { configured: false, model: null, orgEnabled: true, mode: "rules", reason: "not_configured" }],
      ["/orgs/current/members", []],
      ["/orgs/current/invitations", []],
      [/^\/orgs\/current\/audit-logs/, { items: [], nextCursor: null }],
      ["/tasks", page([])],
      ["/views", []],
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

const assign = vi.fn();
beforeEach(() => {
  resetApiMock();
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});
afterEach(() => {
  document.documentElement.removeAttribute("data-brand");
  document.documentElement.style.removeProperty("--brand");
});

describe("Plan and billing", () => {
  it("shows usage against the plan, starts the trial, and sends admins to Stripe Checkout", async () => {
    api();
    apiMock.post.mockImplementation(async (url: string) => {
      if (url === "/billing/trial") return { data: summary({ plan: "PRO", trial: { active: true, endsAt: "2026-11-20T00:00:00.000Z", available: false, days: 14, plan: "PRO" }, limits: summary().plans.PRO.limits }) };
      if (url === "/billing/checkout") return { data: { url: "https://checkout.stripe.com/c/pay/cs_test_1" } };
      throw new Error(url);
    });
    renderAt("/settings/billing");
    const user = userEvent.setup();
    const usage = await screen.findByRole("list", { name: "Usage against your plan" });
    expect(within(usage).getByText("Team members").closest("li")).toHaveTextContent("5 of 5Includes 1 pending invitation");
    expect(within(usage).getByRole("progressbar", { name: "Active projects" })).toHaveAttribute("aria-valuenow", "3");
    expect(within(usage).getByText("AI requests this month").closest("li")).toHaveTextContent("12 of 50");
    expect(screen.getByText(/Stripe test mode: use card 4242/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start the free 14-day Pro trial" }));
    expect(await screen.findByText("Current plan: Pro (trial)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Choose Business" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1"));
    expect(apiMock.post).toHaveBeenCalledWith("/billing/checkout", { plan: "BUSINESS" });
  });

  it("subscribers get the billing portal and a payment warning; non-admins only read", async () => {
    api([["/billing", summary({ plan: "PRO", paidPlan: "PRO", subscription: { status: "past_due", currentPeriodEnd: "2026-12-01T00:00:00.000Z", cancelAtPeriodEnd: false }, trial: { active: false, endsAt: null, available: false, days: 14, plan: "PRO" } })]]);
    apiMock.post.mockResolvedValue({ data: { url: "https://billing.stripe.com/p/session/test_1" } });
    const { unmount } = renderAt("/settings/billing");
    const user = userEvent.setup();
    expect(await screen.findByText(/Stripe couldn't take the last payment/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Choose/ })).not.toBeInTheDocument(); // already subscribed: change it in the portal
    await user.click(screen.getByRole("button", { name: "Manage billing" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/p/session/test_1"));
    unmount();

    api();
    renderAt("/settings/billing", "PROJECT_MANAGER");
    expect(await screen.findByText("Only organization admins can change the plan.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /trial|Choose/ })).not.toBeInTheDocument();
  });

  it("says so when online payment isn't set up", async () => {
    api([["/billing", summary({ billing: { configured: false, testMode: true, purchasable: [] } })]]);
    renderAt("/settings/billing");
    expect(await screen.findByText(/Online payment isn't set up on this server/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Choose/ })).not.toBeInTheDocument();
  });
});

describe("Branding", () => {
  it("explains a plan limit with a link to plans, and applies a saved colour app-wide", async () => {
    api();
    apiMock.patch.mockRejectedValueOnce({ response: { status: 402, data: { code: "PLAN_LIMIT", message: "Custom branding isn't included in the Free plan. Upgrade to use it." } } });
    renderAt("/settings/organization");
    const user = userEvent.setup();
    const hex = await screen.findByLabelText("Brand colour hex");
    await user.clear(hex);
    await user.type(hex, "#1d4ed8");
    await user.click(screen.getByRole("button", { name: "Save colour" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Custom branding isn't included in the Free plan.");
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/settings/billing");

    apiMock.patch.mockResolvedValueOnce({ data: { name: "Acme", brandColor: "#1d4ed8", hasLogo: false, version: 2 } });
    await user.click(screen.getByRole("button", { name: "Save colour" }));
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--brand")).toBe("#1d4ed8"));
    expect(document.documentElement.hasAttribute("data-brand")).toBe(true);
  });
});

describe("Client portal", () => {
  it("clients land on their portal with their projects and what awaits their approval", async () => {
    api([
      ["/approvals", [{ id: "a1", status: "PENDING", task: { id: 9, key: "WEB-9", number: 9, title: "Approve homepage copy", status: "IN_REVIEW", dueDate: null, project: { id: "p1", key: "WEB", name: "Website redesign", color: "#000" } } }]],
      ["/orgs/current/branding", { name: "Acme Studio", brandColor: null, hasLogo: false, version: 1 }],
    ]);
    renderAt("/", "CLIENT");
    expect(await screen.findByRole("heading", { name: "Acme Studio" })).toBeInTheDocument();
    const waiting = screen.getByRole("region", { name: "Waiting for your approval" });
    expect(within(waiting).getByText("Approve homepage copy")).toBeInTheDocument();
    const projects = screen.getByRole("region", { name: "Your projects" });
    expect(within(projects).getByRole("link", { name: /Website redesign/ })).toHaveAttribute("href", "/projects/p1/overview");
    expect(within(projects).getByText("4 of 10 tasks done · 1 overdue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan and billing" })).not.toBeInTheDocument();
  });

  it("everyone else still lands on My tasks", async () => {
    api();
    renderAt("/", "MEMBER");
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
  });
});
