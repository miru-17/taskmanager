import request from "supertest";
import { randomUUID } from "node:crypto";
import { addMember, app, prisma, resetDb, signUp, isoDate, type TestUser } from "./helpers";
import { drainQueue } from "../src/core/queue";
import { stopEvents } from "../src/core/events";
import { processEvent, runTimeSweep, FAILURE_LIMIT, MAX_DEPTH, RATE_LIMIT_PER_MINUTE } from "../src/modules/automation/engine";
import type { AutomationEvent } from "../src/modules/automation/definitions";

beforeEach(resetDb);
afterAll(() => stopEvents());

const task = async (u: TestUser, body: Record<string, unknown>) => {
  const r = await request(app).post("/tasks").set(u.auth).send(body);
  if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  await drainQueue();
  return r.body as { id: number; projectId: string; key: string };
};
const patch = async (u: TestUser, id: number, body: Record<string, unknown>) => {
  const r = await request(app).patch(`/tasks/${id}`).set(u.auth).send(body);
  await drainQueue();
  return r;
};
const rule = (u: TestUser, projectId: string, body: Record<string, unknown>) => request(app).post(`/projects/${projectId}/automations`).set(u.auth).send({ name: "Rule", ...body });
const mustRule = async (u: TestUser, projectId: string, body: Record<string, unknown>) => {
  const r = await rule(u, projectId, body);
  if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string };
};
const runs = (ruleId: string) => prisma.automationRun.findMany({ where: { ruleId }, orderBy: { createdAt: "asc" } });
const label = async (u: TestUser, name: string) => (await request(app).post("/labels").set(u.auth).send({ name, color: "#3366ff" }).expect(201)).body as { id: string };
const defaultProject = async (u: TestUser) => (await task(u, { title: "seed" })).projectId;

