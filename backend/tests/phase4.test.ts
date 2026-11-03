import request from "supertest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { addMember, app, prisma, resetDb, signUp, type TestUser } from "./helpers";
import { testOutbox } from "../src/core/mailer";
import { publish, ready, stopEvents } from "../src/core/events";
import { runDueSoonSweep } from "../src/modules/notifications/notifications.service";

beforeEach(resetDb);
afterAll(() => stopEvents());

const task = async (u: TestUser, body: Record<string, unknown>) => {
  const r = await request(app).post("/tasks").set(u.auth).send(body);
  if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: number; projectId: string; key: string };
};
const comment = (u: TestUser, taskId: number, body: string, parentId?: string) => request(app).post(`/tasks/${taskId}/comments`).set(u.auth).send({ body, parentId });
const inbox = async (u: TestUser) => (await request(app).get("/notifications").set(u.auth).expect(200)).body.items as { type: string; taskId: number; data: Record<string, unknown>; readAt: string | null }[];
const settle = () => new Promise((r) => setTimeout(r, 150)); // emails are sent after the response
const mention = (u: TestUser, label = "someone") => `@[${label}](user:${u.userId})`;

describe("Comments", () => {
  it("threads one level deep, and anyone who can see the task (but org viewers) can comment", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const viewer = await addMember(admin, "VIEWER");
    const t = await task(admin, { title: "Hero copy" });

    const top = await comment(member, t.id, "First draft is up");
    expect(top.status).toBe(201);
    const reply = await comment(admin, t.id, "Looks good", top.body.id);
    expect(reply.status).toBe(201);
    expect((await comment(member, t.id, "too deep", reply.body.id)).status).toBe(400);
    expect((await comment(viewer, t.id, "can I?")).status).toBe(403);
    expect((await comment(admin, t.id, "   ")).status).toBe(400);

    const list = (await request(app).get(`/tasks/${t.id}/comments`).set(viewer.auth).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ body: "First draft is up", author: { id: member.userId }, replies: [{ body: "Looks good" }] });
    // Commenting follows the task
    expect(await prisma.taskWatcher.count({ where: { taskId: t.id, userId: member.userId } })).toBe(1);
  });

  it("is invisible across organizations and private projects", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const outsider = await signUp();
    const priv = (await request(app).post("/projects").set(admin.auth).send({ name: "Secret", visibility: "PRIVATE" })).body;
    const t = await task(admin, { title: "hidden", projectId: priv.id });
    const c = (await comment(admin, t.id, "classified")).body;

    for (const u of [member, outsider]) {
      expect((await request(app).get(`/tasks/${t.id}/comments`).set(u.auth)).status).toBe(404);
      expect((await comment(u, t.id, "hi")).status).toBe(404);
      expect((await request(app).patch(`/comments/${c.id}`).set(u.auth).send({ body: "pwned" })).status).toBe(404);
      expect((await request(app).delete(`/comments/${c.id}`).set(u.auth)).status).toBe(404);
    }
    expect((await request(app).get(`/projects/${priv.id}/activity`).set(member.auth)).status).toBe(404);
  });

  it("only the author edits; the author or a project manager deletes; deleted parents stay as placeholders", async () => {
    const admin = await signUp();
    const a = await addMember(admin, "MEMBER");
    const b = await addMember(admin, "MEMBER");
    const t = await task(admin, { title: "x" });
    const c = (await comment(a, t.id, "original")).body;
    await comment(b, t.id, "a reply", c.id);

    expect((await request(app).patch(`/comments/${c.id}`).set(b.auth).send({ body: "hijack" })).status).toBe(403);
    const edited = await request(app).patch(`/comments/${c.id}`).set(a.auth).send({ body: "revised" });
    expect(edited.body).toMatchObject({ body: "revised" });
    expect(edited.body.editedAt).toBeTruthy();

    expect((await request(app).delete(`/comments/${c.id}`).set(b.auth)).status).toBe(403);
    await request(app).delete(`/comments/${c.id}`).set(admin.auth).expect(200); // moderation
    expect(await prisma.auditLog.count({ where: { action: "comment.moderated" } })).toBe(1);

    const list = (await request(app).get(`/tasks/${t.id}/comments`).set(a.auth)).body;
    expect(list[0]).toMatchObject({ deleted: true, body: "", author: null, replies: [{ body: "a reply" }] });
  });

  it("toggles reactions from a fixed set", async () => {
    const admin = await signUp();
    const viewer = await addMember(admin, "VIEWER");
    const t = await task(admin, { title: "x" });
    const c = (await comment(admin, t.id, "ship it?")).body;
    const react = (u: TestUser, emoji: string) => request(app).post(`/comments/${c.id}/reactions`).set(u.auth).send({ emoji });

    expect((await react(admin, "🚀")).body.reactions).toEqual([{ emoji: "🚀", count: 1, mine: true }]);
    expect((await react(admin, "🚀")).body.reactions).toEqual([]);
    expect((await react(admin, "<script>")).status).toBe(400);
    expect((await react(viewer, "👍")).status).toBe(403);
  });
});

