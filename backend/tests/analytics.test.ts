import request from "supertest";
import { addMember, app, prisma, resetDb, signUp, type TestUser } from "./helpers";
import { csvCell } from "../src/modules/analytics/analytics.service";

beforeEach(resetDb);
jest.setTimeout(30_000);

const DAY = 86_400_000;

/** Deterministic pseudo-random numbers so failures are reproducible. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const localDay = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/**
 * Builds a realistic org: two projects, three people, ~120 tasks spread over 80 days with
 * timestamps written directly (the API sets "now" on create), some deleted, some archived.
 */
const seed = async () => {
  const admin = await signUp();
  const ann = await addMember(admin, "MEMBER");
  const bob = await addMember(admin, "MEMBER");
  const web = (await request(app).post("/projects").set(admin.auth).send({ name: "Web", key: "WEB" })).body;
  const ops = (await request(app).post("/projects").set(admin.auth).send({ name: "Ops", key: "OPS", visibility: "PRIVATE" })).body;
  const people = [null, ann.userId, bob.userId, admin.userId];
  const rand = rng(42);
  const now = Date.now();

  const counters: Record<string, number> = { [web.id]: 0, [ops.id]: 0 };
  const data = [];
  for (let i = 0; i < 120; i++) {
    const project = i % 3 === 0 ? ops : web;
    const created = new Date(now - Math.floor(rand() * 80 * DAY) - Math.floor(rand() * DAY));
    const status = STATUSES[Math.floor(rand() * 4)];
    const completedAt = status === "DONE" ? new Date(Math.min(now - 60_000, created.getTime() + Math.floor(rand() * 20 * DAY))) : null;
    const hasDue = rand() < 0.7;
    const due = hasDue ? new Date(`${utcDay(new Date(created.getTime() + Math.floor((rand() * 30 - 5) * DAY)))}T00:00:00.000Z`) : null;
    const estimate = rand() < 0.6 ? Math.round(rand() * 16 * 2) / 2 : null;
    data.push({
      organizationId: admin.orgId!,
      projectId: project.id,
      number: ++counters[project.id],
      title: `T${i}`,
      createdAt: created,
      status,
      completedAt,
      dueDate: due,
      priority: PRIORITIES[Math.floor(rand() * 4)],
      assigneeId: people[Math.floor(rand() * people.length)],
      estimateHours: estimate,
      actualHours: estimate !== null && rand() < 0.7 ? Math.round(rand() * 20 * 2) / 2 : null,
      archivedAt: rand() < 0.05 ? new Date() : null,
      deletedAt: rand() < 0.05 ? new Date() : null,
    });
  }
  // Timestamps must be in the past, so rows are written directly rather than through the API
  await prisma.task.createMany({ data });
  await prisma.project.update({ where: { id: web.id }, data: { taskCounter: counters[web.id] } });
  await prisma.project.update({ where: { id: ops.id }, data: { taskCounter: counters[ops.id] } });
  return { admin, ann, bob, web, ops };
};

type Row = Awaited<ReturnType<typeof rawTasks>>[number];
const rawTasks = (orgId: string, projectIds?: string[]) =>
  prisma.task.findMany({ where: { organizationId: orgId, deletedAt: null, ...(projectIds ? { projectId: { in: projectIds } } : {}) } });

