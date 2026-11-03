import { Router, type Request } from "express";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { audit } from "../../core/audit";
import type { Actor } from "../../core/access";
import * as a from "./analytics.service";
import { resolveTimeZone } from "./timezone";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireTenant, requirePermission("analytics:read"));

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });
/** The validated scope, with the viewer's zone resolved to one Postgres knows. */
const scope = async <T extends a.Scope>(res: { locals: Record<string, unknown> }): Promise<T> => {
  const q = res.locals.query as T;
  return { ...q, tz: await resolveTimeZone(q.tz) };
};

analyticsRouter.get("/summary", validate({ query: a.scopeQuery }), async (req, res) => {
  res.json(await a.summary(actor(req), await scope(res)));
});
analyticsRouter.get("/trend", validate({ query: a.scopeQuery }), async (req, res) => {
  res.json(await a.trend(actor(req), await scope(res)));
});
analyticsRouter.get("/workload", validate({ query: a.scopeQuery }), async (req, res) => {
  res.json(await a.workload(actor(req), await scope(res)));
});
analyticsRouter.get("/projects", validate({ query: a.scopeQuery }), async (req, res) => {
  res.json(await a.byProject(actor(req), await scope(res)));
});

analyticsRouter.get("/export.csv", validate({ query: a.exportQuery }), async (req, res) => {
  const q = await scope<a.Scope & { dataset: "tasks" | "workload" }>(res);
  const { rows, truncated } = q.dataset === "workload" ? await a.exportWorkload(actor(req), q) : await a.exportTasks(actor(req), q);
  await audit(req, { action: "analytics.exported", organizationId: currentTenant(req).organizationId, targetType: "organization", targetId: currentTenant(req).organizationId, metadata: { dataset: q.dataset, rows: rows.length - 1, projectId: q.projectId ?? null } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="taskforge-${q.dataset}-${q.to}.csv"`);
  res.setHeader("Cache-Control", "private, no-store");
  if (truncated) res.setHeader("X-Export-Truncated", String(a.EXPORT_LIMIT));
  // BOM so Excel reads UTF-8 names correctly
  res.send("﻿" + rows.join("\r\n") + "\r\n");
});
