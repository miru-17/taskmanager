import request from "supertest";
import jwt from "jsonwebtoken";
import { addMember, app, createTask, isoDate, prisma, resetDb, signUp } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("Tenant isolation", () => {
  it("a user never sees another organization's tasks", async () => {
    const acme = await signUp({ organizationName: "Acme" });
    const globex = await signUp({ organizationName: "Globex" });
    const secret = await createTask(acme, "Acme secret roadmap");

    expect((await request(app).get("/tasks").set(globex.auth)).body.items).toEqual([]);
    expect((await request(app).get(`/tasks/${secret.id}`).set(globex.auth)).status).toBe(404);
    expect((await request(app).patch(`/tasks/${secret.id}`).set(globex.auth).send({ title: "pwned" })).status).toBe(404);
    expect((await request(app).delete(`/tasks/${secret.id}`).set(globex.auth)).status).toBe(404);

    expect(await prisma.task.findUnique({ where: { id: secret.id } })).toMatchObject({ title: "Acme secret roadmap" });
  });

  it("ignores organizationId / createdById supplied in the request body", async () => {
    const acme = await signUp();
    const globex = await signUp();
    const res = await request(app)
      .post("/tasks")
      .set(globex.auth)
      .send({ title: "smuggled", organizationId: acme.orgId, createdById: acme.userId });
    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(globex.orgId);
    expect(res.body.createdById).toBe(globex.userId);
    expect((await request(app).get("/tasks").set(acme.auth)).body.items).toEqual([]);
  });

  it("refuses to switch into an organization the user doesn't belong to", async () => {
    const acme = await signUp();
    const globex = await signUp();
    const res = await request(app).post("/auth/switch-organization").set(globex.auth).send({ organizationId: acme.orgId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_A_MEMBER");
  });

  it("rejects an access token whose org claim was tampered with", async () => {
    const acme = await signUp();
    const globex = await signUp();
    const [header, payload, signature] = globex.token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const forged = [header, Buffer.from(JSON.stringify({ ...claims, org: acme.orgId })).toString("base64url"), signature].join(".");
    expect((await request(app).get("/tasks").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
  });

  it("even a correctly signed token for a foreign org is refused without membership", async () => {
    const acme = await signUp();
    const globex = await signUp();
    const session = await prisma.session.findFirstOrThrow({ where: { userId: globex.userId } });
    // Simulates a server bug or leaked secret issuing a token with the wrong org
    const token = jwt.sign({ sid: session.id, org: acme.orgId }, process.env.JWT_SECRET!, {
      subject: String(globex.userId),
      issuer: "taskforge",
      audience: "taskforge-api",
    });
    const res = await request(app).get("/tasks").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_A_MEMBER");
  });

  it("a removed member loses access immediately, with their token still unexpired", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    await createTask(admin);
    expect((await request(app).get("/tasks").set(member.auth)).status).toBe(200);

    await request(app).delete(`/orgs/current/members/${member.userId}`).set(admin.auth).expect(200);

    const res = await request(app).get("/tasks").set(member.auth);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_A_MEMBER");
  });

  it("a demoted user loses permissions immediately (role is not cached in the token)", async () => {
    const admin = await signUp();
    const lead = await addMember(admin, "TEAM_LEAD");
    const task = await createTask(admin);
    await request(app).patch(`/tasks/${task.id}`).set(lead.auth).send({ status: "DONE" }).expect(200);

    await request(app).patch(`/orgs/current/members/${lead.userId}`).set(admin.auth).send({ role: "VIEWER" }).expect(200);
    expect((await request(app).patch(`/tasks/${task.id}`).set(lead.auth).send({ status: "TODO" })).status).toBe(403);
  });
});

describe("Multiple organizations per user", () => {
  it("switches between organizations and sees each one's tasks", async () => {
    const u = await signUp({ organizationName: "First" });
    await createTask(u, "in first");

    const created = await request(app).post("/orgs").set(u.auth).send({ name: "Second" });
    expect(created.status).toBe(201);
    expect(created.body.organization).toMatchObject({ name: "Second", role: "ORG_ADMIN" });
    expect(created.body.organizations).toHaveLength(2);

    const second = { Authorization: `Bearer ${created.body.accessToken}` };
    expect((await request(app).get("/tasks").set(second)).body.items).toEqual([]);
    await request(app).post("/tasks").set(second).send({ title: "in second" }).expect(201);

    const back = await request(app).post("/auth/switch-organization").set(second).send({ organizationId: u.orgId });
    const first = { Authorization: `Bearer ${back.body.accessToken}` };
    expect((await request(app).get("/tasks").set(first)).body.items.map((t: { title: string }) => t.title)).toEqual(["in first"]);
  });

  it("remembers the active organization across refreshes", async () => {
    const u = await signUp({ organizationName: "First" });
    const created = await request(app).post("/orgs").set(u.auth).send({ name: "Second" });
    const refreshed = await u.agent.post("/auth/refresh").set({ "X-TaskForge-CSRF": "1" });
    expect(refreshed.body.organization.id).toBe(created.body.organization.id);
  });

  it("leaving moves the user to their remaining organization; the last admin can't leave", async () => {
    const admin = await signUp({ organizationName: "Shared" });
    const member = await addMember(admin, "MEMBER");
    const own = await request(app).post("/orgs").set(member.auth).send({ name: "Mine" });
    const backToShared = await request(app)
      .post("/auth/switch-organization")
      .set({ Authorization: `Bearer ${own.body.accessToken}` })
      .send({ organizationId: admin.orgId });

    const left = await request(app)
      .post("/orgs/current/leave")
      .set({ Authorization: `Bearer ${backToShared.body.accessToken}` });
    expect(left.status).toBe(200);
    expect(left.body.organization.name).toBe("Mine");

    const res = await request(app).post("/orgs/current/leave").set(admin.auth);
    expect(res.status).toBe(400);
  });

  it("a user with no organizations gets a clear 403 on tenant routes", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    await request(app).delete(`/orgs/current/members/${member.userId}`).set(admin.auth);
    const refreshed = await member.agent.post("/auth/refresh").set({ "X-TaskForge-CSRF": "1" });
    expect(refreshed.body.organization).toBeNull();

    const res = await request(app).get("/tasks").set({ Authorization: `Bearer ${refreshed.body.accessToken}` });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NO_ORGANIZATION");
  });
});

describe("Task rules carried over from Phase 0", () => {
  it("validates input and keeps overdue tasks editable", async () => {
    const u = await signUp();
    expect((await request(app).post("/tasks").set(u.auth).send({ title: "  " })).status).toBe(400);
    expect((await request(app).post("/tasks").set(u.auth).send({ title: "x", dueDate: isoDate(-5) })).status).toBe(400);
    expect((await request(app).get("/tasks/abc").set(u.auth)).status).toBe(400);

    const project = await prisma.project.findFirstOrThrow({ where: { organizationId: u.orgId! } });
    const task = await prisma.task.create({
      data: { title: "late", number: 99, projectId: project.id, organizationId: u.orgId!, createdById: u.userId, dueDate: new Date(`${isoDate(-10)}T00:00:00Z`) },
    });
    const res = await request(app).put(`/tasks/${task.id}`).set(u.auth).send({ status: "DONE", dueDate: isoDate(-10) });
    expect(res.status).toBe(200);
  });
});
