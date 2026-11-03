import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";
import { config } from "./config";

export const securityHeaders: RequestHandler = helmet();

export const corsPolicy: RequestHandler = cors({
  origin(origin, callback) {
    // Non-browser clients (curl, server-to-server, tests) send no Origin header
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 600,
});

const tooMany = { message: "Too many attempts. Please try again later.", code: "RATE_LIMITED" };

/**
 * Throttles credential and email-sending endpoints per IP.
 * In-memory store: fine for a single instance; swap for a shared store when scaling out.
 */
export const authRateLimit = (): RequestHandler =>
  rateLimit({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: tooMany,
  });