describe("Rule validation and permissions", () => {
  it("validates triggers, conditions, actions and references on save", async () => {
    const admin = await signUp();
    const other = await signUp();
    const pid = await defaultProject(admin);
    const foreignLabel = await label(other, "theirs");
    const outsider = other.userId;

    const bad: [Record<string, unknown>, RegExp][] = [
      [{ trigger: "NOPE", actions: [{ type: "SET_STATUS", status: "DONE" }] }, /./],
      [{ trigger: "TASK_CREATED", actions: [] }, /at least one action/i],
      [{ trigger: "STATUS_CHANGED", triggerConfig: { to: "DONE", extra: 1 }, actions: [{ type: "SET_PRIORITY", priority: "LOW" }] }, /./],
      [{ trigger: "STATUS_CHANGED", triggerConfig: { from: "DONE", to: "DONE" }, actions: [{ type: "SET_PRIORITY", priority: "LOW" }] }, /differ/],
      [{ trigger: "DUE_SOON", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] }, /how many days/i],
      [{ trigger: "DUE_SOON", triggerConfig: { days: 99 }, actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] }, /./],
      [{ trigger: "TASK_CREATED", conditions: [{ field: "title", op: "contains", value: "" }], actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] }, /./],
      [{ trigger: "TASK_CREATED", actions: [{ type: "DELETE_EVERYTHING" }] }, /./],
      [{ trigger: "TASK_CREATED", actions: [{ type: "ADD_LABEL", labelId: foreignLabel.id }] }, /labels don't exist/],
      [{ trigger: "TASK_CREATED", actions: [{ type: "ASSIGN", to: outsider }] }, /./],
      [{ trigger: "TASK_CREATED", actions: [{ type: "NOTIFY", to: outsider, message: "hi" }] }, /./],
      [{ trigger: "TASK_CREATED", actions: [{ type: "SET_STATUS", status: "DONE" }, { type: "SET_STATUS", status: "TODO" }] }, /only once/],
      [{ trigger: "TASK_CREATED", actions: Array.from({ length: 11 }, () => ({ type: "ADD_COMMENT", body: "x" })) }, /./],
      [{ name: "", trigger: "TASK_CREATED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] }, /name/i],
    ];
    for (const [body, msg] of bad) {
      const r = await rule(admin, pid, body);
      expect([r.status, JSON.stringify(body)]).toEqual([400, JSON.stringify(body)]);
      expect(JSON.stringify(r.body)).toMatch(msg);
    }
    expect(await prisma.automationRule.count()).toBe(0);
  });

  it("only project managers change rules; members can read them; clients can't see them", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const viewer = await addMember(admin, "VIEWER");
    const client = await addMember(admin, "CLIENT");
    const pid = await defaultProject(admin);
    await request(app).post(`/projects/${pid}/members`).set(admin.auth).send({ userId: client.userId, role: "VIEWER" }).expect(201);
    const body = { trigger: "TASK_CREATED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] };
    const r = await mustRule(admin, pid, body);

    for (const u of [member, viewer]) {
      expect((await rule(u, pid, body)).status).toBe(403);
      expect((await request(app).patch(`/automations/${r.id}`).set(u.auth).send({ enabled: false })).status).toBe(403);
      expect((await request(app).delete(`/automations/${r.id}`).set(u.auth)).status).toBe(403);
      const list = (await request(app).get(`/projects/${pid}/automations`).set(u.auth).expect(200)).body;
      expect(list).toMatchObject({ canManage: false, rules: [{ id: r.id }] });
      expect((await request(app).get(`/automations/${r.id}/runs`).set(u.auth)).status).toBe(200);
    }
    expect((await request(app).get(`/projects/${pid}/automations`).set(client.auth)).status).toBe(403);
    expect((await request(app).get(`/automations/${r.id}/runs`).set(client.auth)).status).toBe(403);

    // A project MANAGER who is only a MEMBER in the org can manage this project's rules
    await request(app).post(`/projects/${pid}/members`).set(admin.auth).send({ userId: member.userId, role: "MANAGER" }).expect(201);
    expect((await rule(member, pid, body)).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: "automation.created" } })).toBe(2);
  });

  it("is invisible across organizations and private projects", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const outsider = await signUp();
    const priv = (await request(app).post("/projects").set(admin.auth).send({ name: "Secret", visibility: "PRIVATE" })).body;
    const r = await mustRule(admin, priv.id, { trigger: "TASK_CREATED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] });
    const t = await task(admin, { title: "x", projectId: priv.id });

    for (const u of [member, outsider]) {
      expect((await request(app).get(`/projects/${priv.id}/automations`).set(u.auth)).status).toBe(404);
      expect((await rule(u, priv.id, { trigger: "TASK_CREATED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] })).status).toBe(404);
      expect((await request(app).patch(`/automations/${r.id}`).set(u.auth).send({ name: "pwned" })).status).toBe(404);
      expect((await request(app).delete(`/automations/${r.id}`).set(u.auth)).status).toBe(404);
      expect((await request(app).get(`/automations/${r.id}/runs`).set(u.auth)).status).toBe(404);
      expect((await request(app).post(`/automations/${r.id}/test`).set(u.auth).send({ taskId: t.id })).status).toBe(404);
    }
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: r.id } })).name).toBe("Rule");
  });

  it("an update is validated as a whole rule", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "STATUS_CHANGED", triggerConfig: { to: "DONE" }, actions: [{ type: "SET_PRIORITY", priority: "LOW" }] });
    // Changing the trigger drops options that no longer apply
    const up = await request(app).patch(`/automations/${r.id}`).set(admin.auth).send({ trigger: "TASK_CREATED" }).expect(200);
    expect(up.body).toMatchObject({ trigger: "TASK_CREATED", triggerConfig: {} });
    expect((await request(app).patch(`/automations/${r.id}`).set(admin.auth).send({ trigger: "DUE_SOON" })).status).toBe(400);
    expect((await request(app).patch(`/automations/${r.id}`).set(admin.auth).send({ actions: [] })).status).toBe(400);
  });
});

