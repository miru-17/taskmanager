import request from "supertest";
import type { OrgRole } from "@prisma/client";
import { addMember, app, createTask, prisma, resetDb, signUp, type TestUser } from "./helpers";

beforeAll(resetDb);
afterAll(() => prisma.$disconnect());

/** One organisation with one user per role, shared by the matrix tests below. */
let admin: TestUser;
const users = {} as Record<OrgRole, TestUser>;

beforeAll(async () => {
  admin = await signUp({ organizationName: "RBAC Inc" });
  users.ORG_ADMIN = admin;
  for (const role of ["PROJECT_MANAGER", "TEAM_LEAD", "MEMBER", "CLIENT", "VIEWER"] as const) {
    users[role] = await addMember(admin, role);
  }
});

const status = async (user: TestUser, method: "get" | "post" | "patch" | "delete", path: string, body?: object) =>
  (await request(app)[method](path).set(user.auth).send(body)).status;

describe("Task permission matrix", () => {
  //                       read  create  update-others  delete-others
  const expected: Record<OrgRole, [number, number, number, number]> = {
    ORG_ADMIN:       [200, 201, 200, 200],
    PROJECT_MANAGER: [200, 201, 200, 200],
    TEAM_LEAD:       [200, 201, 200, 200],
    MEMBER:          [200, 201, 403, 403],
    // Clients may read, but only projects they were explicitly added to (none here)
    CLIENT:          [200, 403, 403, 403],
    VIEWER:          [200, 403, 403, 403],
  };

  it.each(Object.keys(expected) as OrgRole[])("%s", async (role) => {
    const user = users[role];
    const others = await createTask(admin, `owned by admin for ${role}`);
    const [read, create, update, del] = expected[role];

    expect(await status(user, "get", "/tasks")).toBe(read);
    expect(await status(user, "post", "/tasks", { title: `by ${role}` })).toBe(create);
    expect(await status(user, "patch", `/tasks/${others.id}`, { status: "DONE" })).toBe(update);
    expect(await status(user, "delete", `/tasks/${others.id}`)).toBe(del);
  });

  it("a CLIENT sees no tasks until added to a project", async () => {
    await createTask(admin, "internal");
    const res = await request(app).get("/tasks").set(users.CLIENT.auth);
    expect(res.body).toMatchObject({ items: [], total: 0 });
    expect((await request(app).get("/projects").set(users.CLIENT.auth)).body).toEqual([]);
  });

  it("a MEMBER can edit and delete their own tasks", async () => {
    const own = await createTask(users.MEMBER, "mine");
    expect(await status(users.MEMBER, "patch", `/tasks/${own.id}`, { status: "DONE" })).toBe(200);
    expect(await status(users.MEMBER, "delete", `/tasks/${own.id}`)).toBe(200);
  });
});

describe("Organization administration", () => {
  it("only admins can rename the organization", async () => {
    for (const role of ["PROJECT_MANAGER", "TEAM_LEAD", "MEMBER", "CLIENT", "VIEWER"] as const) {
      expect(await status(users[role], "patch", "/orgs/current", { name: "Hijacked" })).toBe(403);
    }
    expect(await status(admin, "patch", "/orgs/current", { name: "RBAC Incorporated" })).toBe(200);
  });

  it("clients can't list members; everyone else can", async () => {
    expect(await status(users.CLIENT, "get", "/orgs/current/members")).toBe(403);
    expect(await status(users.VIEWER, "get", "/orgs/current/members")).toBe(200);
    const members = (await request(app).get("/orgs/current/members").set(admin.auth)).body;
    expect(members).toHaveLength(6);
    expect(JSON.stringify(members)).not.toMatch(/password/i);
  });

  it("only admins can change roles or remove members", async () => {
    const target = users.VIEWER.userId;
    for (const role of ["PROJECT_MANAGER", "TEAM_LEAD", "MEMBER", "VIEWER"] as const) {
      expect(await status(users[role], "patch", `/orgs/current/members/${target}`, { role: "MEMBER" })).toBe(403);
      expect(await status(users[role], "delete", `/orgs/current/members/${target}`)).toBe(403);
    }
  });
});

