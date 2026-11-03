import { Router, type Request, type Response } from "express";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { AppError } from "../../core/errors";
import { prisma } from "../../core/prisma";
import { logger } from "../../core/logger";
import { subscribe, type AppEvent } from "../../core/events";
import { projectAccessWhere, type Actor } from "../../core/access";

/**
 * Server-Sent Events: GET /events streams "something changed" signals for the caller's
 * organization. The client refetches through the normal API, so permissions are enforced
 * there; this stream only decides who gets a signal at all.
 */
export const eventsRouter = Router();

const HEARTBEAT_MS = 25_000;
// Overridable so tests can check revocation without waiting a minute
const RECHECK_MS = Number(process.env.STREAM_RECHECK_MS) || 60_000;
const ACCESS_TTL_MS = 30_000;
const MAX_STREAMS_PER_USER = 5;
const open = new Map<number, number>();

export const openStreams = () => [...open.values()].reduce((a, b) => a + b, 0);

eventsRouter.get("/", authenticate, requireTenant, async (req: Request, res: Response) => {
  const auth = currentAuth(req);
  const tenant = currentTenant(req);
  if ((open.get(auth.userId) ?? 0) >= MAX_STREAMS_PER_USER) throw new AppError(429, "TOO_MANY_STREAMS", "Too many open tabs are listening for updates");
  open.set(auth.userId, (open.get(auth.userId) ?? 0) + 1);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: don't buffer the stream
  res.flushHeaders();
  res.write("retry: 3000\n\n");

  let actor: Actor = { userId: auth.userId, tenant };
  const access = new Map<string, { ok: boolean; at: number }>();
  const canSee = async (projectId: string) => {
    const hit = access.get(projectId);
    if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.ok;
    const ok = (await prisma.project.count({ where: { id: projectId, ...projectAccessWhere(actor) } })) > 0;
    access.set(projectId, { ok, at: Date.now() });
    return ok;
  };

  let closed = false;
  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onEvent = async (e: AppEvent) => {
    if (closed || e.orgId !== tenant.organizationId) return;
    if (e.userIds && !e.userIds.includes(auth.userId)) return;
    try {
      if (e.projectId && !(await canSee(e.projectId))) return;
    } catch (err) {
      logger.warn({ err }, "Access check for event failed");
      return;
    }
    send(e.type, { type: e.type, projectId: e.projectId, taskIds: e.taskIds, actorId: e.actorId ?? null });
  };

  const unsubscribe = subscribe((e) => void onEvent(e));
  const heartbeat = setInterval(() => !closed && res.write(": ping\n\n"), HEARTBEAT_MS);

  const close = (reason?: string) => {
    if (closed) return;
    if (reason) send("stream.closed", { reason });
    closed = true;
    clearInterval(heartbeat);
    clearInterval(recheck);
    clearTimeout(expiry);
    unsubscribe();
    open.set(auth.userId, Math.max(0, (open.get(auth.userId) ?? 1) - 1));
    res.end();
  };

  // Revocation takes effect on open streams too: logout, removal from the org, role changes
  const recheck = setInterval(async () => {
    try {
      const [session, membership] = await Promise.all([
        prisma.session.findUnique({ where: { id: auth.sessionId }, select: { revokedAt: true, expiresAt: true } }),
        prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: tenant.organizationId, userId: auth.userId } }, select: { role: true } }),
      ]);
      if (!session || session.revokedAt || session.expiresAt <= new Date() || !membership) return close("revoked");
      if (membership.role !== actor.tenant.role) {
        actor = { userId: auth.userId, tenant: { ...tenant, role: membership.role } };
        access.clear();
      }
    } catch (err) {
      logger.warn({ err }, "Stream recheck failed");
    }
  }, RECHECK_MS);

  // The stream lives no longer than the token that opened it; the client reconnects with a fresh one
  const expiry = setTimeout(() => close("token_expired"), Math.max(1_000, (auth.tokenExpiresAt ?? Date.now() + 15 * 60_000) - Date.now()));

  req.on("close", () => close());
  send("ready", { userId: auth.userId, organizationId: tenant.organizationId });
});