/** The same numbers, computed in plain JavaScript from raw rows. */
const expectSummary = (rows: Row[], from: string, to: string, tz: string) => {
  const today = localDay(new Date(), tz);
  const inRange = (d: Date | null) => !!d && localDay(d, tz) >= from && localDay(d, tz) <= to;
  const live = rows.filter((t) => !t.archivedAt);
  const open = live.filter((t) => t.status !== "DONE");
  const done = rows.filter((t) => t.status === "DONE" && inRange(t.completedAt));
  const withDue = done.filter((t) => t.dueDate);
  const cycles = done.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / DAY).sort((a, b) => a - b);
  const median = cycles.length ? (cycles.length % 2 ? cycles[(cycles.length - 1) / 2] : (cycles[cycles.length / 2 - 1] + cycles[cycles.length / 2]) / 2) : null;
  const hours = done.filter((t) => t.estimateHours !== null && t.actualHours !== null);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    open: open.length,
    overdue: open.filter((t) => t.dueDate && utcDay(t.dueDate) < today).length,
    created: rows.filter((t) => inRange(t.createdAt)).length,
    completed: done.length,
    cycleTime: { averageDays: cycles.length ? r1(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null, medianDays: median === null ? null : r1(median), sample: cycles.length },
    onTime: {
      rate: withDue.length ? Math.round((withDue.filter((t) => localDay(t.completedAt!, tz) <= utcDay(t.dueDate!)).length / withDue.length) * 1000) / 1000 : null,
      onTime: withDue.filter((t) => localDay(t.completedAt!, tz) <= utcDay(t.dueDate!)).length,
      withDueDate: withDue.length,
    },
    hours: { estimated: r1(hours.reduce((a, t) => a + t.estimateHours!, 0)), actual: r1(hours.reduce((a, t) => a + t.actualHours!, 0)), sample: hours.length },
    byStatus: STATUSES.map((key) => ({ key, count: live.filter((t) => t.status === key).length })),
    byPriority: PRIORITIES.map((key) => ({ key, count: open.filter((t) => t.priority === key).length })),
  };
};

const get = (u: TestUser, path: string, q: Record<string, string> = {}) => request(app).get(path).query(q).set(u.auth);

