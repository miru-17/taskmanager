import "dotenv/config";
import { z } from "zod";

/**
 * Single source of truth for configuration. The process refuses to start if a
 * required variable is missing or malformed, instead of failing later at request time.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("1d"),
  FRONTEND_URL: z.url().default("http://localhost:5173"),
  // Comma-separated list of allowed browser origins; defaults to FRONTEND_URL
  CORS_ORIGINS: z.string().optional(),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
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
  corsOrigins: (env.CORS_ORIGINS ?? env.FRONTEND_URL)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  mailEnabled: Boolean(env.EMAIL_USER && env.EMAIL_PASS),
} as const;

export type Config = typeof config;
