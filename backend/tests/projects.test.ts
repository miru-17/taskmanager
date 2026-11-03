import request from "supertest";
import { addMember, app, isoDate, prisma, resetDb, signUp, type TestUser } from "./helpers";

beforeEach(resetDb);

const createProject = async (user: TestUser, body: Record<string, unknown>) => request(app).post("/projects").set(user.auth).send(body);
const generalOf = (user: TestUser) => prisma.project.findFirstOrThrow({ where: { organizationId: user.orgId!, key: "GEN" } });

describe("Projects", () => {
  it("every new organization starts with a General project", async () => {
    const admin = await signUp();
    const res = await request(app).get("/projects").set(admin.auth).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ key: "GEN", name: "General", health: "on_track", stats: { total: 0, progress: 0 } });

    const second = await request(app).post("/orgs").set(admin.auth).send({ name: "Second" }).expect(201);
    expect(await prisma.project.count({ where: { organizationId: second.body.organization.id } })).toBe(1);
  });

  it("creates projects with generated or explicit keys and rejects duplicates", async () => {
    const admin = await signUp();
    const a = await createProject(admin, { name: "Website Redesign" });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ key: "WR", capabilities: { manage: true } });
    expect((await createProject(admin, { name: "Other", key: "wr" })).status).toBe(409);
    expect((await createProject(admin, { name: "Bad", key: "1AB" })).status).toBe(400);
    expect((await createProject(admin, { name: "Dates", startDate: isoDate(5), dueDate: isoDate(1) })).status).toBe(400);
  });

  it("only roles with projects:create can create projects", async () => {
    const admin = await signUp();
    const pm = await addMember(admin, "PROJECT_MANAGER");
    const member = await addMember(admin, "MEMBER");
    expect((await createProject(pm, { name: "PM project" })).status).toBe(201);
    expect((await createProject(member, { name: "Nope" })).status).toBe(403);
  });

  it("private projects (and their tasks) are invisible to non-members", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const priv = (await createProject(admin, { name: "Secret", key: "SEC", visibility: "PRIVATE" })).body;
    const task = (await request(app).post("/tasks").set(admin.auth).send({ title: "hidden", projectId: priv.id }).expect(201)).body;

    expect((await request(app).get("/projects").set(member.auth)).body.map((p: { key: string }) => p.key)).toEqual(["GEN"]);
    expect((await request(app).get(`/projects/${priv.id}`).set(member.auth)).status).toBe(404);
    expect((await request(app).get(`/tasks/${task.id}`).set(member.auth)).status).toBe(404);
    expect((await request(app).get("/tasks").set(member.auth)).body.total).toBe(0);
    // Can't create tasks in a project they can't see
    expect((await request(app).post("/tasks").set(member.auth).send({ title: "x", projectId: priv.id })).status).toBe(404);

    await request(app).post(`/projects/${priv.id}/members`).set(admin.auth).send({ userId: member.userId, role: "MEMBER" }).expect(201);
    expect((await request(app).get(`/tasks/${task.id}`).set(member.auth)).status).toBe(200);
  });

  it("team membership grants access to a team's private project", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const team = (await request(app).post("/teams").set(admin.auth).send({ name: "Platform" }).expect(201)).body;
    const priv = (await createProject(admin, { name: "Infra", visibility: "PRIVATE", teamId: team.id })).body;
    expect((await request(app).get(`/projects/${priv.id}`).set(member.auth)).status).toBe(404);

    await request(app).post(`/teams/${team.id}/members`).set(admin.auth).send({ userId: member.userId }).expect(201);
    expect((await request(app).get(`/projects/${priv.id}`).set(member.auth)).status).toBe(200);
  });

  it("project roles adjust task rights: MANAGER edits anything, VIEWER is read-only", async () => {
    const admin = await signUp();
    const lead = await addMember(admin, "MEMBER");
    const watcher = await addMember(admin, "MEMBER");
    const proj = (await createProject(admin, { name: "Mobile", key: "MOB" })).body;
    await request(app).post(`/projects/${proj.id}/members`).set(admin.auth).send({ userId: lead.userId, role: "MANAGER" }).expect(201);
    await request(app).post(`/projects/${proj.id}/members`).set(admin.auth).send({ userId: watcher.userId, role: "VIEWER" }).expect(201);

    const adminsTask = (await request(app).post("/tasks").set(admin.auth).send({ title: "a", projectId: proj.id })).body;
    const general = (await request(app).post("/tasks").set(admin.auth).send({ title: "g" })).body;

    // Project manager: any task in MOB, but still only own tasks elsewhere
    expect((await request(app).patch(`/tasks/${adminsTask.id}`).set(lead.auth).send({ title: "edited" })).status).toBe(200);
    expect((await request(app).patch(`/tasks/${general.id}`).set(lead.auth).send({ title: "edited" })).status).toBe(403);
    expect((await request(app).post(`/projects/${proj.id}/milestones`).set(lead.auth).send({ name: "Beta" })).status).toBe(201);

    // Project viewer: sees it, can't create or edit even their own org-level rights
    expect((await request(app).get(`/tasks/${adminsTask.id}`).set(watcher.auth)).body.permissions).toEqual({ edit: false, delete: false, createSubtasks: false });
    expect((await request(app).post("/tasks").set(watcher.auth).send({ title: "x", projectId: proj.id })).status).toBe(403);
  });

  it("clients see only projects they were added to, read-only", async () => {
    const admin = await signUp();
    const client = await addMember(admin, "CLIENT");
    const proj = (await createProject(admin, { name: "Client Portal", key: "CP" })).body;
    const t = (await request(app).post("/tasks").set(admin.auth).send({ title: "deliverable", projectId: proj.id })).body;
    await request(app).post("/tasks").set(admin.auth).send({ title: "internal" }).expect(201);

    expect((await request(app).post(`/projects/${proj.id}/members`).set(admin.auth).send({ userId: client.userId, role: "MANAGER" })).status).toBe(400);
    await request(app).post(`/projects/${proj.id}/members`).set(admin.auth).send({ userId: client.userId, role: "VIEWER" }).expect(201);

    const list = await request(app).get("/tasks").set(client.auth).expect(200);
    expect(list.body.items.map((i: { title: string }) => i.title)).toEqual(["deliverable"]);
    expect((await request(app).patch(`/tasks/${t.id}`).set(client.auth).send({ title: "x" })).status).toBe(403);
    expect((await request(app).get("/teams").set(client.auth)).status).toBe(403);
  });

  it("archived projects reject new tasks; deletion needs archive + org admin", async () => {
    const admin = await signUp();
    const pm = await addMember(admin, "PROJECT_MANAGER");
    const proj = (await createProject(admin, { name: "Old" })).body;
    expect((await request(app).delete(`/projects/${proj.id}`).set(admin.auth)).status).toBe(400);
    await request(app).patch(`/projects/${proj.id}`).set(admin.auth).send({ status: "ARCHIVED" }).expect(200);
    expect((await request(app).post("/tasks").set(admin.auth).send({ title: "x", projectId: proj.id })).status).toBe(400);
    expect((await request(app).delete(`/projects/${proj.id}`).set(pm.auth)).status).toBe(403);
    expect((await request(app).delete(`/projects/${proj.id}`).set(admin.auth)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "project.deleted" } })).toBe(1);
  });

  it("health and progress come from real task data", async () => {
    const admin = await signUp();
    const gen = await generalOf(admin);
    const t1 = (await request(app).post("/tasks").set(admin.auth).send({ title: "one" })).body;
    await request(app).post("/tasks").set(admin.auth).send({ title: "two" }).expect(201);
    await request(app).patch(`/tasks/${t1.id}`).set(admin.auth).send({ status: "DONE" }).expect(200);

    let p = (await request(app).get(`/projects/${gen.id}`).set(admin.auth)).body;
    expect(p.stats).toMatchObject({ total: 2, done: 1, open: 1, overdue: 0, progress: 0.5 });
    expect(p.health).toBe("on_track");

    // An overdue open task (inserted directly; the API refuses past due dates)
    await prisma.task.create({ data: { title: "late", number: 50, projectId: gen.id, organizationId: admin.orgId!, dueDate: new Date(`${isoDate(-3)}T00:00:00Z`) } });
    p = (await request(app).get(`/projects/${gen.id}`).set(admin.auth)).body;
    expect(p.stats.overdue).toBe(1);
    expect(p.health).toBe("off_track"); // 1 of 2 open tasks overdue ≥ 25%
  });

  it("milestones track their own progress and must belong to the task's project", async () => {
    const admin = await signUp();
    const gen = await generalOf(admin);
    const other = (await createProject(admin, { name: "Other", key: "OTH" })).body;
    const ms = (await request(app).post(`/projects/${gen.id}/milestones`).set(admin.auth).send({ name: "v1", dueDate: isoDate(10) }).expect(201)).body;

    await request(app).post("/tasks").set(admin.auth).send({ title: "in ms", milestoneId: ms.id }).expect(201);
    expect((await request(app).post("/tasks").set(admin.auth).send({ title: "wrong", projectId: other.id, milestoneId: ms.id })).status).toBe(400);

    const list = (await request(app).get(`/projects/${gen.id}/milestones`).set(admin.auth)).body;
    expect(list[0]).toMatchObject({ name: "v1", stats: { total: 1, done: 0 } });
  });

  it("projects of another organization are unreachable", async () => {
    const acme = await signUp();
    const globex = await signUp();
    const gen = await generalOf(acme);
    expect((await request(app).get(`/projects/${gen.id}`).set(globex.auth)).status).toBe(404);
    expect((await request(app).post("/tasks").set(globex.auth).send({ title: "x", projectId: gen.id })).status).toBe(404);
    expect((await request(app).patch(`/projects/${gen.id}`).set(globex.auth).send({ name: "pwned" })).status).toBe(404);
  });
});

describe("Teams", () => {
  it("managers create teams; leads manage members but can't appoint leads; clients can't join", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const other = await addMember(admin, "MEMBER");
    const client = await addMember(admin, "CLIENT");

    expect((await request(app).post("/teams").set(member.auth).send({ name: "Nope" })).status).toBe(403);
    const team = (await request(app).post("/teams").set(admin.auth).send({ name: "Design" }).expect(201)).body;
    expect((await request(app).post("/teams").set(admin.auth).send({ name: "Design" })).status).toBe(409);

    await request(app).post(`/teams/${team.id}/members`).set(admin.auth).send({ userId: member.userId, role: "LEAD" }).expect(201);
    expect((await request(app).post(`/teams/${team.id}/members`).set(member.auth).send({ userId: other.userId })).status).toBe(201);
    expect((await request(app).post(`/teams/${team.id}/members`).set(member.auth).send({ userId: other.userId, role: "LEAD" })).status).toBe(403);
    expect((await request(app).post(`/teams/${team.id}/members`).set(admin.auth).send({ userId: client.userId })).status).toBe(400);

    const list = (await request(app).get("/teams").set(member.auth)).body;
    expect(list[0]).toMatchObject({ name: "Design", memberCount: 2, myRole: "LEAD" });
  });
});
