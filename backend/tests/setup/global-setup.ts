import { execSync } from "node:child_process";
import dotenv from "dotenv";

/** Brings the test database schema up to date once per test run. */
export default function globalSetup() {
  dotenv.config({ quiet: true });
  if (process.env.SKIP_TEST_MIGRATE === "1") return;

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see backend/.env.example)");

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
