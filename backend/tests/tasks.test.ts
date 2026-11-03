import request from "supertest";
import { addMember, app, isoDate, prisma, resetDb, signUp, type TestUser } from "./helpers";

beforeEach(resetDb);

const post = (u: TestUser, body: Record<string, unknown>) => request(app).post("/tasks").set(u.auth).send(body);
const make = async (u: TestUser, body: Record<string, unknown>) => {
  const res = await post(u, body);
  if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; key: string; number: number; status: string };
};
const list = async (u: TestUser, query = "") => (await request(app).get(`/tasks${query}`).set(u.auth).expect(200)).body;

describe("Task model", () => {
  it("numbers tasks per project, even under concurrency", async () => {
    const admin = await signUp();
    const first = await make(admin, { title: "first" });
    expect(first.key).toBe("GEN-1");
    await Promise.all(Array.from({ length: 8 }, (_, i) => make(admin, { title: `t${i}` })));
    const numbers = (await list(admin, "?sort=number")).items.map((t: { number: number }) => t.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const other = (await request(app).post("/projects").set(admin.auth).send({ name: "Payments", key: "PAY" })).body;
    expect((await make(admin, { title: "p", projectId: other.id })).key).toBe("PAY-1");
  });

  it("stores the full task model and validates references", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const outsider = await signUp();
    const label = (await request(app).post("/labels").set(admin.auth).send({ name: "bug", color: "#ef4444" }).expect(201)).body;
    const foreignLabel = (await request(app).post("/labels").set(outsider.auth).send({ name: "x" })).body;

    const t = await make(admin, {
      title: "Full",
      priority: "HIGH",
      startDate: isoDate(1),
      dueDate: isoDate(3),
      estimateHours: 5,
      assigneeId: member.userId,
      labelIds: [label.id],
    });
    expect(t).toMatchObject({ priority: "HIGH", estimateHours: 5, assignee: { id: member.userId }, labels: [{ name: "bug" }] });

    expect((await post(admin, { title: "x", assigneeId: outsider.userId })).status).toBe(403);
    expect((await post(admin, { title: "x", labelIds: [foreignLabel.id] })).status).toBe(400);
    expect((await post(admin, { title: "x", startDate: isoDate(5), dueDate: isoDate(2) })).status).toBe(400);
    expect((await post(admin, { title: "x", priority: "URGENT" })).status).toBe(400);
    expect((await post(admin, { title: "x", estimateHours: -1 })).status).toBe(400);
  });

  it("refuses to assign someone who can't see the project", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const priv = (await request(app).post("/projects").set(admin.auth).send({ name: "Secret", visibility: "PRIVATE" })).body;
    const res = await post(admin, { title: "x", projectId: priv.id, assigneeId: member.userId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/access to this project/);
  });

  it("an assignee can move their task forward; others can't", async () => {
    const admin = await signUp();
    const a = await addMember(admin, "MEMBER");
    const b = await addMember(admin, "MEMBER");
    const t = await make(admin, { title: "assigned", assigneeId: a.userId });
    expect((await request(app).patch(`/tasks/${t.id}`).set(a.auth).send({ status: "IN_PROGRESS" })).status).toBe(200);
    expect((await request(app).patch(`/tasks/${t.id}`).set(b.auth).send({ status: "DONE" })).status).toBe(403);
    // ...but deleting stays with the creator
    expect((await request(app).delete(`/tasks/${t.id}`).set(a.auth)).status).toBe(403);
  });
});