describe("Running rules", () => {
  it("TASK_CREATED with conditions: assigns, labels and comments, recorded as the automation", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const pid = await defaultProject(admin);
    const urgent = await label(admin, "urgent");
    const r = await mustRule(admin, pid, {
      name: "Triage critical bugs",
      trigger: "TASK_CREATED",
      conditions: [
        { field: "priority", op: "is", value: ["CRITICAL"] },
        { field: "title", op: "contains", value: "bug" },
      ],
      actions: [
        { type: "ASSIGN", to: "creator" },
        { type: "ADD_LABEL", labelId: urgent.id },
        { type: "SET_STATUS", status: "IN_PROGRESS" },
        { type: "ADD_COMMENT", body: `Picked up automatically @[x](user:${admin.userId})` },
      ],
    });

    const skipped = await task(member, { title: "Bug in login", priority: "LOW" });
    const hit = await task(member, { title: "BUG: payments down", priority: "CRITICAL" });

    const t = (await request(app).get(`/tasks/${hit.id}`).set(admin.auth).expect(200)).body;
    expect(t).toMatchObject({ status: "IN_PROGRESS", assignee: { id: member.userId } });
    expect(t.labels.map((l: { id: string }) => l.id)).toEqual([urgent.id]);
    expect((await request(app).get(`/tasks/${skipped.id}`).set(admin.auth)).body).toMatchObject({ status: "TODO", assignee: null });

    const comments = (await request(app).get(`/tasks/${hit.id}/comments`).set(admin.auth).expect(200)).body;
    expect(comments).toMatchObject([{ author: null, automation: "Triage critical bugs" }]);
    // The mention in an automation comment notifies like a person's would
    expect(await prisma.notification.count({ where: { userId: admin.userId, type: "MENTIONED", taskId: hit.id } })).toBe(1);

    const activity = await prisma.taskActivity.findMany({ where: { taskId: hit.id }, orderBy: { id: "asc" } });
    const byAutomation = activity.filter((a) => a.type === "updated" && a.actorId === null);
    expect(byAutomation).toHaveLength(1);
    expect(byAutomation[0].changes).toMatchObject({ _automation: "Triage critical bugs", status: { from: "TODO", to: "IN_PROGRESS" } });
    // The assignee hears who did it
    const assigned = await prisma.notification.findFirstOrThrow({ where: { userId: member.userId, type: "ASSIGNED", taskId: hit.id } });
    expect(assigned).toMatchObject({ actorId: null, data: expect.objectContaining({ actorName: "Automation “Triage critical bugs”" }) });
    expect(activity.some((a) => a.type === "automation_ran" && (a.changes as { rule: string }).rule === "Triage critical bugs")).toBe(true);

    const log = await runs(r.id);
    expect(log.map((x) => x.status).sort()).toEqual(["SKIPPED", "SUCCEEDED"]); // the low-priority task, then the hit
    const rr = await prisma.automationRule.findUniqueOrThrow({ where: { id: r.id } });
    expect(rr).toMatchObject({ runCount: 1, failureStreak: 0 });
  });

  it("STATUS_CHANGED options and NOTIFY recipients", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const pid = await defaultProject(admin);
    await mustRule(admin, pid, {
      trigger: "STATUS_CHANGED",
      triggerConfig: { from: "IN_REVIEW", to: "DONE" },
      actions: [{ type: "NOTIFY", to: "creator", message: "Shipped" }],
    });
    const t = await task(member, { title: "x", assigneeId: member.userId });
    await patch(admin, t.id, { status: "IN_PROGRESS" });
    await patch(admin, t.id, { status: "DONE" }); // from IN_PROGRESS: no match
    expect(await prisma.notification.count({ where: { type: "AUTOMATION" } })).toBe(0);
    await patch(admin, t.id, { status: "IN_REVIEW" });
    await patch(admin, t.id, { status: "DONE" });
    const n = await prisma.notification.findMany({ where: { type: "AUTOMATION" } });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ userId: member.userId, actorId: null, data: expect.objectContaining({ message: "Shipped", rule: "Rule" }) });
  });

  it("disabled rules don't run, and ordinary edits don't queue anything when no rule applies", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "TASK_CREATED", enabled: false, actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] });
    const t = await task(admin, { title: "x", priority: "LOW" });
    expect((await request(app).get(`/tasks/${t.id}`).set(admin.auth)).body.priority).toBe("LOW");
    expect(await runs(r.id)).toHaveLength(0);
  });

  it("follows the same rules as a person: a blocked task can't be completed by an automation", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const blocker = await task(admin, { title: "blocker" });
    const t = await task(admin, { title: "blocked" });
    await request(app).post(`/tasks/${t.id}/dependencies`).set(admin.auth).send({ dependsOnId: blocker.id }).expect(201);
    const r = await mustRule(admin, pid, { trigger: "PRIORITY_CHANGED", actions: [{ type: "SET_STATUS", status: "DONE" }, { type: "ADD_COMMENT", body: "closing" }] });
    await patch(admin, t.id, { priority: "HIGH" });

    const [run] = await runs(r.id);
    expect(run.status).toBe("FAILED");
    expect(JSON.stringify(run.detail)).toMatch(/block/i);
    const fresh = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(fresh.status).toBe("TODO");
    // Nothing partial: the comment after the failed update was not written either
    expect(await prisma.taskComment.count({ where: { taskId: t.id } })).toBe(0);
  });
});

