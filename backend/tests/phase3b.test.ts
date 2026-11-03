import request from "supertest";
import { readdir } from "node:fs/promises";
import { addMember, app, isoDate, prisma, resetDb, signUp, type TestUser } from "./helpers";

beforeEach(resetDb);

const general = (u: TestUser) => prisma.project.findFirstOrThrow({ where: { organizationId: u.orgId!, key: "GEN" } });
const task = async (u: TestUser, body: Record<string, unknown> = {}) => {
  const res = await request(app).post("/tasks").set(u.auth).send({ title: "t", ...body });
  if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; key: string };
};
const detail = async (u: TestUser, id: number) => (await request(app).get(`/tasks/${id}`).set(u.auth).expect(200)).body;

// ─── Custom fields ───────────────────────────────────────────────────────────

describe("Custom fields", () => {
  const setup = async () => {
    const admin = await signUp();
    const p = await general(admin);
    const add = (body: object) => request(app).post(`/projects/${p.id}/fields`).set(admin.auth).send(body);
    return { admin, p, add };
  };

  it("only project managers define fields; select fields need options", async () => {
    const { admin, p, add } = await setup();
    const member = await addMember(admin, "MEMBER");
    expect((await request(app).post(`/projects/${p.id}/fields`).set(member.auth).send({ name: "Size", type: "NUMBER" })).status).toBe(403);
    expect((await add({ name: "Stage", type: "SELECT" })).status).toBe(400);
    expect((await add({ name: "Size", type: "NUMBER", options: [{ label: "x" }] })).status).toBe(400);
    expect((await add({ name: "Size", type: "NUMBER" })).status).toBe(201);
    expect((await add({ name: "size", type: "TEXT" })).status).toBe(409);
    expect((await request(app).get(`/projects/${p.id}/fields`).set(member.auth)).body).toHaveLength(1);
  });

  it("validates every value against its type, server-side", async () => {
    const { admin, add } = await setup();
    const outsider = await signUp();
    const num = (await add({ name: "Points", type: "NUMBER" })).body;
    const url = (await add({ name: "Spec", type: "URL" })).body;
    const sel = (await add({ name: "Stage", type: "SELECT", options: [{ label: "Design" }, { label: "Build" }] })).body;
    const multi = (await add({ name: "Platforms", type: "MULTI_SELECT", options: [{ label: "iOS" }, { label: "Web" }] })).body;
    const person = (await add({ name: "Reviewer", type: "USER" })).body;
    const date = (await add({ name: "Launch", type: "DATE" })).body;

    const t = await task(admin);
    const patch = (customFields: object) => request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ customFields });
    expect((await patch({ [num.id]: "abc" })).status).toBe(400);
    expect((await patch({ [url.id]: "javascript:alert(1)" })).status).toBe(400);
    expect((await patch({ [sel.id]: "opt_doesnotexist1" })).status).toBe(400);
    expect((await patch({ [multi.id]: [multi.options[0].id, "opt_nope00000"] })).status).toBe(400);
    expect((await patch({ [person.id]: outsider.userId })).status).toBe(400);
    expect((await patch({ [date.id]: "03/11/2026" })).status).toBe(400);

    const ok = await patch({ [num.id]: 5, [url.id]: "https://example.com/spec", [sel.id]: sel.options[1].id, [multi.id]: [multi.options[0].id, multi.options[0].id], [person.id]: admin.userId, [date.id]: "2026-12-01" });
    expect(ok.status).toBe(200);
    expect(ok.body.customFields).toMatchObject({ [num.id]: 5, [sel.id]: sel.options[1].id, [multi.id]: [multi.options[0].id] });
    const history = (await request(app).get(`/tasks/${t.id}/activity`).set(admin.auth)).body;
    expect(Object.keys(history[0].changes)).toContain("field:Points");
  });

  it("enforces required fields on create and on clear", async () => {
    const { admin, add } = await setup();
    const f = (await add({ name: "Customer", type: "TEXT", required: true })).body;
    const missing = await request(app).post("/tasks").set(admin.auth).send({ title: "x" });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/Customer/);
    const t = await task(admin, { customFields: { [f.id]: "Acme" } });
    expect((await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ customFields: { [f.id]: null } })).status).toBe(400);
  });

  it("rejects fields from another project and removes deleted options from tasks", async () => {
    const { admin, add } = await setup();
    const other = (await request(app).post("/projects").set(admin.auth).send({ name: "Other", key: "OTH" })).body;
    const foreign = (await request(app).post(`/projects/${other.id}/fields`).set(admin.auth).send({ name: "X", type: "TEXT" })).body;
    const t = await task(admin);
    expect((await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ customFields: { [foreign.id]: "hi" } })).status).toBe(400);

    const sel = (await add({ name: "Stage", type: "SELECT", options: [{ label: "A" }, { label: "B" }] })).body;
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ customFields: { [sel.id]: sel.options[0].id } }).expect(200);
    const p = await general(admin);
    await request(app).patch(`/projects/${p.id}/fields/${sel.id}`).set(admin.auth).send({ options: [sel.options[1]] }).expect(200);
    expect((await detail(admin, t.id)).customFields[sel.id]).toBeUndefined();
  });

  it("can't touch another organization's fields", async () => {
    const { p } = await setup();
    const outsider = await signUp();
    expect((await request(app).get(`/projects/${p.id}/fields`).set(outsider.auth)).status).toBe(404);
    expect((await request(app).post(`/projects/${p.id}/fields`).set(outsider.auth).send({ name: "x", type: "TEXT" })).status).toBe(404);
  });
});

