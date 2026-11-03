/**
 * Test double for ../services/api. Use in a test file with:
 *   vi.mock("../services/api", async () => (await import("./mockApi")).apiModule);
 */
import { vi } from "vitest";
import type { AuthPayload, OrgRole, Permission } from "../types/auth";

type Listener = (p: AuthPayload | null) => void;
const listeners = new Set<Listener>();
let token: string | null = null;

export const apiMock = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

export const tokenStore = {
  get: () => token,
  set: (p: AuthPayload | null) => {
    token = p?.accessToken ?? null;
    listeners.forEach((l) => l(p));
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export const refreshSession = vi.fn<() => Promise<AuthPayload | null>>();

export const apiModule = {
  default: apiMock,
  tokenStore,
  refreshSession,
  CSRF_HEADERS: { "X-TaskForge-CSRF": "1" },
  API_URL: "http://api.test",
  isSessionExpiry: () => false,
};

const WORKER: Permission[] = ["tasks:read", "tasks:create", "tasks:update_any", "tasks:delete_any", "labels:manage", "templates:manage"];
const ROLE_PERMS: Record<OrgRole, Permission[]> = {
  ORG_ADMIN: ["org:read", "org:update", "members:read", "members:invite", "members:manage", "invitations:manage", "audit:read", "projects:create", "projects:manage_any", "teams:manage", ...WORKER],
  PROJECT_MANAGER: ["org:read", "members:read", "members:invite", "invitations:manage", "projects:create", "projects:manage_any", "teams:manage", ...WORKER],
  TEAM_LEAD: ["org:read", "members:read", ...WORKER],
  MEMBER: ["org:read", "members:read", "tasks:read", "tasks:create", "tasks:update_own", "tasks:delete_own"],
  CLIENT: ["org:read", "tasks:read"],
  VIEWER: ["org:read", "members:read", "tasks:read"],
};

export const makeSession = (role: OrgRole = "ORG_ADMIN", overrides: Partial<AuthPayload> = {}): AuthPayload => {
  const org = { id: "org1", name: "Acme", slug: "acme-abc123", role };
  return {
    accessToken: "access-token",
    expiresIn: 900,
    user: { id: 1, email: "me@example.com", name: null, emailVerified: true, isSuperAdmin: false },
    organization: org,
    organizations: [org],
    permissions: ROLE_PERMS[role],
    ...overrides,
  };
};

/** Makes the next silent session restore succeed with `session` (or fail with null). */
export const restoreAs = (session: AuthPayload | null) => {
  refreshSession.mockImplementation(async () => {
    tokenStore.set(session);
    return session;
  });
};

export const resetApiMock = () => {
  Object.values(apiMock).forEach((fn) => fn.mockReset());
  refreshSession.mockReset();
  token = null;
};
