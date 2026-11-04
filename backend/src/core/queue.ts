import PgBoss from "pg-boss";
import { config } from "./config";
import { logger } from "./logger";

/**
 * Background jobs on pg-boss (Postgres-backed, so no Redis to run). Until startQueue() is
 * called (tests, scripts) jobs run in-process instead, and drainQueue() waits for them, so
 * tests stay deterministic while production gets durable, retried delivery.
 */

type Handler = (data: unknown) => Promise<void>;
const handlers = new Map<string, Handler>();
let boss: PgBoss | null = null;

const pending = new Set<Promise<void>>();

export const registerJob = (name: string, handler: Handler) => {
  handlers.set(name, handler);
};

export const enqueue = async (name: string, data: object) => {
  if (boss) {
    await boss.send(name, data, { retryLimit: 3, retryDelay: 5, retryBackoff: true, expireInMinutes: 15 });
    return;
  }
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No job handler for ${name}`);
  // In-process: run after the current request finishes, like a real queue would
  const p: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
    .then(() => handler(data))
    .catch((err) => logger.error({ err, job: name }, "Background job failed"))
    .finally(() => pending.delete(p));
  pending.add(p);
};

/** Waits until every in-process job, including jobs those jobs started, has finished. */
export const drainQueue = async () => {
  while (pending.size) await Promise.all([...pending]);
};

export const startQueue = async (schedules: { name: string; cron: string }[] = []) => {
  const b = new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss" });
  b.on("error", (err) => logger.error({ err }, "Job queue error"));
  await b.start();
  for (const [name, handler] of handlers) {
    await b.createQueue(name);
    await b.work(name, { batchSize: 5 }, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }
  for (const s of schedules) await b.schedule(s.name, s.cron, {}, { tz: "UTC" });
  boss = b;
  logger.info({ jobs: [...handlers.keys()] }, "Job queue started");
};

export const stopQueue = async () => {
  const b = boss;
  boss = null;
  await b?.stop({ graceful: true, timeout: 10_000 });
};

export const queueMode = () => (boss ? "pg-boss" : "in-process");