describe("Privilege escalation", () => {
  it("a member can't make themselves admin", async () => {
    expect(
      await status(users.MEMBER, "patch", `/orgs/current/members/${users.MEMBER.userId}`, { role: "ORG_ADMIN" })
    ).toBe(403);
  });

  it("a project manager can invite only roles below their own", async () => {
    const pm = users.PROJECT_MANAGER;
    // This org already has one person per role (6 > Free's 5 seats); seat limits are tested in plans.test.ts
    await prisma.organization.update({ where: { id: pm.orgId! }, data: { plan: "BUSINESS" } });
    expect(await status(pm, "post", "/orgs/current/invitations", { email: "x1@example.com", role: "ORG_ADMIN" })).toBe(403);
    expect(await status(pm, "post", "/orgs/current/invitations", { email: "x2@example.com", role: "PROJECT_MANAGER" })).toBe(403);
    expect(await status(pm, "post", "/orgs/current/invitations", { email: "x3@example.com", role: "TEAM_LEAD" })).toBe(201);
  });

  it("team leads, members, clients and viewers can't invite anyone", async () => {
    for (const role of ["TEAM_LEAD", "MEMBER", "CLIENT", "VIEWER"] as const) {
      expect(await status(users[role], "post", "/orgs/current/invitations", { email: `y-${role}@example.com`, role: "VIEWER" })).toBe(403);
    }
  });

  it("rejects unknown role values", async () => {
    expect(await status(admin, "post", "/orgs/current/invitations", { email: "z@example.com", role: "SUPER_ADMIN" })).toBe(400);
  });

  it("the last admin can't be demoted", async () => {
    const res = await request(app)
      .patch(`/orgs/current/members/${admin.userId}`)
      .set(admin.auth)
      .send({ role: "MEMBER" });
    expect(res.status).toBe(400);
  });
});

describe("Audit log", () => {
  it("records security events and is readable only by admins", async () => {
    for (const role of ["PROJECT_MANAGER", "TEAM_LEAD", "MEMBER", "CLIENT", "VIEWER"] as const) {
      expect(await status(users[role], "get", "/orgs/current/audit-logs")).toBe(403);
    }
    const res = await request(app).get("/orgs/current/audit-logs?limit=100").set(admin.auth);
    expect(res.status).toBe(200);
    const actions = res.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(["org.created", "invitation.created", "member.joined", "org.updated"]));
  });

  it("paginates with a cursor", async () => {
    const page1 = (await request(app).get("/orgs/current/audit-logs?limit=2").set(admin.auth)).body;
    expect(page1.items).toHaveLength(2);
    const page2 = (await request(app).get(`/orgs/current/audit-logs?limit=2&cursor=${page1.nextCursor}`).set(admin.auth)).body;
    expect(page2.items[0].id).not.toBe(page1.items[1].id);
  });
});

describe("Super Admin", () => {
  it("is required for platform endpoints", async () => {
    expect(await status(admin, "get", "/admin/organizations")).toBe(403);
    expect(await status(admin, "get", "/admin/users")).toBe(403);
  });

  it("sees tenant metadata but gets no access to tenant data", async () => {
    const operator = await signUp({ organizationName: "Platform Ops" });
    await prisma.user.update({ where: { id: operator.userId }, data: { isSuperAdmin: true } });

    const orgs = (await request(app).get("/admin/organizations").set(operator.auth)).body;
    expect(orgs.find((o: { name: string }) => o.name === "RBAC Incorporated")).toMatchObject({ memberCount: 6 });
    expect(await status(operator, "get", "/admin/users")).toBe(200);

    const rbacOrg = orgs.find((o: { name: string }) => o.name === "RBAC Incorporated");
    const switched = await request(app).post("/auth/switch-organization").set(operator.auth).send({ organizationId: rbacOrg.id });
    expect(switched.status).toBe(403);
  });
});