// ─── Recurring tasks ─────────────────────────────────────────────────────────

describe("Recurring tasks", () => {
  it("creates the next occurrence on completion, copying the task, exactly once", async () => {
    const admin = await signUp();
    const label = (await request(app).post("/labels").set(admin.auth).send({ name: "ops" })).body;
    const t = await task(admin, { title: "Weekly report", dueDate: isoDate(2), priority: "HIGH", labelIds: [label.id] });
    await request(app).post(`/tasks/${t.id}/checklist`).set(admin.auth).send({ text: "Collect numbers" }).expect(201);
    const set = await request(app).put(`/tasks/${t.id}/recurrence`).set(admin.auth).send({ frequency: "WEEKLY" });
    expect(set.status).toBe(200);
    expect(set.body.recurrence).toMatchObject({ frequency: "WEEKLY", active: true });
    expect(set.body.isRecurring).toBe(true);

    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "DONE" }).expect(200);
    const done = await detail(admin, t.id);
    expect(done.nextOccurrence).toBeTruthy();
    const next = await detail(admin, done.nextOccurrence.id);
    expect(next).toMatchObject({ title: "Weekly report", priority: "HIGH", status: "TODO", labels: [{ name: "ops" }], checklistTotal: 1, checklistDone: 0 });
    expect(next.dueDate.slice(0, 10)).toBe(isoDate(9));
    expect(next.previousOccurrence.id).toBe(t.id);

    // Reopening and completing again doesn't create a second successor
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "TODO" }).expect(200);
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "DONE" }).expect(200);
    expect(await prisma.task.count({ where: { title: "Weekly report" } })).toBe(2);
  });

  it("stops at maxOccurrences and when stopped", async () => {
    const admin = await signUp();
    const t = await task(admin, { title: "Twice", dueDate: isoDate(1) });
    await request(app).put(`/tasks/${t.id}/recurrence`).set(admin.auth).send({ frequency: "DAILY", maxOccurrences: 2 }).expect(200);
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "DONE" }).expect(200);
    const second = (await detail(admin, t.id)).nextOccurrence.id;
    await request(app).patch(`/tasks/${second}`).set(admin.auth).send({ status: "DONE" }).expect(200);
    expect(await prisma.task.count({ where: { title: "Twice" } })).toBe(2);

    const s = await task(admin, { title: "Stopped", dueDate: isoDate(1) });
    await request(app).put(`/tasks/${s.id}/recurrence`).set(admin.auth).send({ frequency: "DAILY" }).expect(200);
    expect((await request(app).delete(`/tasks/${s.id}/recurrence`).set(admin.auth)).body.recurrence).toBeNull();
    await request(app).patch(`/tasks/${s.id}`).set(admin.auth).send({ status: "DONE" }).expect(200);
    expect(await prisma.task.count({ where: { title: "Stopped" } })).toBe(1);
  });

  it("concurrent completions still create only one successor", async () => {
    const admin = await signUp();
    const t = await task(admin, { title: "Race", dueDate: isoDate(1) });
    await request(app).put(`/tasks/${t.id}/recurrence`).set(admin.auth).send({ frequency: "DAILY" }).expect(200);
    await Promise.all([1, 2, 3].map(() => request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "DONE" })));
    expect(await prisma.task.count({ where: { title: "Race" } })).toBe(2);
  });

  it("validates the rule and who may set it", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const t = await task(admin);
    const sub = await task(admin, { parentId: t.id });
    expect((await request(app).put(`/tasks/${sub.id}/recurrence`).set(admin.auth).send({ frequency: "DAILY" })).status).toBe(400);
    expect((await request(app).put(`/tasks/${t.id}/recurrence`).set(admin.auth).send({ frequency: "DAILY", weekdays: [1] })).status).toBe(400);
    expect((await request(app).put(`/tasks/${t.id}/recurrence`).set(admin.auth).send({ frequency: "HOURLY" })).status).toBe(400);
    expect((await request(app).put(`/tasks/${t.id}/recurrence`).set(member.auth).send({ frequency: "DAILY" })).status).toBe(403);
  });
});