describe("Loop guard", () => {
  it("two rules that undo each other stop after one round", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const a = await mustRule(admin, pid, { name: "A", trigger: "STATUS_CHANGED", triggerConfig: { to: "IN_PROGRESS" }, actions: [{ type: "SET_STATUS", status: "IN_REVIEW" }] });
    const b = await mustRule(admin, pid, { name: "B", trigger: "STATUS_CHANGED", triggerConfig: { to: "IN_REVIEW" }, actions: [{ type: "SET_STATUS", status: "IN_PROGRESS" }] });
    const t = await task(admin, { title: "ping-pong" });

    await patch(admin, t.id, { status: "IN_PROGRESS" });

    const ra = await runs(a.id);
    const rb = await runs(b.id);
    expect(ra.map((r) => [r.status, r.depth])).toEqual([["SUCCEEDED", 0], ["LOOP_BLOCKED", 2]]);
    expect(rb.map((r) => [r.status, r.depth])).toEqual([["SUCCEEDED", 1]]);
    expect(ra[1].detail).toMatchObject({ reason: "loop", chain: [a.id, b.id] });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("IN_PROGRESS");
    // A person's next change starts a fresh chain, so the rules still work afterwards
    await patch(admin, t.id, { status: "TODO" });
    await patch(admin, t.id, { status: "IN_PROGRESS" });
    expect((await runs(a.id)).filter((r) => r.status === "SUCCEEDED")).toHaveLength(2);
  });

  it("a rule never re-triggers itself", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "PRIORITY_CHANGED", actions: [{ type: "SET_PRIORITY", priority: "LOW" }] });
    const t = await task(admin, { title: "x", priority: "MEDIUM" });
    await patch(admin, t.id, { priority: "HIGH" });
    expect((await runs(r.id)).map((x) => x.status)).toEqual(["SUCCEEDED", "LOOP_BLOCKED"]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).priority).toBe("LOW");
  });

  it("chains are cut off at the maximum depth", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "COMMENT_ADDED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] });
    const t = await task(admin, { title: "x" });
    const ev = (depth: number): AutomationEvent => ({ eventId: randomUUID(), orgId: admin.orgId!, projectId: pid, taskId: t.id, trigger: "COMMENT_ADDED", actorId: null, depth, chain: ["someOtherRule"] });
    expect((await processEvent(ev(MAX_DEPTH - 1)))[0].status).toBe("SUCCEEDED");
    expect((await processEvent(ev(MAX_DEPTH)))[0]).toMatchObject({ status: "LOOP_BLOCKED", detail: { reason: "depth" } });
    expect(await prisma.automationRun.count({ where: { ruleId: r.id } })).toBe(2);
  });

  it("a rule running away across tasks is switched off by the rate guard", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "COMMENT_ADDED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] });
    const t = await task(admin, { title: "x" });
    await prisma.automationRun.createMany({
      data: Array.from({ length: RATE_LIMIT_PER_MINUTE }, (_, i) => ({ ruleId: r.id, organizationId: admin.orgId!, taskId: t.id, eventId: `old-${i}`, status: "SUCCEEDED" as const, detail: {} })),
    });
    await request(app).post(`/tasks/${t.id}/comments`).set(admin.auth).send({ body: "hello" }).expect(201);
    await drainQueue();
    const last = (await runs(r.id)).at(-1)!;
    expect(last).toMatchObject({ status: "LOOP_BLOCKED", detail: { reason: "rate_limit" } });
    const rr = await prisma.automationRule.findUniqueOrThrow({ where: { id: r.id } });
    expect(rr.enabled).toBe(false);
    expect(rr.disabledReason).toMatch(/times in a minute/);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).priority).not.toBe("HIGH");
  });
});

