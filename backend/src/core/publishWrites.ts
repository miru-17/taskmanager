import type { RequestHandler } from "express";
import { currentAuth } from "./auth";
import { publishTaskChange } from "./events";

/**
 * After a successful write, tells live clients which tasks changed. Task ids come from the
 * route (:id), a bulk body (ids), the response (id / task.id) or res.locals.changedTaskIds.
 * Runs after the response is sent, so it never slows the request or changes its outcome.
 */
export const publishWrites: RequestHandler = (req, res, next) => {
  if (req.method === "GET") return next();
  let body: unknown;
  const json = res.json.bind(res);
  res.json = (b: unknown) => {
    body = b;
    return json(b);
  };
  res.on("finish", () => {
    if (res.statusCode >= 300 || !req.tenant || !req.auth) return;
    const ids = new Set<number>();
    const add = (v: unknown) => {
      const n = typeof v === "string" ? Number(v) : v;
      if (typeof n === "number" && Number.isInteger(n) && n > 0) ids.add(n);
    };
    // Router-level middleware doesn't see :id, so read it from the URL (/tasks/42/...)
    add(/^\/tasks\/(\d+)(?:\/|$|\?)/.exec(req.originalUrl)?.[1]);
    if (Array.isArray(req.body?.ids)) req.body.ids.forEach(add);
    const b = body as { id?: unknown; task?: { id?: unknown } } | undefined;
    if (b && typeof b === "object") {
      add(b.id);
      add(b.task?.id);
    }
    ((res.locals.changedTaskIds as number[] | undefined) ?? []).forEach(add);
    if (ids.size) void publishTaskChange(req.tenant.organizationId, [...ids], currentAuth(req).userId);
  });
  next();
};