describe("Analytics numbers reconcile with raw records", () => {
  it.each(["UTC", "Asia/Kolkata", "America/Los_Angeles"])("summary, in %s", async (tz) => {
    const { admin } = await seed();
    const to = localDay(new Date(), tz);
    const from = addDays(to, -29);
    const res = await get(admin, "/analytics/summary", { from, to, tz }).expect(200);
    const expected = expectSummary(await rawTasks(admin.orgId!), from, to, tz);
    expect(res.body).toMatchObject(expected);
    expect(res.body.completed).toBeGreaterThan(0); // the seed actually exercises the numbers
  });

  it("trend: buckets add up to the totals, and running totals match raw counts each day", async () => {
    const { admin } = await seed();
    const tz = "Asia/Kolkata";
    const to = localDay(new Date(), tz);
    const from = addDays(to, -29);
    const [trend, summary] = await Promise.all([get(admin, "/analytics/trend", { from, to, tz }).expect(200), get(admin, "/analytics/summary", { from, to, tz }).expect(200)]);
    const rows = await rawTasks(admin.orgId!);

    expect(trend.body.bucket).toBe("day");
    expect(trend.body.points).toHaveLength(30);
    const sum = (k: "created" | "completed") => trend.body.points.reduce((a: number, p: Record<string, number>) => a + p[k], 0);
    expect(sum("created")).toBe(summary.body.created);
    expect(sum("completed")).toBe(summary.body.completed);

    for (const p of trend.body.points as { start: string; scope: number; done: number; remaining: number }[]) {
      expect(p.scope).toBe(rows.filter((t) => localDay(t.createdAt, tz) <= p.start).length);
      expect(p.done).toBe(rows.filter((t) => t.status === "DONE" && t.completedAt && localDay(t.completedAt, tz) <= p.start).length);
      expect(p.remaining).toBe(p.scope - p.done);
    }
  });

  it("trend: long ranges switch to ISO weeks that still add up", async () => {
    const { admin } = await seed();
    const to = utcDay(new Date());
    const from = addDays(to, -89);
    const [trend, summary] = await Promise.all([get(admin, "/analytics/trend", { from, to }).expect(200), get(admin, "/analytics/summary", { from, to }).expect(200)]);
    expect(trend.body.bucket).toBe("week");
    for (const p of trend.body.points) expect(new Date(`${p.start}T00:00:00Z`).getUTCDay()).toBe(1); // Mondays
    expect(trend.body.points.reduce((a: number, p: { completed: number }) => a + p.completed, 0)).toBe(summary.body.completed);
    expect(trend.body.points.reduce((a: number, p: { created: number }) => a + p.created, 0)).toBe(summary.body.created);
  });

  it("workload per person", async () => {
    const { admin, ann } = await seed();
    const to = utcDay(new Date());
    const from = addDays(to, -29);
    const res = await get(admin, "/analytics/workload", { from, to }).expect(200);
    const rows = await rawTasks(admin.orgId!);
    const open = rows.filter((t) => t.status !== "DONE" && !t.archivedAt);
    for (const uid of [null, ann.userId]) {
      const mine = open.filter((t) => t.assigneeId === uid);
      const p = res.body.people.find((x: { user: { id: number } | null }) => (x.user?.id ?? null) === uid);
      expect(p).toMatchObject({
        open: mine.length,
        overdue: mine.filter((t) => t.dueDate && utcDay(t.dueDate) < to).length,
        dueSoon: mine.filter((t) => t.dueDate && utcDay(t.dueDate) >= to && utcDay(t.dueDate) <= addDays(to, 6)).length,
        openHours: Math.round(mine.reduce((a, t) => a + (t.estimateHours ?? 0), 0) * 10) / 10,
        unestimated: mine.filter((t) => t.estimateHours === null).length,
        completed: rows.filter((t) => t.assigneeId === uid && t.status === "DONE" && t.completedAt && utcDay(t.completedAt) >= from && utcDay(t.completedAt) <= to).length,
      });
    }
    expect(res.body.people.reduce((a: number, p: { open: number }) => a + p.open, 0)).toBe(open.length);
  });

  it("per project, and the filters narrow every number", async () => {
    const { admin, ann, web } = await seed();
    const to = utcDay(new Date());
    const from = addDays(to, -29);
    const projects = (await get(admin, "/analytics/projects", { from, to }).expect(200)).body.projects;
    const rows = await rawTasks(admin.orgId!, [web.id]);
    const webRow = projects.find((p: { key: string }) => p.key === "WEB");
    expect(webRow.stats).toMatchObject({ total: rows.filter((t) => !t.archivedAt).length, done: rows.filter((t) => !t.archivedAt && t.status === "DONE").length });

    const narrowed = await get(admin, "/analytics/summary", { from, to, projectId: web.id, assigneeId: String(ann.userId) }).expect(200);
    expect(narrowed.body).toMatchObject(expectSummary(rows.filter((t) => t.assigneeId === ann.userId), from, to, "UTC"));
    const unassigned = await get(admin, "/analytics/summary", { from, to, projectId: web.id, assigneeId: "none" }).expect(200);
    expect(unassigned.body).toMatchObject(expectSummary(rows.filter((t) => t.assigneeId === null), from, to, "UTC"));
  });

  it("counts a task finished on its due date as on time, and the day after as late", async () => {
    const admin = await signUp();
    const day = addDays(utcDay(new Date()), -5);
    const make = async (title: string, completedOn: string) => {
      const t = (await request(app).post("/tasks").set(admin.auth).send({ title }).expect(201)).body;
      await prisma.task.update({
        where: { id: t.id },
        data: { status: "DONE", dueDate: new Date(`${day}T00:00:00Z`), createdAt: new Date(`${addDays(day, -3)}T09:00:00Z`), completedAt: new Date(`${completedOn}T23:30:00Z`) },
      });
    };
    await make("on the day", day);
    await make("a day late", addDays(day, 1));
    const res = await get(admin, "/analytics/summary", { from: addDays(day, -1), to: addDays(day, 2) }).expect(200);
    expect(res.body.onTime).toEqual({ rate: 0.5, onTime: 1, withDueDate: 2 });
  });

  it("puts a completion in the viewer's day: 20:00 UTC is already tomorrow in India", async () => {
    const admin = await signUp();
    const t = (await request(app).post("/tasks").set(admin.auth).send({ title: "late night" }).expect(201)).body;
    const day = addDays(utcDay(new Date()), -3);
    await prisma.task.update({ where: { id: t.id }, data: { status: "DONE", completedAt: new Date(`${day}T20:00:00Z`), createdAt: new Date(`${day}T10:00:00Z`) } });
    const q = (tz: string, d: string) => get(admin, "/analytics/summary", { from: d, to: d, tz }).expect(200);
    expect((await q("UTC", day)).body.completed).toBe(1);
    expect((await q("Asia/Kolkata", day)).body.completed).toBe(0);
    expect((await q("Asia/Kolkata", addDays(day, 1))).body.completed).toBe(1);
  });
});