describe("Duplicate events", () => {
  it("the same event delivered twice, or concurrently, runs each rule once", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "COMMENT_ADDED", actions: [{ type: "ADD_COMMENT", body: "Thanks, we'll look" }] });
    const t = await task(admin, { title: "x" });
    const event: AutomationEvent = { eventId: randomUUID(), orgId: admin.orgId!, projectId: pid, taskId: t.id, trigger: "COMMENT_ADDED", actorId: admin.userId, depth: 0, chain: [] };

    const outcomes = (await Promise.all(Array.from({ length: 6 }, () => processEvent({ ...event })))).flat();
    expect(outcomes.filter((o) => o.status === "SUCCEEDED")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "DUPLICATE")).toHaveLength(5);
    expect((await processEvent(event))[0].status).toBe("DUPLICATE"); // a later redelivery
    expect(await prisma.taskComment.count({ where: { taskId: t.id } })).toBe(1);
    expect(await prisma.automationRun.count({ where: { ruleId: r.id } })).toBe(1);
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: r.id } })).runCount).toBe(1);
  });

  it("an automation's own comment doesn't trigger comment rules", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "COMMENT_ADDED", actions: [{ type: "ADD_COMMENT", body: "auto reply" }] });
    const t = await task(admin, { title: "x" });
    await request(app).post(`/tasks/${t.id}/comments`).set(admin.auth).send({ body: "hello" }).expect(201);
    await drainQueue();
    expect(await prisma.taskComment.count({ where: { taskId: t.id } })).toBe(2);
    expect(await runs(r.id)).toHaveLength(1);
  });

  it("the time sweep fires each task once per due date however often it runs", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const soon = await mustRule(admin, pid, { trigger: "DUE_SOON", triggerConfig: { days: 2 }, actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] });
    const late = await mustRule(admin, pid, { trigger: "OVERDUE", actions: [{ type: "SET_PRIORITY", priority: "CRITICAL" }] });
    const dueIn2 = await task(admin, { title: "in two days", dueDate: isoDate(2), priority: "LOW" });
    const dueIn3 = await task(admin, { title: "in three days", dueDate: isoDate(3), priority: "LOW" });
    const overdue = await task(admin, { title: "overdue", priority: "LOW" });
    const done = await task(admin, { title: "done", priority: "LOW" });
    await prisma.task.update({ where: { id: overdue.id }, data: { dueDate: new Date(`${isoDate(-1)}T00:00:00Z`) } });
    await prisma.task.update({ where: { id: done.id }, data: { dueDate: new Date(`${isoDate(-1)}T00:00:00Z`), status: "DONE" } });

    for (let i = 0; i < 3; i++) {
      await runTimeSweep();
      await drainQueue();
    }
    const p = async (id: number) => (await prisma.task.findUniqueOrThrow({ where: { id } })).priority;
    expect(await p(dueIn2.id)).toBe("HIGH");
    expect(await p(dueIn3.id)).toBe("LOW");
    expect(await p(overdue.id)).toBe("CRITICAL");
    expect(await p(done.id)).toBe("LOW");
    expect((await runs(soon.id)).map((r) => [r.taskId, r.status])).toEqual([[dueIn2.id, "SUCCEEDED"]]);
    expect((await runs(late.id)).map((r) => [r.taskId, r.status])).toEqual([[overdue.id, "SUCCEEDED"]]);

    // A new due date is a new event
    await prisma.task.update({ where: { id: dueIn3.id }, data: { dueDate: new Date(`${isoDate(2)}T00:00:00Z`) } });
    await runTimeSweep();
    await drainQueue();
    expect(await p(dueIn3.id)).toBe("HIGH");
  });
});