describe("Listing", () => {
  it("filters, searches, sorts and paginates", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const label = (await request(app).post("/labels").set(admin.auth).send({ name: "ui" })).body;
    await make(admin, { title: "Alpha login bug", priority: "CRITICAL", labelIds: [label.id] });
    const b = await make(admin, { title: "Beta", priority: "LOW", assigneeId: member.userId, dueDate: isoDate(2) });
    await make(admin, { title: "Gamma", status: "IN_REVIEW", dueDate: isoDate(1) });

    expect((await list(admin, "?q=login")).items.map((t: { title: string }) => t.title)).toEqual(["Alpha login bug"]);
    expect((await list(admin, "?q=GEN-2")).items[0].id).toBe(b.id);
    expect((await list(admin, "?status=TODO,IN_REVIEW")).total).toBe(3);
    expect((await list(admin, "?status=IN_REVIEW")).total).toBe(1);
    expect((await list(admin, "?priority=CRITICAL,HIGH")).total).toBe(1);
    expect((await list(member, "?assigneeId=me")).items[0].id).toBe(b.id);
    expect((await list(admin, "?assigneeId=none")).total).toBe(2);
    expect((await list(admin, `?labelId=${label.id}`)).total).toBe(1);
    expect((await list(admin, "?sort=dueDate")).items.map((t: { title: string }) => t.title)).toEqual(["Gamma", "Beta", "Alpha login bug"]);
    expect((await list(admin, "?sort=priority")).items[0].title).toBe("Alpha login bug");

    const page = await list(admin, "?limit=2&offset=2&sort=number");
    expect(page).toMatchObject({ total: 3, limit: 2, offset: 2 });
    expect(page.items).toHaveLength(1);

    expect((await request(app).get("/tasks?status=NOPE").set(admin.auth)).status).toBe(400);
    expect((await request(app).get("/tasks?sort=password").set(admin.auth)).status).toBe(400);
    expect((await request(app).get("/tasks?limit=5000").set(admin.auth)).status).toBe(400);
  });

  it("finds overdue tasks", async () => {
    const admin = await signUp();
    const gen = await prisma.project.findFirstOrThrow({ where: { organizationId: admin.orgId! } });
    await make(admin, { title: "future", dueDate: isoDate(3) });
    await prisma.task.create({ data: { title: "late", number: 77, projectId: gen.id, organizationId: admin.orgId!, dueDate: new Date(`${isoDate(-2)}T00:00:00Z`) } });
    expect((await list(admin, "?overdue=true")).items.map((t: { title: string }) => t.title)).toEqual(["late"]);
  });
});

describe("Subtasks", () => {
  it("nests within one project, limits depth and prevents cycles", async () => {
    const admin = await signUp();
    const root = await make(admin, { title: "root" });
    const child = await make(admin, { title: "child", parentId: root.id });
    const grandchild = await make(admin, { title: "grandchild", parentId: child.id });
    expect((await post(admin, { title: "too deep", parentId: grandchild.id })).status).toBe(400);

    // Cycle: root under its own grandchild
    expect((await request(app).patch(`/tasks/${root.id}`).set(admin.auth).send({ parentId: grandchild.id })).status).toBe(400);
    expect((await request(app).patch(`/tasks/${root.id}`).set(admin.auth).send({ parentId: root.id })).status).toBe(400);

    const other = (await request(app).post("/projects").set(admin.auth).send({ name: "Other", key: "OT" })).body;
    expect((await post(admin, { title: "cross", projectId: other.id, parentId: root.id })).status).toBe(400);

    const detail = (await request(app).get(`/tasks/${root.id}`).set(admin.auth)).body;
    expect(detail.subtasks.map((s: { title: string }) => s.title)).toEqual(["child"]);
    expect(detail.subtaskCount).toBe(1);
    expect((await list(admin, "?parentId=none")).total).toBe(1);
  });

  it("deleting a task soft-deletes its subtasks too, and audits it", async () => {
    const admin = await signUp();
    const root = await make(admin, { title: "root" });
    await make(admin, { title: "child", parentId: root.id });
    await request(app).delete(`/tasks/${root.id}`).set(admin.auth).expect(200);

    expect((await list(admin)).total).toBe(0);
    expect((await request(app).get(`/tasks/${root.id}`).set(admin.auth)).status).toBe(404);
    expect(await prisma.task.count({ where: { deletedAt: { not: null } } })).toBe(2);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "task.deleted" } });
    expect(log.metadata).toMatchObject({ key: "GEN-1", withSubtasks: 1 });
  });
});

