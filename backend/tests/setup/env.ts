/**
 * Runs before every test file (jest "setupFiles"), before any app module is imported.
 * Tests TRUNCATE tables, so they must never touch the development database.
 */
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Point it at a separate, disposable database (see backend/.env.example)."
  );
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — tests wipe their database.");
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-hs256";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.AUTH_RATE_LIMIT_MAX ??= "1000";
