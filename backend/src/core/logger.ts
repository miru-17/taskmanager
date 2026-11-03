import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.LOG_LEVEL ?? (config.isTest ? "silent" : config.isProduction ? "info" : "debug"),
  // Never log credentials or tokens, even by accident
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.currentPassword",
      "*.newPassword",
      "*.token",
    ],
    censor: "[redacted]",
  },
});
