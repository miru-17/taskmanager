import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OrganizationSettings from "../pages/OrganizationSettings";
import AcceptInvite from "../pages/AcceptInvite";
import { TestProviders } from "./providers";
import { assignableRoles } from "../types/auth";
import { apiMock, makeSession, resetApiMock, restoreAs } from "./mockApi";

vi.mock("../services/api", async () => (await import("./mockApi")).apiModule);
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const members = [
  { userId: 1, email: "me@example.com", name: null, role: "ORG_ADMIN", joinedAt: "2026-01-01" },
  { userId: 2, email: "bob@example.com", name: "Bob", role: "MEMBER", joinedAt: "2026-01-02" },
];

const stubOrgEndpoints = () =>
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === "/orgs/current/members") return { data: members };
    if (url === "/orgs/current/invitations") return { data: [] };
    if (url.startsWith("/orgs/current/audit-logs")) return { data: { items: [], nextCursor: null } };
    throw new Error(`unexpected GET ${url}`);
  });

const renderOrg = () =>
  render(
    <MemoryRouter>
      <TestProviders>
        <OrganizationSettings />
      </TestProviders>
    </MemoryRouter>
  );

beforeEach(resetApiMock);

describe("assignableRoles", () => {
  it("lets admins grant anything and others only roles below their own", () => {
    expect(assignableRoles("ORG_ADMIN")).toContain("ORG_ADMIN");
    expect(assignableRoles("PROJECT_MANAGER")).toEqual(["TEAM_LEAD", "MEMBER", "CLIENT", "VIEWER"]);
    expect(assignableRoles("VIEWER")).toEqual([]);
  });
});

describe("Organization settings", () => {
  it("lets an admin change a member's role", async () => {
    restoreAs(makeSession("ORG_ADMIN"));
    stubOrgEndpoints();
    apiMock.patch.mockResolvedValue({ data: {} });
    renderOrg();

    await userEvent.selectOptions(await screen.findByLabelText("Role for bob@example.com"), "TEAM_LEAD");
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/orgs/current/members/2", { role: "TEAM_LEAD" }));
  });

  it("offers a project manager only roles below their own when inviting", async () => {
    restoreAs(makeSession("PROJECT_MANAGER"));
    stubOrgEndpoints();
    renderOrg();
    const select = await screen.findByLabelText("Role for the invitee");
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(["TEAM_LEAD", "MEMBER", "CLIENT", "VIEWER"]);
    expect(screen.queryByLabelText("Role for bob@example.com")).not.toBeInTheDocument();
  });

  it("sends an invitation", async () => {
    restoreAs(makeSession("ORG_ADMIN"));
    stubOrgEndpoints();
    apiMock.post.mockResolvedValue({ data: {} });
    renderOrg();
    await userEvent.type(await screen.findByLabelText("Email to invite"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith("/orgs/current/invitations", { email: "new@example.com", role: "MEMBER" })
    );
  });

  it("hides admin controls from a member", async () => {
    restoreAs(makeSession("MEMBER"));
    stubOrgEndpoints();
    renderOrg();
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email to invite")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByText("Audit log")).not.toBeInTheDocument();
  });

  it("asks unverified users to verify before inviting", async () => {
    const s = makeSession("ORG_ADMIN");
    restoreAs({ ...s, user: { ...s.user, emailVerified: false } });
    stubOrgEndpoints();
    renderOrg();
    expect(await screen.findByText(/Verify your email address/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Email to invite")).not.toBeInTheDocument();
  });
});

describe("Accept invitation page", () => {
  const preview = (accountExists: boolean) => ({
    organizationName: "Globex",
    email: "me@example.com",
    role: "TEAM_LEAD",
    invitedBy: "Hank",
    expiresAt: "2026-12-01T00:00:00Z",
    accountExists,
  });

  const renderInvite = () =>
    render(
      <MemoryRouter initialEntries={[`/invite/${"a".repeat(64)}`]}>
        <TestProviders>
          <Routes>
            <Route path="/invite/:token" element={<AcceptInvite />} />
            <Route path="/" element={<p>home page</p>} />
          </Routes>
        </TestProviders>
      </MemoryRouter>
    );

  it("sends a new person to sign up with the invitation attached", async () => {
    restoreAs(null);
    apiMock.get.mockResolvedValue({ data: preview(false) });
    renderInvite();
    const link = await screen.findByRole("link", { name: /Create account and join/ });
    expect(link.getAttribute("href")).toContain(`invite=${"a".repeat(64)}`);
    expect(link.getAttribute("href")).toContain("email=me%40example.com");
  });

  it("lets the right signed-in user accept and lands them on the board", async () => {
    restoreAs(makeSession("ORG_ADMIN"));
    apiMock.get.mockResolvedValue({ data: preview(true) });
    apiMock.post.mockResolvedValue({ data: makeSession("TEAM_LEAD") });
    renderInvite();
    await userEvent.click(await screen.findByRole("button", { name: "Join Globex" }));
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("warns when signed in with a different account", async () => {
    const s = makeSession("ORG_ADMIN");
    restoreAs({ ...s, user: { ...s.user, email: "someone-else@example.com" } });
    apiMock.get.mockResolvedValue({ data: preview(true) });
    renderInvite();
    expect(await screen.findByText(/This invitation is for me@example.com/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join Globex" })).not.toBeInTheDocument();
  });

  it("explains an invalid invitation", async () => {
    restoreAs(null);
    apiMock.get.mockRejectedValue({ response: { data: { message: "This invitation is invalid or has expired" } } });
    renderInvite();
    expect(await screen.findByText("This invitation is invalid or has expired")).toBeInTheDocument();
  });
});