describe("Analytics access", () => {
  it("only counts projects the caller can see, and never another organization", async () => {
    const { admin, ann, ops } = await seed();
    const other = await signUp();
    await request(app).post("/tasks").set(other.auth).send({ title: "theirs" }).expect(201);
    const to = utcDay(new Date());
    const from = addDays(to, -29);

    const visibleToAnn = (await prisma.project.findMany({ where: { organizationId: admin.orgId!, visibility: "ORGANIZATION" } })).map((p) => p.id);
    const res = await get(ann, "/analytics/summary", { from, to }).expect(200);
    expect(res.body).toMatchObject(expectSummary(await rawTasks(admin.orgId!, visibleToAnn), from, to, "UTC"));
    expect((await get(ann, "/analytics/projects", { from, to })).body.projects.map((p: { key: string }) => p.key)).not.toContain("OPS");
    expect((await get(ann, "/analytics/summary", { projectId: ops.id })).status).toBe(400);

    const csv = (await get(ann, "/analytics/export.csv", { from, to }).expect(200)).text;
    expect(csv).not.toContain("OPS-");
    expect((await get(other, "/analytics/summary")).body.created).toBe(1);
  });

  it("clients have no analytics; viewers can read", async () => {
    const admin = await signUp();
    const client = await addMember(admin, "CLIENT");
    const viewer = await addMember(admin, "VIEWER");
    expect((await get(client, "/analytics/summary")).status).toBe(403);
    expect((await get(client, "/analytics/export.csv")).status).toBe(403);
    expect((await get(viewer, "/analytics/summary")).status).toBe(200);
  });

  it("validates the range and time zone", async () => {
    const admin = await signUp();
    expect((await get(admin, "/analytics/summary", { tz: "Mars/Olympus" })).status).toBe(400);
    expect((await get(admin, "/analytics/summary", { tz: "'; DROP TABLE \"Task\";--" })).status).toBe(400);
    expect((await get(admin, "/analytics/summary", { from: "2026-01-01", to: "2027-06-01" })).status).toBe(400);
    expect((await get(admin, "/analytics/summary", { from: "2026-05-02", to: "2026-05-01" })).status).toBe(400);
    expect((await get(admin, "/analytics/summary", { from: "yesterday" })).status).toBe(400);
  });
});

describe("CSV export", () => {
  it("exports every visible task, safe for spreadsheets", async () => {
    const admin = await signUp();
    await request(app).post("/tasks").set(admin.auth).send({ title: '=HYPERLINK("http://evil","click")' }).expect(201);
    await request(app).post("/tasks").set(admin.auth).send({ title: 'He said "ship it", then left' }).expect(201);
    await request(app).post("/tasks").set(admin.auth).send({ title: "@SUM(1+1)" }).expect(201);
    const res = await get(admin, "/analytics/export.csv").expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="taskforge-tasks-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(res.text).toContain(`"He said ""ship it"", then left"`);
    expect(res.text).toContain(`"'@SUM(1+1)"`);
    expect(await prisma.auditLog.count({ where: { action: "analytics.exported" } })).toBe(1);
  });

  it("neutralises every formula prefix", () => {
    for (const s of ["=1+1", "+1", "-1", "@x", "\tx", "\rx"]) expect(csvCell(s).startsWith(`"'`)).toBe(true);
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell(null)).toBe('""');
  });

  it("exports workload that matches the workload endpoint", async () => {
    const { admin } = await seed();
    const [json, csv] = await Promise.all([get(admin, "/analytics/workload").expect(200), get(admin, "/analytics/export.csv", { dataset: "workload" }).expect(200)]);
    const lines = csv.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(json.body.people.length + 1);
  });
});
