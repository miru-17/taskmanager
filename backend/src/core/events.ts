import { Client } from "pg";
import { config } from "./config";
import { logger } from "./logger";
import { prisma } from "./prisma";

/**
 * Realtime fan-out over Postgres LISTEN/NOTIFY: every API process listens on one channel,
 * so live updates work across several processes without adding Redis. Events carry ids
 * only, never content: clients refetch through the normal, permission-checked API.
 */

export type EventType = "task.changed" | "comment.changed" | "notification.created" | "project.changed";

export interface AppEvent {
  type: EventType;
  orgId: string;
  /** Delivered only to people who can see this project */
  projectId?: string;
  taskIds?: number[];
  /** Delivered only to these users (notifications) */
  userIds?: number[];
  /** The user who caused it (clients use this to skip their own echoes) */
  actorId?: number | null;
}

const CHANNEL = "taskforge_events";
type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();

export const subscribe = (fn: Listener) => {
  listeners.add(fn);
  void ensureListening();
  return () => {
    listeners.delete(fn);
  };
};

const dispatch = (e: AppEvent) => {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      logger.error({ err }, "Event listener failed");
    }
  }
};

/** Postgres caps NOTIFY payloads at 8000 bytes; keep events small. */
export const publish = async (e: AppEvent) => {
  const payload = JSON.stringify({ ...e, taskIds: e.taskIds?.slice(0, 200), userIds: e.userIds?.slice(0, 500) });
  try {
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
  } catch (err) {
    // Realtime is best effort; the change itself is already committed
    logger.warn({ err, type: e.type }, "Could not publish event");
  }
};

/** Publishes one task.changed event per project, so each can be filtered by project access. */
export const publishTaskChange = async (orgId: string, taskIds: number[], actorId: number | null, type: EventType = "task.changed") => {
  if (!taskIds.length) return;
  const rows = await prisma.task.findMany({ where: { id: { in: taskIds }, organizationId: orgId }, select: { id: true, projectId: true } });
  const byProject = new Map<string, number[]>();
  for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r.id]);
  await Promise.all([...byProject].map(([projectId, ids]) => publish({ type, orgId, projectId, taskIds: ids, actorId })));
};

// ─── Listener connection (one per process, reconnects with backoff) ─────────

let client: Client | null = null;
let connecting: Promise<void> | null = null;
let retry = 0;
let stopped = false;

const ensureListening = (): Promise<void> => {
  if (client || stopped) return Promise.resolve();
  connecting ??= (async () => {
    const c = new Client({ connectionString: config.DATABASE_URL });
    try {
      await c.connect();
      c.on("notification", (msg) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        try {
          dispatch(JSON.parse(msg.payload) as AppEvent);
        } catch {
          logger.warn("Malformed event payload ignored");
        }
      });
      c.on("error", (err) => {
        logger.warn({ err }, "Event listener connection lost; reconnecting");
        client = null;
        c.end().catch(() => {});
        scheduleReconnect();
      });
      await c.query(`LISTEN ${CHANNEL}`);
      client = c;
      retry = 0;
    } catch (err) {
      logger.warn({ err }, "Could not start the event listener; retrying");
      await c.end().catch(() => {});
      scheduleReconnect();
    } finally {
      connecting = null;
    }
  })();
  return connecting;
};

const scheduleReconnect = () => {
  if (stopped || !listeners.size) return;
  const delay = Math.min(30_000, 500 * 2 ** retry++);
  setTimeout(() => void ensureListening(), delay).unref();
};

/** Resolves once this process is listening (tests wait on it before publishing). */
export const ready = () => ensureListening();

export const stopEvents = async () => {
  stopped = true;
  listeners.clear();
  const c = client;
  client = null;
  await c?.end().catch(() => {});
};
