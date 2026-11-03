import { config } from "./core/config";
import { logger } from "./core/logger";
import { prisma } from "./core/prisma";
import { createApp } from "./app";
import { stopEvents } from "./core/events";
import { runDueSoonSweep } from "./modules/notifications/notifications.service";

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(`Server running at http://localhost:${config.PORT}`);
});

// Due-tomorrow reminders: hourly, deduplicated per task and day, single-runner via advisory lock
const sweep = () =>
  runDueSoonSweep()
    .then((sent) => sent && logger.info({ sent }, "Due-soon reminders sent"))
    .catch((err) => logger.warn({ err }, "Due-soon sweep failed"));
setTimeout(sweep, 30_000).unref();
setInterval(sweep, 60 * 60_000).unref();

const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
    await stopEvents();
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force exit if connections don't drain in time
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