describe("Mentions", () => {
  it("notifies people who can see the task, under their real name; others become plain text", async () => {
    const admin = await signUp();
    const insider = await addMember(admin, "MEMBER");
    const outsiderInOrg = await addMember(admin, "MEMBER");
    await prisma.user.update({ where: { id: insider.userId }, data: { name: "Ines" } });
    const priv = (await request(app).post("/projects").set(admin.auth).send({ name: "Private", visibility: "PRIVATE" })).body;
    await request(app).post(`/projects/${priv.id}/members`).set(admin.auth).send({ userId: insider.userId }).expect(201);
    const t = await task(admin, { title: "Launch", projectId: priv.id });

    const res = await comment(admin, t.id, `${mention(insider, "The CEO")} and ${mention(outsiderInOrg, "Otto")} please look`);
    expect(res.body.body).toBe(`@[Ines](user:${insider.userId}) and @Otto please look`);

    expect((await inbox(insider)).map((n) => n.type)).toEqual(["MENTIONED"]);
    expect(await inbox(outsiderInOrg)).toEqual([]);
    expect(await prisma.commentMention.count()).toBe(1);
  });

  it("an edit notifies only people newly mentioned", async () => {
    const admin = await signUp();
    const a = await addMember(admin, "MEMBER");
    const b = await addMember(admin, "MEMBER");
    const t = await task(admin, { title: "x" });
    const c = (await comment(admin, t.id, `hey ${mention(a)}`)).body;
    await request(app).patch(`/comments/${c.id}`).set(admin.auth).send({ body: `hey ${mention(a)} and ${mention(b)}` }).expect(200);
    expect((await inbox(a)).filter((n) => n.type === "MENTIONED")).toHaveLength(1);
    expect((await inbox(b)).map((n) => n.type)).toEqual(["MENTIONED"]);
  });
});

