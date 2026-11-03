import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../core/prisma";
import { badRequest } from "../../core/errors";
import { cuidSchema } from "../../core/schemas";
import { projectAccessWhere, type Actor } from "../../core/access";
import { computeHealth, type ProjectStats } from "../projects/projects.service";

/**
 * Every number here is a SQL aggregate over the caller's visible tasks (deleted tasks excluded).
 * Days are calendar days in the viewer's time zone, so "completed today" means *their* today.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 366;

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const scopeFields = z.object({
  projectId: cuidSchema.optional(),
  assigneeId: z.union([z.literal("none"), z.coerce.number().int().positive().max(2_147_483_647)]).optional(),
  from: z.string().regex(DATE, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(DATE, "to must be YYYY-MM-DD").optional(),
  tz: z.string().max(64).refine(isTimeZone, "Unknown time zone").default("UTC"),
});

/** Fills default dates (last 30 days, in the viewer's zone) and bounds the span. */
const resolveRange = <T extends z.infer<typeof scopeFields>>(q: T, ctx: z.RefinementCtx) => {
  const todayIn = new Intl.DateTimeFormat("en-CA", { timeZone: q.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const to = q.to ?? todayIn;
  const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (Number.isNaN(span) || span < 0) {
    ctx.addIssue({ code: "custom", message: "from must be on or before to" });
    return z.NEVER;
  }
  if (span >= MAX_SPAN_DAYS) {
    ctx.addIssue({ code: "custom", message: `The range can be at most ${MAX_SPAN_DAYS} days` });
    return z.NEVER;
  }
  return { ...q, from, to, today: todayIn, days: span + 1 };
};

export const scopeQuery = scopeFields.transform(resolveRange);
export const exportQuery = scopeFields.extend({ dataset: z.enum(["tasks", "workload"]).default("tasks") }).transform(resolveRange);
export type Scope = z.infer<typeof scopeQuery>;

/** Projects in scope: visible to the caller, optionally narrowed to one. */
const projectsInScope = async (actor: Actor, scope: Scope) => {
  const projects = await prisma.project.findMany({
    where: { ...projectAccessWhere(actor), ...(scope.projectId ? { id: scope.projectId } : {}) },
    select: { id: true, key: true, name: true, color: true, status: true, startDate: true, dueDate: true },
  });
  if (scope.projectId && !projects.length) throw badRequest("Project not found");
  return projects;
};

/** Shared WHERE for task aggregates. Project ids come from the access check above, never from input alone. */
const taskFilter = (actor: Actor, projectIds: string[], scope: Scope) => {
  const parts = [
    Prisma.sql`t."organizationId" = ${actor.tenant.organizationId}`,
    Prisma.sql`t."projectId" = ANY(${projectIds}::text[])`,
    Prisma.sql`t."deletedAt" IS NULL`,
  ];
  if (scope.assigneeId === "none") parts.push(Prisma.sql`t."assigneeId" IS NULL`);
  else if (scope.assigneeId) parts.push(Prisma.sql`t."assigneeId" = ${scope.assigneeId}`);
  return Prisma.join(parts, " AND ");
};

/** A stored UTC timestamp as a calendar date in the viewer's zone. */
const localDate = (column: Prisma.Sql, tz: string) => Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;
const col = (name: string) => Prisma.raw(`t."${name}"`);

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// ─── Summary ─────────────────────────────────────────────────────────────────

export const summary = async (actor: Actor, scope: Scope) => {
  const projects = await projectsInScope(actor, scope);
  const ids = projects.map((p) => p.id);
  const empty = { open: 0, overdue: 0, created: 0, completed: 0, cycleTime: { averageDays: null, medianDays: null, sample: 0 }, onTime: { rate: null, onTime: 0, withDueDate: 0 }, hours: { estimated: 0, actual: 0, sample: 0 }, byStatus: [], byPriority: [] };
  if (!ids.length) return { range: rangeOf(scope), ...empty };

  const where = taskFilter(actor, ids, scope);
  const created = localDate(col("createdAt"), scope.tz);
  const completed = localDate(col("completedAt"), scope.tz);
  const today = Prisma.sql`${scope.today}::date`;
  const from = Prisma.sql`${scope.from}::date`;
  const to = Prisma.sql`${scope.to}::date`;

  const [row] = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      COUNT(*) FILTER (WHERE t.status <> 'DONE' AND t."archivedAt" IS NULL) AS open,
      COUNT(*) FILTER (WHERE t.status <> 'DONE' AND t."archivedAt" IS NULL AND t."dueDate" IS NOT NULL AND t."dueDate"::date < ${today}) AS overdue,
      COUNT(*) FILTER (WHERE ${created} BETWEEN ${from} AND ${to}) AS created,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${from} AND ${to}) AS completed,
      AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."createdAt")) / 86400) FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${from} AND ${to}) AS cycle_avg,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t."completedAt" - t."createdAt")) / 86400)
        FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${from} AND ${to}) AS cycle_median,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${from} AND ${to} AND t."dueDate" IS NOT NULL) AS with_due,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${from} AND ${to} AND t."dueDate" IS NOT NULL AND ${completed} <= t."dueDate"::date) AS on_time,
      COALESCE(SUM(t."estimateHours") FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${from} AND ${to} AND t."estimateHours" IS NOT NULL AND t."actualHours" IS NOT NULL), 0) AS est_hours,
      COALESCE(SUM(t."actualHours") FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${from} AND ${to} AND t."estimateHours" IS NOT NULL AND t."actualHours" IS NOT NULL), 0) AS act_hours,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${from} AND ${to} AND t."estimateHours" IS NOT NULL AND t."actualHours" IS NOT NULL) AS hours_sample
    FROM "Task" t WHERE ${where}`;

  const [byStatus, byPriority] = await Promise.all([
    prisma.$queryRaw<{ key: string; count: bigint }[]>`SELECT t.status::text AS key, COUNT(*) AS count FROM "Task" t WHERE ${where} AND t."archivedAt" IS NULL GROUP BY 1`,
    prisma.$queryRaw<{ key: string; count: bigint }[]>`SELECT t.priority::text AS key, COUNT(*) AS count FROM "Task" t WHERE ${where} AND t."archivedAt" IS NULL AND t.status <> 'DONE' GROUP BY 1`,
  ]);
  const ordered = (rows: { key: string; count: bigint }[], keys: string[]) => keys.map((key) => ({ key, count: n(rows.find((r) => r.key === key)?.count) }));
  const withDue = n(row.with_due);
  const sample = n(row.completed);
  return {
    range: rangeOf(scope),
    open: n(row.open),
    overdue: n(row.overdue),
    created: n(row.created),
    completed: n(row.completed),
    cycleTime: { averageDays: sample ? round(n(row.cycle_avg)) : null, medianDays: sample ? round(n(row.cycle_median)) : null, sample },
    onTime: { rate: withDue ? round(n(row.on_time) / withDue, 3) : null, onTime: n(row.on_time), withDueDate: withDue },
    hours: { estimated: round(n(row.est_hours)), actual: round(n(row.act_hours)), sample: n(row.hours_sample) },
    byStatus: ordered(byStatus, ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]),
    byPriority: ordered(byPriority, ["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  };
};

const rangeOf = (s: Scope) => ({ from: s.from, to: s.to, tz: s.tz, days: s.days });

// ─── Trend (throughput + burn-up) ────────────────────────────────────────────

/**
 * Created and completed per bucket (day for ranges up to 62 days, else ISO week), plus the
 * running scope (all tasks created so far) and done (completed so far) for a burn-up chart.
 * Reconstructed from timestamps: a task reopened later no longer counts as completed, and
 * deleted tasks drop out of history entirely.
 */
export const trend = async (actor: Actor, scope: Scope) => {
  const projects = await projectsInScope(actor, scope);
  const ids = projects.map((p) => p.id);
  const bucket = scope.days > 62 ? "week" : "day";
  if (!ids.length) return { range: rangeOf(scope), bucket, points: [] };

  const where = taskFilter(actor, ids, scope);
  const created = localDate(col("createdAt"), scope.tz);
  const completed = localDate(col("completedAt"), scope.tz);
  const unit = Prisma.raw(`'${bucket}'`);
  const step = Prisma.raw(bucket === "week" ? "interval '1 week'" : "interval '1 day'");

  const rows = await prisma.$queryRaw<{ bucket: Date; created: bigint; completed: bigint; scope_total: bigint; done_total: bigint }[]>`
    WITH buckets AS (
      SELECT generate_series(date_trunc(${unit}, ${scope.from}::date), date_trunc(${unit}, ${scope.to}::date), ${step})::date AS start
    ),
    tasks AS (
      SELECT ${created} AS created_on, CASE WHEN t.status = 'DONE' THEN ${completed} END AS completed_on
      FROM "Task" t WHERE ${where}
    )
    SELECT
      b.start AS bucket,
      (SELECT COUNT(*) FROM tasks WHERE date_trunc(${unit}, created_on)::date = b.start AND created_on BETWEEN ${scope.from}::date AND ${scope.to}::date) AS created,
      (SELECT COUNT(*) FROM tasks WHERE date_trunc(${unit}, completed_on)::date = b.start AND completed_on BETWEEN ${scope.from}::date AND ${scope.to}::date) AS completed,
      (SELECT COUNT(*) FROM tasks WHERE created_on <= LEAST(b.start + ${step} - interval '1 day', ${scope.to}::date)) AS scope_total,
      (SELECT COUNT(*) FROM tasks WHERE completed_on <= LEAST(b.start + ${step} - interval '1 day', ${scope.to}::date)) AS done_total
    FROM buckets b ORDER BY b.start`;

  return {
    range: rangeOf(scope),
    bucket,
    points: rows.map((r) => ({
      start: r.bucket.toISOString().slice(0, 10),
      created: n(r.created),
      completed: n(r.completed),
      scope: n(r.scope_total),
      done: n(r.done_total),
      remaining: n(r.scope_total) - n(r.done_total),
    })),
  };
};

// ─── Workload ────────────────────────────────────────────────────────────────

/** Open work per person (and "Unassigned"), plus what each finished in the range. */
export const workload = async (actor: Actor, scope: Scope) => {
  const projects = await projectsInScope(actor, scope);
  const ids = projects.map((p) => p.id);
  if (!ids.length) return { range: rangeOf(scope), people: [] };
  const where = taskFilter(actor, ids, scope);
  const completed = localDate(col("completedAt"), scope.tz);
  const today = Prisma.sql`${scope.today}::date`;

  const rows = await prisma.$queryRaw<
    { assignee_id: number | null; name: string | null; email: string | null; open: bigint; overdue: bigint; due_soon: bigint; open_hours: number | null; unestimated: bigint; completed: bigint }[]
  >`
    SELECT t."assigneeId" AS assignee_id, u.name, u.email,
      COUNT(*) FILTER (WHERE t.status <> 'DONE' AND t."archivedAt" IS NULL) AS open,
      COUNT(*) FILTER (WHERE t.status <> 'DONE' AND t."archivedAt" IS NULL AND t."dueDate"::date < ${today}) AS overdue,
      COUNT(*) FILTER (WHERE t.status <> 'DONE' AND t."archivedAt" IS NULL AND t."dueDate"::date BETWEEN ${today} AND ${today} + 6) AS due_soon,
      SUM(t."estimateHours") FILTER (WHERE t.status <> 'DONE' AND t."archivedAt" IS NULL) AS open_hours,
      COUNT(*) FILTER (WHERE t.status <> 'DONE' AND t."archivedAt" IS NULL AND t."estimateHours" IS NULL) AS unestimated,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${scope.from}::date AND ${scope.to}::date) AS completed
    FROM "Task" t LEFT JOIN "User" u ON u.id = t."assigneeId"
    WHERE ${where}
    GROUP BY t."assigneeId", u.name, u.email`;

  return {
    range: rangeOf(scope),
    people: rows
      .map((r) => ({
        user: r.assignee_id === null ? null : { id: r.assignee_id, name: r.name, email: r.email ?? "" },
        open: n(r.open),
        overdue: n(r.overdue),
        dueSoon: n(r.due_soon),
        openHours: round(n(r.open_hours)),
        unestimated: n(r.unestimated),
        completed: n(r.completed),
      }))
      .filter((p) => p.open > 0 || p.completed > 0)
      .sort((a, b) => b.open - a.open || b.completed - a.completed),
  };
};

// ─── Per project ─────────────────────────────────────────────────────────────

export const byProject = async (actor: Actor, scope: Scope) => {
  const projects = await projectsInScope(actor, scope);
  const ids = projects.map((p) => p.id);
  if (!ids.length) return { range: rangeOf(scope), projects: [] };
  const where = taskFilter(actor, ids, scope);
  const completed = localDate(col("completedAt"), scope.tz);
  const today = Prisma.sql`${scope.today}::date`;
  const rows = await prisma.$queryRaw<{ project_id: string; total: bigint; done: bigint; overdue: bigint; completed: bigint }[]>`
    SELECT t."projectId" AS project_id,
      COUNT(*) FILTER (WHERE t."archivedAt" IS NULL) AS total,
      COUNT(*) FILTER (WHERE t."archivedAt" IS NULL AND t.status = 'DONE') AS done,
      COUNT(*) FILTER (WHERE t."archivedAt" IS NULL AND t.status <> 'DONE' AND t."dueDate"::date < ${today}) AS overdue,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND ${completed} BETWEEN ${scope.from}::date AND ${scope.to}::date) AS completed
    FROM "Task" t WHERE ${where} GROUP BY 1`;
  return {
    range: rangeOf(scope),
    projects: projects
      .map((p) => {
        const r = rows.find((x) => x.project_id === p.id);
        const stats: ProjectStats = { total: n(r?.total), done: n(r?.done), open: n(r?.total) - n(r?.done), overdue: n(r?.overdue), progress: n(r?.total) ? round(n(r?.done) / n(r?.total), 3) : 0 };
        return { id: p.id, key: p.key, name: p.name, color: p.color, status: p.status, stats, completedInRange: n(r?.completed), health: computeHealth(p, stats) };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

// ─── CSV export ──────────────────────────────────────────────────────────────

/**
 * Spreadsheet-safe cell: quoted, and any value starting with = + - @ (or a tab/CR) is prefixed
 * with ' so Excel/Sheets show it as text instead of running it as a formula (CSV injection).
 */
export const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");

export const EXPORT_LIMIT = 10_000;

/** Tasks in scope (created or still open in the range), one row each. */
export const exportTasks = async (actor: Actor, scope: Scope) => {
  const projects = await projectsInScope(actor, scope);
  const ids = projects.map((p) => p.id);
  const header = ["Key", "Title", "Project", "Status", "Priority", "Assignee", "Created", "Start", "Due", "Completed", "Estimate (h)", "Actual (h)", "Labels", "Archived"];
  if (!ids.length) return { rows: [csvRow(header)], truncated: false };
  const tasks = await prisma.task.findMany({
    where: {
      organizationId: actor.tenant.organizationId,
      projectId: { in: ids },
      deletedAt: null,
      ...(scope.assigneeId === "none" ? { assigneeId: null } : scope.assigneeId ? { assigneeId: scope.assigneeId } : {}),
    },
    orderBy: [{ projectId: "asc" }, { number: "asc" }],
    take: EXPORT_LIMIT + 1,
    select: {
      number: true,
      title: true,
      status: true,
      priority: true,
      createdAt: true,
      startDate: true,
      dueDate: true,
      completedAt: true,
      estimateHours: true,
      actualHours: true,
      archivedAt: true,
      project: { select: { key: true, name: true } },
      assignee: { select: { name: true, email: true } },
      labels: { select: { label: { select: { name: true } } } },
    },
  });
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const rows = tasks.slice(0, EXPORT_LIMIT).map((t) =>
    csvRow([
      `${t.project.key}-${t.number}`,
      t.title,
      t.project.name,
      t.status,
      t.priority,
      t.assignee ? t.assignee.name || t.assignee.email : "",
      t.createdAt.toISOString(),
      day(t.startDate),
      day(t.dueDate),
      t.completedAt ? t.completedAt.toISOString() : "",
      t.estimateHours ?? "",
      t.actualHours ?? "",
      t.labels.map((l) => l.label.name).join("; "),
      t.archivedAt ? "yes" : "",
    ])
  );
  return { rows: [csvRow(header), ...rows], truncated: tasks.length > EXPORT_LIMIT };
};

export const exportWorkload = async (actor: Actor, scope: Scope) => {
  const { people } = await workload(actor, scope);
  return {
    rows: [
      csvRow(["Person", "Email", "Open", "Overdue", "Due in 7 days", "Open estimate (h)", "Open without estimate", `Completed ${scope.from} to ${scope.to}`]),
      ...people.map((p) => csvRow([p.user ? p.user.name || p.user.email : "Unassigned", p.user?.email ?? "", p.open, p.overdue, p.dueSoon, p.openHours, p.unestimated, p.completed])),
    ],
    truncated: false,
  };
};
