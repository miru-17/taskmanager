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
  // Path the browser sees for the auth routes. Behind a reverse proxy that serves the API under /api, use /api/auth.
  COOKIE_PATH: z.string().startsWith("/").default("/auth"),

  FRONTEND_URL: z.url().default("http://localhost:5173"),
  // Comma-separated list of allowed browser origins; defaults to FRONTEND_URL
  CORS_ORIGINS: z.string().optional(),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  // Without email credentials: development logs each message; production only logs that one was skipped,
  // because messages carry sign-in, reset and invitation links. Set true to log them anyway (self-hosting without SMTP).
  MAIL_LOG_CONTENT: bool.optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

  // Per-IP throttling of /auth endpoints
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  // Per-account lockout after repeated wrong passwords
  LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).max(50).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),

  // Attachments are stored on local disk under UPLOAD_DIR (see core/storage.ts)
  UPLOAD_DIR: z.string().min(1).default("storage/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),
  MAX_ATTACHMENTS_PER_TASK: z.coerce.number().int().positive().max(200).default(20),
  ORG_STORAGE_QUOTA_MB: z.coerce.number().positive().default(1024),

  // AI is optional. Any OpenAI-compatible chat API works: Ollama locally
  // (AI_BASE_URL=http://localhost:11434/v1, no key) or a hosted provider with AI_API_KEY.
  // Unset AI_BASE_URL = every AI feature uses its rule-based fallback.
  AI_BASE_URL: z.url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().min(1).default("llama3.2"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8000).default(1200),
  // Per-user requests to /ai per 5 minutes
  AI_RATE_LIMIT: z.coerce.number().int().positive().default(60),

  // Billing (optional). Stripe test mode only: test keys start with sk_test_.
  // Without them the app runs on plans set by the server operator (npm run plan:set) plus the free trial.
  STRIPE_SECRET_KEY: z.string().startsWith("sk_test_", "Only Stripe test-mode keys (sk_test_…) are supported").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_PRICE_PRO: z.string().startsWith("price_").optional(),
  STRIPE_PRICE_BUSINESS: z.string().startsWith("price_").optional(),
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
  aiBaseUrl: env.AI_BASE_URL?.replace(/\/$/, "") ?? null,
} as const;

export type Config = typeof config;
