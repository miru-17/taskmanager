export type OrgRole =
  | "ORG_ADMIN"
  | "PROJECT_MANAGER"
  | "TEAM_LEAD"
  | "MEMBER"
  | "CLIENT"
  | "VIEWER";

export type Permission =
  | "org:read"
  | "org:update"
  | "members:read"
  | "members:invite"
  | "members:manage"
  | "invitations:manage"
  | "audit:read"
  | "tasks:read"
  | "tasks:create"
  | "tasks:update_any"
  | "tasks:update_own"
  | "tasks:delete_any"
  | "tasks:delete_own"
  | "projects:create"
  | "projects:manage_any"
  | "teams:manage"
  | "labels:manage";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  emailVerified: boolean;
  isSuperAdmin: boolean;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

/** Shape returned by /auth/login, /auth/refresh, /auth/me, /auth/switch-organization … */
export interface AuthPayload {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
  organization: OrgSummary | null;
  organizations: OrgSummary[];
  permissions: Permission[];
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  ORG_ADMIN: "Organization Admin",
  PROJECT_MANAGER: "Project Manager",
  TEAM_LEAD: "Team Lead",
  MEMBER: "Team Member",
  CLIENT: "Client",
  VIEWER: "Viewer",
};

export const ROLE_ORDER: OrgRole[] = [
  "ORG_ADMIN",
  "PROJECT_MANAGER",
  "TEAM_LEAD",
  "MEMBER",
  "CLIENT",
  "VIEWER",
];

const RANK: Record<OrgRole, number> = {
  ORG_ADMIN: 100,
  PROJECT_MANAGER: 80,
  TEAM_LEAD: 60,
  MEMBER: 40,
  CLIENT: 20,
  VIEWER: 10,
};

/** Mirrors the server rule (the server is still the one that enforces it). */
export const assignableRoles = (actor: OrgRole): OrgRole[] =>
  actor === "ORG_ADMIN" ? ROLE_ORDER : ROLE_ORDER.filter((r) => RANK[r] < RANK[actor]);
