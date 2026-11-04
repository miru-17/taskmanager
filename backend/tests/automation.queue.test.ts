import request from "supertest";
import { randomUUID } from "node:crypto";
import { app, prisma, resetDb, signUp } from "./helpers";
import { enqueue, queueMode, startQueue, stopQueue } from "../src/core/queue";
import { stopEvents } from "../src/core/events";
import { AUTOMATION_JOB } from "../src/modules/automation/emit";
import { AUTOMATION_SWEEP_JOB } from "../src/modules/automation";

/** The same flows through the real pg-boss worker, as in production. */
jest.setTimeout(60_000);

const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
};

beforeAll(async () => {
  await resetDb();
  await startQueue([{ name: AUTOMATION_SWEEP_JOB, cron: "7 * * * *" }]);
});
afterAll(async () => {
  await stopQueue();
  await stopEvents();
});

it("runs rules on the pg-boss worker, stops loops, and ignores duplicate deliveries", async () => {
  expect(queueMode()).toBe("pg-boss");
  const admin = await signUp();
  const seed = (await request(app).post("/tasks").set(admin.auth).send({ title: "seed" }).expect(201)).body;
  const pid = seed.projectId as string;
  const mk = (body: Record<string, unknown>) => request(app).post(`/projects/${pid}/automations`).set(admin.auth).send({ name: "R", ...body }).expect(201);
  const a = (await mk({ trigger: "STATUS_CHANGED", triggerConfig: { to: "IN_PROGRESS" }, actions: [{ type: "SET_STATUS", status: "IN_REVIEW" }] })).body;
  const b = (await mk({ trigger: "STATUS_CHANGED", triggerConfig: { to: "IN_REVIEW" }, actions: [{ type: "SET_STATUS", status: "IN_PROGRESS" }] })).body;
  const c = (await mk({ trigger: "COMMENT_ADDED", actions: [{ type: "ADD_COMMENT", body: "ack" }] })).body;

  await request(app).patch(`/tasks/${seed.id}`).set(admin.auth).send({ status: "IN_PROGRESS" }).expect(200);
  const loop = await until(
    () => prisma.automationRun.findMany({ where: { ruleId: { in: [a.id, b.id] } }, orderBy: { depth: "asc" } }),
    (r) => r.length >= 3
  );
  expect(loop.map((r) => [r.ruleId, r.status])).toEqual([
    [a.id, "SUCCEEDED"],
    [b.id, "SUCCEEDED"],
    [a.id, "LOOP_BLOCKED"],
  ]);

  // The same event sent to the queue three times (e.g. a retry after a crash) runs once
  const event = { eventId: randomUUID(), orgId: admin.orgId, projectId: pid, taskId: seed.id, trigger: "COMMENT_ADDED", actorId: admin.userId, depth: 0, chain: [] };
  await Promise.all([enqueue(AUTOMATION_JOB, event), enqueue(AUTOMATION_JOB, event), enqueue(AUTOMATION_JOB, event)]);
  await until(() => prisma.automationRun.count({ where: { ruleId: c.id } }), (n) => n >= 1);
  await new Promise((r) => setTimeout(r, 2_000)); // give the other two deliveries time to (not) run
  expect(await prisma.automationRun.count({ where: { ruleId: c.id } })).toBe(1);
  expect(await prisma.taskComment.count({ where: { taskId: seed.id, automationName: "R" } })).toBe(1);

  // Nothing is left failing in the queue
  const failed = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pgboss.job WHERE state = 'failed'`;
  expect(Number(failed[0].n)).toBe(0);
  const sched = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM pgboss.schedule`;
  expect(sched.map((s) => s.name)).toContain(AUTOMATION_SWEEP_JOB);
});
