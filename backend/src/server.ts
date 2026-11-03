import { config } from "./core/config";
import { logger } from "./core/logger";
import { prisma } from "./core/prisma";
import { createApp } from "./app";

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(`Server running at http://localhost:${config.PORT}`);
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
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
