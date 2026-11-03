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
// Attachments go to a throwaway folder per test run, never the real upload directory
process.env.UPLOAD_DIR = require("node:path").join(require("node:os").tmpdir(), `taskforge-test-uploads-${process.pid}`);
process.env.MAX_UPLOAD_MB ??= "1";
process.env.STREAM_RECHECK_MS ??= "300";