describe("Notifications", () => {
  it("assignment, status changes and comments reach the right people, never the actor", async () => {
    const admin = await signUp();
    const dev = await addMember(admin, "MEMBER");
    const t = await task(admin, { title: "Fix login", assigneeId: dev.userId });
    expect((await inbox(dev)).map((n) => n.type)).toEqual(["ASSIGNED"]);
    expect(await inbox(admin)).toEqual([]); // creator doesn't notify themselves

    await request(app).patch(`/tasks/${t.id}`).set(dev.auth).send({ status: "IN_PROGRESS" }).expect(200);
    const forAdmin = await inbox(admin);
    expect(forAdmin.map((n) => n.type)).toEqual(["STATUS_CHANGED"]);
    expect(forAdmin[0].data).toMatchObject({ key: t.key, title: "Fix login", from: "TODO", to: "IN_PROGRESS" });

    await comment(admin, t.id, "Any update?");
    expect((await inbox(dev))[0]).toMatchObject({ type: "COMMENTED", data: { excerpt: "Any update?" } });

    // Self-assignment is silent
    const mine = await task(dev, { title: "mine", assigneeId: dev.userId });
    expect((await inbox(dev)).some((n) => n.taskId === mine.id)).toBe(false);
  });

  it("counts, marks read and stays inside its organization", async () => {
    const admin = await signUp();
    const dev = await addMember(admin, "MEMBER");
    const a = await task(admin, { title: "a", assigneeId: dev.userId });
    await task(admin, { title: "b", assigneeId: dev.userId });
    expect((await request(app).get("/notifications/count").set(dev.auth)).body.unread).toBe(2);

    await request(app).post(`/notifications/read-task/${a.id}`).set(dev.auth).expect(200);
    expect((await request(app).get("/notifications/count").set(dev.auth)).body.unread).toBe(1);
    await request(app).post("/notifications/read-all").set(dev.auth).expect(200);
    expect((await request(app).get("/notifications/count").set(dev.auth)).body.unread).toBe(0);

    // Someone else's notification ids can't be touched
    const other = await signUp();
    const theirs = await task(other, { title: "z" });
    const outsiderInOrg = await addMember(other, "MEMBER");
    await request(app).patch(`/tasks/${theirs.id}`).set(other.auth).send({ assigneeId: outsiderInOrg.userId }).expect(200);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: outsiderInOrg.userId } });
    await request(app).post("/notifications/read").set(dev.auth).send({ ids: [n.id] }).expect(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).toBeNull();
  });

  it("emails what asks something of you by default, escapes user content, and honours preferences", async () => {
    const admin = await signUp();
    const dev = await addMember(admin, "MEMBER");
    testOutbox.length = 0;
    const t = await task(admin, { title: "<img src=x onerror=alert(1)>", assigneeId: dev.userId });
    await settle();
    const assigned = testOutbox.filter((m) => m.to === dev.email);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(assigned[0].html).not.toContain("<img");

    await comment(admin, t.id, "plain comment"); // COMMENTED isn't emailed by default
    await settle();
    expect(testOutbox.filter((m) => m.to === dev.email)).toHaveLength(1);

    await request(app).put("/notifications/preferences").set(dev.auth).send({ emailTypes: [] }).expect(200);
    await comment(admin, t.id, `ping ${mention(dev)}`);
    await settle();
    expect(testOutbox.filter((m) => m.to === dev.email)).toHaveLength(1);
    expect((await inbox(dev)).some((n) => n.type === "MENTIONED")).toBe(true); // in-app stays on
    expect((await request(app).put("/notifications/preferences").set(dev.auth).send({ emailTypes: ["NOPE"] })).status).toBe(400);
  });

  it("approval requests and decisions notify the people involved", async () => {
    const admin = await signUp();
    const client = await addMember(admin, "CLIENT");
    const proj = (await request(app).post("/projects").set(admin.auth).send({ name: "Deliverables", key: "DEL" })).body;
    await request(app).post(`/projects/${proj.id}/members`).set(admin.auth).send({ userId: client.userId, role: "VIEWER" }).expect(201);
    const t = await task(admin, { title: "Logo", projectId: proj.id });
    const r = (await request(app).post(`/tasks/${t.id}/approvals`).set(admin.auth).send({ approverIds: [client.userId], note: "Final" }).expect(201)).body.approvals[0];
    expect((await inbox(client)).map((n) => n.type)).toEqual(["APPROVAL_REQUESTED"]);
    await request(app).post(`/approvals/${r.id}/decision`).set(client.auth).send({ decision: "APPROVE", comment: "Lovely" }).expect(200);
    expect((await inbox(admin)).find((n) => n.type === "APPROVAL_DECIDED")?.data).toMatchObject({ outcome: "APPROVED", completed: true, excerpt: "Lovely" });
  });

  it("people who lost access aren't notified", async () => {
    const admin = await signUp();
    const dev = await addMember(admin, "MEMBER");
    const priv = (await request(app).post("/projects").set(admin.auth).send({ name: "P", visibility: "PRIVATE" })).body;
    await request(app).post(`/projects/${priv.id}/members`).set(admin.auth).send({ userId: dev.userId }).expect(201);
    const t = await task(admin, { title: "x", projectId: priv.id });
    await request(app).post(`/tasks/${t.id}/watch`).set(dev.auth).expect(200);
    await request(app).delete(`/projects/${priv.id}/members/${dev.userId}`).set(admin.auth).expect(200);
    await comment(admin, t.id, "after removal");
    expect(await inbox(dev)).toEqual([]);
  });

  it("reminds assignees about open tasks due tomorrow, once", async () => {
    const admin = await signUp();
    const dev = await addMember(admin, "MEMBER");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await task(admin, { title: "due", assigneeId: dev.userId, dueDate: tomorrow });
    const done = await task(admin, { title: "done", assigneeId: dev.userId, dueDate: tomorrow });
    await request(app).patch(`/tasks/${done.id}`).set(admin.auth).send({ status: "DONE" }).expect(200);

    expect(await runDueSoonSweep()).toBe(1);
    expect(await runDueSoonSweep()).toBe(0);
    expect((await inbox(dev)).filter((n) => n.type === "DUE_SOON").map((n) => n.data.title)).toEqual(["due"]);
  });
});