describe("Dependencies", () => {
  it("blocks completion until blockers are done, and rejects cycles", async () => {
    const admin = await signUp();
    const a = await make(admin, { title: "design" });
    const b = await make(admin, { title: "build" });
    const c = await make(admin, { title: "ship" });

    await request(app).post(`/tasks/${b.id}/dependencies`).set(admin.auth).send({ dependsOnId: a.id }).expect(201);
    await request(app).post(`/tasks/${c.id}/dependencies`).set(admin.auth).send({ dependsOnId: b.id }).expect(201);
    expect((await request(app).post(`/tasks/${a.id}/dependencies`).set(admin.auth).send({ dependsOnId: c.id })).status).toBe(400);
    expect((await request(app).post(`/tasks/${a.id}/dependencies`).set(admin.auth).send({ dependsOnId: a.id })).status).toBe(400);

    const blocked = await request(app).patch(`/tasks/${b.id}`).set(admin.auth).send({ status: "DONE" });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: "TASK_BLOCKED", details: { blockedBy: ["GEN-1"] } });
    expect((await request(app).get(`/tasks/${b.id}`).set(admin.auth)).body).toMatchObject({ isBlocked: true, dependencies: [{ key: "GEN-1" }], blocking: [{ key: "GEN-3" }] });

    await request(app).patch(`/tasks/${a.id}`).set(admin.auth).send({ status: "DONE" }).expect(200);
    const done = await request(app).patch(`/tasks/${b.id}`).set(admin.auth).send({ status: "DONE" });
    expect(done.status).toBe(200);
    expect(done.body.completedAt).toBeTruthy();

    // Reopening clears completedAt
    expect((await request(app).patch(`/tasks/${b.id}`).set(admin.auth).send({ status: "TODO" })).body.completedAt).toBeNull();
    await request(app).delete(`/tasks/${c.id}/dependencies/${b.id}`).set(admin.auth).expect(200);
    expect((await request(app).get(`/tasks/${c.id}`).set(admin.auth)).body.isBlocked).toBe(false);
  });

  it("can't depend on a task the caller can't see", async () => {
    const acme = await signUp();
    const globex = await signUp();
    const mine = await make(acme, { title: "mine" });
    const theirs = await make(globex, { title: "theirs" });
    expect((await request(app).post(`/tasks/${mine.id}/dependencies`).set(acme.auth).send({ dependsOnId: theirs.id })).status).toBe(404);
  });
});

describe("History, checklist and watchers", () => {
  it("records field-level history", async () => {
    const admin = await signUp();
    const t = await make(admin, { title: "old" });
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ title: "new", priority: "HIGH" }).expect(200);
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ title: "new" }).expect(200); // no-op → no entry

    const activity = (await request(app).get(`/tasks/${t.id}/activity`).set(admin.auth)).body;
    expect(activity.map((a: { type: string }) => a.type)).toEqual(["updated", "created"]);
    expect(activity[0].changes).toEqual({ title: { from: "old", to: "new" }, priority: { from: "MEDIUM", to: "HIGH" } });
    expect(activity[0].actor.id).toBe(admin.userId);
  });

  it("manages checklist items with edit rights only", async () => {
    const admin = await signUp();
    const viewer = await addMember(admin, "VIEWER");
    const t = await make(admin, { title: "list" });
    const item = (await request(app).post(`/tasks/${t.id}/checklist`).set(admin.auth).send({ text: "step 1" }).expect(201)).body;
    await request(app).post(`/tasks/${t.id}/checklist`).set(admin.auth).send({ text: "step 2" }).expect(201);
    await request(app).patch(`/tasks/${t.id}/checklist/${item.id}`).set(admin.auth).send({ done: true }).expect(200);
    expect((await request(app).get(`/tasks/${t.id}`).set(admin.auth)).body).toMatchObject({ checklistTotal: 2, checklistDone: 1 });
    expect((await request(app).post(`/tasks/${t.id}/checklist`).set(viewer.auth).send({ text: "x" })).status).toBe(403);

    const other = await make(admin, { title: "other" });
    expect((await request(app).delete(`/tasks/${other.id}/checklist/${item.id}`).set(admin.auth)).status).toBe(404);
  });

  it("creator and assignee watch automatically; anyone who can see it may follow", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const viewer = await addMember(admin, "VIEWER");
    const t = await make(admin, { title: "w", assigneeId: member.userId });
    expect((await request(app).get(`/tasks/${t.id}`).set(member.auth)).body.isWatching).toBe(true);
    await request(app).post(`/tasks/${t.id}/watch`).set(viewer.auth).expect(200);
    expect((await list(viewer, "?watching=true")).total).toBe(1);
    await request(app).delete(`/tasks/${t.id}/watch`).set(viewer.auth).expect(200);
    expect((await list(viewer, "?watching=true")).total).toBe(0);
  });
});

