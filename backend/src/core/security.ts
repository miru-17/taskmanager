import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";
import { config } from "./config";
import { AppError } from "./errors";

export const securityHeaders: RequestHandler = helmet();

export const CSRF_HEADER = "x-taskforge-csrf";

export const corsPolicy: RequestHandler = cors({
  origin(origin, callback) {
    // Non-browser clients (curl, server-to-server, tests) send no Origin header
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", CSRF_HEADER],
  credentials: true,
  maxAge: 600,
});

/**
 * CSRF guard for the few endpoints authenticated by the refresh cookie.
 * Requires a custom header (which forces a CORS preflight that foreign origins fail)
 * and, when the browser sends an Origin, that it is one of ours. Combined with
 * SameSite=Strict on the cookie this is defence in depth.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  const origin = req.get("origin");
  if (req.get(CSRF_HEADER) !== "1" || (origin && !config.corsOrigins.includes(origin))) {
    throw new AppError(403, "CSRF_REJECTED", "Request blocked");
  }
  next();
};

const tooMany = { message: "Too many attempts. Please try again later.", code: "RATE_LIMITED" };

/**
 * Per-IP throttle. In-memory store: right for a single instance; swap for a
 * shared store (Redis/Postgres) when running more than one API process.
 */
export const authRateLimit = (multiplier = 1): RequestHandler =>
  rateLimit({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: config.AUTH_RATE_LIMIT_MAX * multiplier,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: tooMany,
  });
