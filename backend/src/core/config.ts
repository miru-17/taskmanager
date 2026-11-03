import "dotenv/config";
import { z } from "zod";

/**
 * Single source of truth for configuration. The process refuses to start if a
 * required variable is missing or malformed, instead of failing later at request time.
 */
const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),

  // Short-lived access token (kept in browser memory) + long-lived rotating refresh token (httpOnly cookie)
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: bool.optional(),

  FRONTEND_URL: z.url().default("http://localhost:5173"),
  // Comma-separated list of allowed browser origins; defaults to FRONTEND_URL
  CORS_ORIGINS: z.string().optional(),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

  // Per-IP throttling of /auth endpoints
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  // Per-account lockout after repeated wrong passwords
  LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).max(50).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === "production" && env.JWT_SECRET.length < 32) {
  // eslint-disable-next-line no-console
  console.error("JWT_SECRET must be at least 32 characters in production");
  process.exit(1);
}

export const config = {
  ...env,
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
  corsOrigins: (env.CORS_ORIGINS ?? env.FRONTEND_URL)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  mailEnabled: Boolean(env.EMAIL_USER && env.EMAIL_PASS),
  frontendUrl: env.FRONTEND_URL.replace(/\/$/, ""),
} as const;

export type Config = typeof config;