describe("Archive and bulk actions", () => {
  it("archived tasks leave default lists and must be restored before editing", async () => {
    const admin = await signUp();
    const t = await make(admin, { title: "arch" });
    await request(app).post(`/tasks/${t.id}/archive`).set(admin.auth).expect(200);
    expect((await list(admin)).total).toBe(0);
    expect((await list(admin, "?archived=only")).total).toBe(1);
    expect((await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ title: "x" })).status).toBe(400);
    await request(app).post(`/tasks/${t.id}/unarchive`).set(admin.auth).expect(200);
    expect((await list(admin)).total).toBe(1);
  });

  it("applies bulk updates through the same rules as single updates", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const label = (await request(app).post("/labels").set(admin.auth).send({ name: "q3" })).body;
    const ids = [(await make(admin, { title: "1" })).id, (await make(admin, { title: "2" })).id];

    await request(app).post("/tasks/bulk").set(admin.auth).send({ ids, action: "update", data: { priority: "HIGH", assigneeId: member.userId, addLabelIds: [label.id] } }).expect(200);
    const items = (await list(admin)).items;
    expect(items.every((t: { priority: string; assigneeId: number; labels: unknown[] }) => t.priority === "HIGH" && t.assigneeId === member.userId && t.labels.length === 1)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "task.bulk" } })).toBe(1);

    await request(app).post("/tasks/bulk").set(admin.auth).send({ ids, action: "archive" }).expect(200);
    expect((await list(admin)).total).toBe(0);
  });

  it("is all-or-nothing: one forbidden or foreign task aborts the whole batch", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const outsider = await signUp();
    const own = await make(member, { title: "own" });
    const others = await make(admin, { title: "admin's" });
    const foreign = await make(outsider, { title: "foreign" });

    const denied = await request(app).post("/tasks/bulk").set(member.auth).send({ ids: [own.id, others.id], action: "update", data: { status: "DONE" } });
    expect(denied.status).toBe(403);
    expect(denied.body.details.denied).toEqual([others.id]);

    const missing = await request(app).post("/tasks/bulk").set(admin.auth).send({ ids: [others.id, foreign.id], action: "delete" });
    expect(missing.status).toBe(404);

    expect((await prisma.task.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("TODO");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: others.id } })).deletedAt).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: foreign.id } })).deletedAt).toBeNull();

    const tooMany = Array.from({ length: 201 }, (_, i) => i + 1);
    expect((await request(app).post("/tasks/bulk").set(admin.auth).send({ ids: tooMany, action: "archive" })).status).toBe(400);
  });

  it("moves tasks between board columns and keeps an explicit position", async () => {
    const admin = await signUp();
    const a = await make(admin, { title: "a" });
    const b = await make(admin, { title: "b" });
    await request(app).patch(`/tasks/${b.id}`).set(admin.auth).send({ status: "IN_PROGRESS" }).expect(200);
    await request(app).patch(`/tasks/${a.id}`).set(admin.auth).send({ status: "IN_PROGRESS", position: 1 }).expect(200);
    const col = (await list(admin, "?status=IN_PROGRESS&sort=position")).items.map((t: { title: string }) => t.title);
    expect(col).toEqual(["a", "b"]);
  });
});

describe("Labels and saved views", () => {
  it("label management needs labels:manage; names are unique per org", async () => {
    const admin = await signUp();
    const viewer = await addMember(admin, "VIEWER");
    const member = await addMember(admin, "MEMBER");
    const lead = await addMember(admin, "TEAM_LEAD");
    // Labels are org-wide, so plain members use them but don't create or delete them
    expect((await request(app).post("/labels").set(viewer.auth).send({ name: "x" })).status).toBe(403);
    expect((await request(app).post("/labels").set(member.auth).send({ name: "x" })).status).toBe(403);
    expect((await request(app).post("/labels").set(lead.auth).send({ name: "Bug" })).status).toBe(201);
    expect((await request(app).post("/labels").set(admin.auth).send({ name: "bug" })).status).toBe(409);
    expect((await request(app).get("/labels").set(viewer.auth)).body).toHaveLength(1);
  });

  it("saved views are private unless shared, and only the owner may change them", async () => {
    const admin = await signUp();
    const a = await addMember(admin, "MEMBER");
    const b = await addMember(admin, "MEMBER");
    const mine = (await request(app).post("/views").set(a.auth).send({ name: "Mine", viewType: "list", filters: { priority: ["HIGH"] } }).expect(201)).body;
    await request(app).post("/views").set(a.auth).send({ name: "Team", viewType: "board", shared: true }).expect(201);

    expect((await request(app).get("/views").set(b.auth)).body.map((v: { name: string }) => v.name)).toEqual(["Team"]);
    expect((await request(app).delete(`/views/${mine.id}`).set(b.auth)).status).toBe(404);
    const shared = (await request(app).get("/views").set(b.auth)).body[0];
    expect((await request(app).delete(`/views/${shared.id}`).set(b.auth)).status).toBe(403);
    expect((await request(app).delete(`/views/${shared.id}`).set(admin.auth)).status).toBe(200);
  });
});