// ─── Templates ───────────────────────────────────────────────────────────────

describe("Templates", () => {
  it("saves a task with subtasks and checklist, and applies it as new tasks", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const t = await task(admin, { title: "Onboard client", priority: "HIGH", startDate: isoDate(1), dueDate: isoDate(6) });
    await task(admin, { title: "Kickoff call", parentId: t.id });
    await request(app).post(`/tasks/${t.id}/checklist`).set(admin.auth).send({ text: "Send welcome pack" }).expect(201);

    expect((await request(app).post(`/templates/from-task/${t.id}`).set(member.auth).send({ name: "x" })).status).toBe(403);
    const tpl = await request(app).post(`/templates/from-task/${t.id}`).set(admin.auth).send({ name: "Client onboarding" });
    expect(tpl.status).toBe(201);
    expect(tpl.body).toMatchObject({ subtaskCount: 1, checklistCount: 1, payload: { dueInDays: 5, startInDays: 0 } });

    // A member can *use* a template
    const gen = await general(admin);
    const applied = await request(app).post(`/templates/${tpl.body.id}/apply`).set(member.auth).send({ projectId: gen.id, title: "Onboard Globex" });
    expect(applied.status).toBe(201);
    expect(applied.body).toMatchObject({ title: "Onboard Globex", priority: "HIGH", checklistTotal: 1, subtaskCount: 1, createdById: member.userId });
    expect(applied.body.subtasks[0].title).toBe("Kickoff call");
    expect(applied.body.dueDate.slice(0, 10)).toBe(isoDate(5));
  });

  it("keeps project templates in their project and hides them from people who can't see it", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const priv = (await request(app).post("/projects").set(admin.auth).send({ name: "Secret", key: "SEC", visibility: "PRIVATE" })).body;
    const tpl = (await request(app).post("/templates").set(admin.auth).send({ name: "Secret flow", projectId: priv.id, payload: { title: "Do it" } })).body;
    const gen = await general(admin);
    expect((await request(app).post(`/templates/${tpl.id}/apply`).set(admin.auth).send({ projectId: gen.id })).status).toBe(400);
    expect((await request(app).get("/templates").set(member.auth)).body).toEqual([]);
    expect((await request(app).post(`/templates/${tpl.id}/apply`).set(member.auth).send({ projectId: priv.id })).status).toBe(404);

    const outsider = await signUp();
    expect((await request(app).get(`/templates/${tpl.id}`).set(outsider.auth)).status).toBe(404);
  });

  it("validates payloads and respects required fields when applied", async () => {
    const admin = await signUp();
    const gen = await general(admin);
    expect((await request(app).post("/templates").set(admin.auth).send({ name: "Bad", payload: { title: "" } })).status).toBe(400);
    expect((await request(app).post("/templates").set(admin.auth).send({ name: "Bad", payload: { title: "x", labelIds: ["nope123"] } })).status).toBe(400);
    const tpl = (await request(app).post("/templates").set(admin.auth).send({ name: "Plain", payload: { title: "x" } })).body;
    const f = (await request(app).post(`/projects/${gen.id}/fields`).set(admin.auth).send({ name: "Customer", type: "TEXT", required: true })).body;
    expect((await request(app).post(`/templates/${tpl.id}/apply`).set(admin.auth).send({ projectId: gen.id })).status).toBe(400);
    expect((await request(app).post(`/templates/${tpl.id}/apply`).set(admin.auth).send({ projectId: gen.id, customFields: { [f.id]: "Acme" } })).status).toBe(201);
  });
});