describe("Activity feed", () => {
  it("merges task changes and comments, newest first", async () => {
    const admin = await signUp();
    const t = await task(admin, { title: "Feed me" });
    await request(app).patch(`/tasks/${t.id}`).set(admin.auth).send({ priority: "HIGH" }).expect(200);
    await comment(admin, t.id, `hello ${mention(admin, "me")}`);
    const feed = (await request(app).get(`/projects/${t.projectId}/activity`).set(admin.auth).expect(200)).body;
    expect(feed.map((f: { kind: string; type?: string }) => f.type ?? f.kind)).toEqual(["comment", "updated", "created"]);
    expect(feed[0]).toMatchObject({ task: { key: t.key }, excerpt: "hello @" + (admin.email.split("@")[0]) });
  });
});

// ─── Live stream ─────────────────────────────────────────────────────────────

describe("Live updates (Server-Sent Events)", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await ready();
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  /** Opens a stream and collects parsed events until stopped. */
  const listen = async (u: TestUser) => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/events`, { headers: { authorization: u.auth.Authorization }, signal: ctrl.signal });
    const events: { event: string; data: Record<string, unknown> }[] = [];
    let closed = false;
    const reader = res.body!.getReader();
    const pump = (async () => {
      let buf = "";
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const event = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (event && data) events.push({ event, data: JSON.parse(data) });
          }
        }
      } catch {
        /* aborted */
      }
      closed = true;
    })();
    const waitFor = async (pred: () => boolean, ms = 3000) => {
      const end = Date.now() + ms;
      while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      return pred();
    };
    await waitFor(() => events.some((e) => e.event === "ready"));
    return { status: res.status, events, waitFor, isClosed: () => closed, stop: () => (ctrl.abort(), pump) };
  };

  it("requires a valid token", async () => {
    expect((await fetch(`${base}/events`)).status).toBe(401);
    expect((await fetch(`${base}/events`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("signals changes to people who can see them, and nobody else", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const outsider = await signUp();
    const priv = (await request(app).post("/projects").set(admin.auth).send({ name: "Private", visibility: "PRIVATE" })).body;

    const [sAdmin, sMember, sOutsider] = await Promise.all([listen(admin), listen(member), listen(outsider)]);
    try {
    expect(sAdmin.status).toBe(200);

    const open = await task(admin, { title: "public" });
    const hidden = await task(admin, { title: "secret", projectId: priv.id });
    await request(app).patch(`/tasks/${open.id}`).set(admin.auth).send({ priority: "LOW" }).expect(200);

    const changed = (s: typeof sAdmin, id: number) => s.events.some((e) => e.event === "task.changed" && (e.data.taskIds as number[]).includes(id));
    expect(await sMember.waitFor(() => changed(sMember, open.id))).toBe(true);
    expect(await sAdmin.waitFor(() => changed(sAdmin, hidden.id))).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(changed(sMember, hidden.id)).toBe(false); // private project
    expect(sOutsider.events.filter((e) => e.event !== "ready")).toEqual([]); // other organization

    // Notifications are delivered only to their recipient
    await task(admin, { title: "for you", assigneeId: member.userId });
    expect(await sMember.waitFor(() => sMember.events.some((e) => e.event === "notification.created"))).toBe(true);
    expect(sAdmin.events.some((e) => e.event === "notification.created")).toBe(false);

    // Comment events carry ids only, never content
    await comment(admin, open.id, "secret words");
    expect(await sMember.waitFor(() => sMember.events.some((e) => e.event === "comment.changed"))).toBe(true);
    expect(JSON.stringify(sMember.events)).not.toContain("secret words");
    } finally {
      await Promise.all([sAdmin.stop(), sMember.stop(), sOutsider.stop()]);
    }
  });

  it("never crosses organizations, even for organization-wide events", async () => {
    const acme = await signUp();
    const globex = await signUp();
    const [a, g] = await Promise.all([listen(acme), listen(globex)]);
    try {
      await publish({ type: "project.changed", orgId: acme.orgId! });
      expect(await a.waitFor(() => a.events.some((e) => e.event === "project.changed"))).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      expect(g.events.some((e) => e.event === "project.changed")).toBe(false);
    } finally {
      await Promise.all([a.stop(), g.stop()]);
    }
  });

  it("closes open streams when the session is revoked", async () => {
    const admin = await signUp();
    const s = await listen(admin);
    try {
      await prisma.session.updateMany({ where: { userId: admin.userId }, data: { revokedAt: new Date() } });
      expect(await s.waitFor(() => s.isClosed(), 5000)).toBe(true);
      expect(s.events.some((e) => e.event === "stream.closed" && e.data.reason === "revoked")).toBe(true);
    } finally {
      await s.stop();
    }
  });
});