describe("Failures", () => {
  it("a rule that keeps failing switches itself off and tells its creator; switching it on resets it", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { name: "Hand to Sam", trigger: "COMMENT_ADDED", actions: [{ type: "ASSIGN", to: member.userId }] });
    const t = await task(admin, { title: "x" });
    // The person leaves the organization after the rule was saved: re-checked at run time
    await request(app).delete(`/orgs/current/members/${member.userId}`).set(admin.auth).expect(200);

    for (let i = 0; i < FAILURE_LIMIT + 1; i++) {
      await request(app).post(`/tasks/${t.id}/comments`).set(admin.auth).send({ body: `try ${i}` }).expect(201);
      await drainQueue();
    }
    const log = await runs(r.id);
    expect(log).toHaveLength(FAILURE_LIMIT); // the sixth comment found the rule switched off
    expect(log.every((x) => x.status === "FAILED")).toBe(true);
    const rr = await prisma.automationRule.findUniqueOrThrow({ where: { id: r.id } });
    expect(rr).toMatchObject({ enabled: false, failureStreak: FAILURE_LIMIT });
    expect(rr.disabledReason).toMatch(/failed 5 times/);
    const n = await prisma.notification.findMany({ where: { userId: admin.userId, type: "AUTOMATION" } });
    expect(n).toHaveLength(1);
    expect(JSON.stringify(n[0].data)).toMatch(/switched off/);

    // Re-enabling is refused while the reference is still broken
    expect((await request(app).patch(`/automations/${r.id}`).set(admin.auth).send({ enabled: true })).status).toBe(400);
    const fixed = await request(app).patch(`/automations/${r.id}`).set(admin.auth).send({ enabled: true, actions: [{ type: "ASSIGN", to: "creator" }] }).expect(200);
    expect(fixed.body).toMatchObject({ enabled: true, disabledReason: null, failureStreak: 0 });
  });
});

describe("Run log and dry run", () => {
  it("lists runs newest first with counts, filters by status, and dry-runs without changing anything", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "TASK_CREATED", conditions: [{ field: "priority", op: "is", value: ["HIGH"] }], actions: [{ type: "SET_STATUS", status: "IN_PROGRESS" }] });
    const hi = await task(admin, { title: "hi", priority: "HIGH" });
    await task(admin, { title: "lo", priority: "LOW" });

    const log = (await request(app).get(`/automations/${r.id}/runs`).set(admin.auth).expect(200)).body;
    expect(log.counts).toEqual({ SUCCEEDED: 1, SKIPPED: 1 });
    expect(log.runs[0]).toMatchObject({ status: "SKIPPED", task: { title: "lo" } });
    expect(log.runs[1]).toMatchObject({ status: "SUCCEEDED", task: { id: hi.id }, detail: { actions: ["Set status to In progress"] } });
    const failedOnly = (await request(app).get(`/automations/${r.id}/runs?status=FAILED`).set(admin.auth).expect(200)).body;
    expect(failedOnly.runs).toEqual([]);
    expect((await request(app).get(`/automations/${r.id}/runs?limit=999`).set(admin.auth)).status).toBe(400);

    const lo = await task(admin, { title: "another", priority: "LOW" });
    const before = await prisma.automationRun.count();
    const dry = (await request(app).post(`/automations/${r.id}/test`).set(admin.auth).send({ taskId: lo.id }).expect(200)).body;
    expect(dry).toMatchObject({ wouldRun: false, conditions: [{ holds: false }], actions: ["Set status to In progress"], problems: [] });
    expect(await prisma.automationRun.count()).toBe(before);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: lo.id } })).status).toBe("TODO");

    const elsewhere = (await request(app).post("/projects").set(admin.auth).send({ name: "Other" })).body;
    const far = await task(admin, { title: "far", projectId: elsewhere.id });
    expect((await request(app).post(`/automations/${r.id}/test`).set(admin.auth).send({ taskId: far.id })).status).toBe(400);
  });

  it("deleting a rule removes its runs", async () => {
    const admin = await signUp();
    const pid = await defaultProject(admin);
    const r = await mustRule(admin, pid, { trigger: "TASK_CREATED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] });
    await task(admin, { title: "x" });
    expect(await prisma.automationRun.count()).toBe(1);
    await request(app).delete(`/automations/${r.id}`).set(admin.auth).expect(200);
    expect(await prisma.automationRun.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "automation.deleted" } })).toBe(1);
  });
});