// ─── Attachments ─────────────────────────────────────────────────────────────

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

describe("Attachments", () => {
  it("uploads, lists, downloads with safe headers, and deletes", async () => {
    const admin = await signUp();
    const t = await task(admin);
    const up = await request(app).post(`/tasks/${t.id}/attachments`).set(admin.auth).attach("file", PNG, "../../etc/screen shot.png");
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ fileName: "screen shot.png", mimeType: "image/png", size: PNG.length });
    expect((await detail(admin, t.id)).attachments).toHaveLength(1);

    const dl = await request(app).get(`/attachments/${up.body.id}/download`).set(admin.auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
    expect(dl.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(dl.headers["content-security-policy"]).toMatch(/sandbox/);
    expect((await request(app).get(`/attachments/${up.body.id}/download?inline=1`).set(admin.auth)).headers["content-disposition"]).toMatch(/^inline;/);

    await request(app).delete(`/attachments/${up.body.id}`).set(admin.auth).expect(200);
    expect(await prisma.attachment.count()).toBe(0);
    expect((await request(app).get(`/attachments/${up.body.id}/download`).set(admin.auth)).status).toBe(404);
  });

  it("rejects disallowed types, disguised files and oversized uploads", async () => {
    const admin = await signUp();
    const t = await task(admin);
    const post = () => request(app).post(`/tasks/${t.id}/attachments`).set(admin.auth);
    expect((await post().attach("file", Buffer.from("MZ\x90\x00"), "tool.exe")).status).toBe(415);
    expect((await post().attach("file", Buffer.from("<html><script>alert(1)</script>"), "cat.png")).status).toBe(415);
    expect((await post().attach("file", Buffer.from("<svg onload=alert(1)>"), "notes.txt")).status).toBe(415);
    expect((await post().attach("file", Buffer.alloc(1024 * 1024 + 10, 0x41), "big.txt")).status).toBe(413);
    expect((await post()).status).toBe(400);
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("keeps files private to people who can see the task", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const outsider = await signUp();
    const priv = (await request(app).post("/projects").set(admin.auth).send({ name: "Secret", key: "SEC", visibility: "PRIVATE" })).body;
    const t = await task(admin, { projectId: priv.id });
    const up = (await request(app).post(`/tasks/${t.id}/attachments`).set(admin.auth).attach("file", Buffer.from("hello"), "a.txt")).body;
    expect((await request(app).get(`/attachments/${up.id}/download`).set(member.auth)).status).toBe(404);
    expect((await request(app).get(`/attachments/${up.id}/download`).set(outsider.auth)).status).toBe(404);
    expect((await request(app).delete(`/attachments/${up.id}`).set(outsider.auth)).status).toBe(404);
    expect((await request(app).get(`/attachments/${up.id}/download`)).status).toBe(401);
  });

  it("only the uploader or a full editor may delete; deleting a project removes its files", async () => {
    const admin = await signUp();
    const a = await addMember(admin, "MEMBER");
    const b = await addMember(admin, "MEMBER");
    const proj = (await request(app).post("/projects").set(admin.auth).send({ name: "Files", key: "FIL" })).body;
    const t = await task(a, { projectId: proj.id, assigneeId: b.userId });
    const upA = (await request(app).post(`/tasks/${t.id}/attachments`).set(a.auth).attach("file", Buffer.from("from a"), "a.txt")).body;
    expect((await request(app).delete(`/attachments/${upA.id}`).set(b.auth)).status).toBe(403);
    await request(app).post(`/tasks/${t.id}/attachments`).set(b.auth).attach("file", Buffer.from("from b"), "b.txt").expect(201);

    const dir = process.env.UPLOAD_DIR!;
    const countFiles = async () => (await Promise.all((await readdir(dir)).map(async (d) => (await readdir(`${dir}/${d}`)).length))).reduce((x, y) => x + y, 0);
    const before = await countFiles();
    await request(app).patch(`/projects/${proj.id}`).set(admin.auth).send({ status: "ARCHIVED" }).expect(200);
    await request(app).delete(`/projects/${proj.id}`).set(admin.auth).expect(200);
    expect(await countFiles()).toBe(before - 2);
  });
});

// ─── Approvals ───────────────────────────────────────────────────────────────

describe("Approvals", () => {
  const setup = async () => {
    const admin = await signUp();
    const lead = await addMember(admin, "TEAM_LEAD");
    const client = await addMember(admin, "CLIENT");
    const viewer = await addMember(admin, "VIEWER");
    const proj = (await request(app).post("/projects").set(admin.auth).send({ name: "Deliverables", key: "DEL" })).body;
    await request(app).post(`/projects/${proj.id}/members`).set(admin.auth).send({ userId: client.userId, role: "VIEWER" }).expect(201);
    const t = await task(admin, { title: "Logo", projectId: proj.id });
    return { admin, lead, client, viewer, proj, t };
  };
  const ask = (u: TestUser, id: number, body: object) => request(app).post(`/tasks/${id}/approvals`).set(u.auth).send(body);
  const decide = (u: TestUser, requestId: string, decision: "APPROVE" | "REJECT", comment?: string) =>
    request(app).post(`/approvals/${requestId}/decision`).set(u.auth).send({ decision, comment });

  it("a client approves a deliverable and the task completes", async () => {
    const { admin, client, t } = await setup();
    const res = await ask(admin, t.id, { approverIds: [client.userId], note: "Final logo" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("IN_REVIEW");
    const pending = res.body.approvals[0];
    expect(pending.status).toBe("PENDING");

    // Can't bypass the review by marking it done
    const bypass = await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "DONE" });
    expect(bypass.status).toBe(409);
    expect(bypass.body.code).toBe("APPROVAL_PENDING");

    const inbox = (await request(app).get("/approvals").set(client.auth)).body;
    expect(inbox.map((r: { task: { key: string } }) => r.task.key)).toEqual(["DEL-1"]);
    expect((await request(app).get("/approvals/count").set(client.auth)).body.pending).toBe(1);

    const ok = await decide(client, pending.id, "APPROVE", "Looks great");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "APPROVED", completed: true, task: { status: "DONE" } });
    expect((await decide(client, pending.id, "APPROVE")).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "approval.decided" } })).toBe(1);
  });

  it("rejection sends the task back; ALL needs every approver", async () => {
    const { admin, lead, client, t } = await setup();
    const r1 = (await ask(admin, t.id, { approverIds: [client.userId] })).body.approvals[0];
    const rej = await decide(client, r1.id, "REJECT", "Wrong colour");
    expect(rej.body).toMatchObject({ status: "REJECTED", task: { status: "IN_PROGRESS" } });

    const r2 = (await ask(admin, t.id, { approverIds: [client.userId, lead.userId], rule: "ALL" })).body.approvals[0];
    expect((await decide(client, r2.id, "APPROVE")).body).toMatchObject({ status: "PENDING", completed: false });
    expect((await decide(lead, r2.id, "APPROVE")).body).toMatchObject({ status: "APPROVED", completed: true });
  });

  it("checks who may request, approve and cancel", async () => {
    const { admin, lead, client, viewer, t } = await setup();
    const outsider = await signUp();
    expect((await ask(admin, t.id, { approverIds: [admin.userId] })).status).toBe(400); // self
    expect((await ask(admin, t.id, { approverIds: [viewer.userId] })).status).toBe(400); // read-only role
    expect((await ask(admin, t.id, { approverIds: [outsider.userId] })).status).toBe(400); // other org
    expect((await ask(client, t.id, { approverIds: [admin.userId] })).status).toBe(403); // clients can't request

    const r = (await ask(admin, t.id, { approverIds: [client.userId] })).body.approvals[0];
    expect((await ask(admin, t.id, { approverIds: [lead.userId] })).status).toBe(409); // one pending at a time
    expect((await decide(lead, r.id, "APPROVE")).status).toBe(403); // not an approver
    expect((await decide(outsider, r.id, "APPROVE")).status).toBe(404);
    expect((await request(app).post(`/approvals/${r.id}/cancel`).set(client.auth)).status).toBe(403);
    const cancelled = await request(app).post(`/approvals/${r.id}/cancel`).set(admin.auth);
    expect(cancelled.body.status).toBe("IN_PROGRESS");
    expect((await decide(client, r.id, "APPROVE")).status).toBe(409);
  });

  it("an approver demoted to Viewer can no longer decide", async () => {
    const { admin, lead, t } = await setup();
    const r = (await ask(admin, t.id, { approverIds: [lead.userId] })).body.approvals[0];
    await request(app).patch(`/orgs/current/members/${lead.userId}`).set(admin.auth).send({ role: "VIEWER" }).expect(200);
    const res = await decide(lead, r.id, "APPROVE");
    expect(res.status).toBe(403);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
  });

  it("a project that requires approval refuses direct completion, and an approval is used once", async () => {
    const { admin, client, proj, t } = await setup();
    await request(app).patch(`/projects/${proj.id}`).set(admin.auth).send({ completionApproval: "REQUIRED" }).expect(200);
    const direct = await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "DONE" });
    expect(direct.body.code).toBe("APPROVAL_REQUIRED");
    expect((await request(app).post("/tasks").set(admin.auth).send({ title: "x", projectId: proj.id, status: "DONE" })).status).toBe(409);
    const other = await task(admin, { projectId: proj.id });
    expect((await request(app).post("/tasks/bulk").set(admin.auth).send({ ids: [other.id], action: "update", data: { status: "DONE" } })).status).toBe(409);

    const r = (await ask(admin, t.id, { approverIds: [client.userId] })).body.approvals[0];
    await decide(client, r.id, "APPROVE").expect(200);
    // Reopen: the old approval is spent
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "IN_PROGRESS" }).expect(200);
    expect((await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "DONE" })).body.code).toBe("APPROVAL_REQUIRED");
    expect(await prisma.auditLog.count({ where: { action: "project.approval_policy_changed" } })).toBe(1);
  });

  it("approval of a blocked task is recorded but doesn't complete it", async () => {
    const { admin, client, proj, t } = await setup();
    const blocker = await task(admin, { title: "Brief", projectId: proj.id });
    await request(app).post(`/tasks/${t.id}/dependencies`).set(admin.auth).send({ dependsOnId: blocker.id }).expect(201);
    const r = (await ask(admin, t.id, { approverIds: [client.userId] })).body.approvals[0];
    const res = await decide(client, r.id, "APPROVE");
    expect(res.body).toMatchObject({ status: "APPROVED", completed: false, task: { status: "IN_REVIEW" } });
    await request(app).patch(`/tasks/${blocker.id}`).set(admin.auth).send({ status: "DONE" }).expect(200);
    // The unused approval lets it complete now
    expect((await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ status: "DONE" })).status).toBe(200);
  });

  it("approving a recurring task's completion still creates the next occurrence", async () => {
    const { admin, client, t } = await setup();
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ dueDate: isoDate(1) }).expect(200);
    await request(app).put(`/tasks/${t.id}/recurrence`).set(admin.auth).send({ frequency: "MONTHLY" }).expect(200);
    const r = (await ask(admin, t.id, { approverIds: [client.userId] })).body.approvals[0];
    await decide(client, r.id, "APPROVE").expect(200);
    expect(await prisma.task.count({ where: { title: "Logo" } })).toBe(2);
  });
});
