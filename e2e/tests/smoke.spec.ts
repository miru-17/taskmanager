import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * The main path a new team takes, end to end against the real API and database:
 * sign up → project → describe-it task → board → comment → plan limits → analytics.
 */
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://tf:tf@localhost:5432/taskforge_dev";
const PASSWORD = "correct-horse-battery-staple";
const email = `owner+${Date.now()}@e2e.test`;

const signIn = async (page: Page) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/my-tasks$/);
};

test.describe.configure({ mode: "serial" });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test("sign up and sign in", async () => {
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Avery Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Organization name").fill("E2E Studio");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/login/);
  // Email verification is done by link in real use; here we mark it in the database
  const db = new Client({ connectionString: DB });
  await db.connect();
  await db.query(`UPDATE "User" SET "emailVerifiedAt" = now() WHERE email = $1`, [email]);
  await db.end();
  await signIn(page);
});

test("create a project and a task from a sentence", async () => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Launch site");
  await dialog.getByRole("button", { name: /^Create/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\//);

  await page.getByRole("button", { name: "New task", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "New task" });
  await composer.getByLabel("Describe the task").fill("Write the launch announcement tomorrow !high");
  await composer.getByRole("button", { name: "Fill in" }).click();
  await expect(composer.getByLabel("Task title")).toHaveValue("Write the launch announcement");
  await expect(composer.getByLabel("Priority")).toHaveValue("HIGH");
  await composer.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
});

test("comment, then see it on the board", async () => {
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await drawer.getByPlaceholder("Write a comment").fill("Draft is in the shared folder.");
  await drawer.getByRole("button", { name: "Comment" }).click();
  await expect(drawer.getByText("Draft is in the shared folder.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Board" }).click();
  await expect(page.getByText("Write the launch announcement")).toBeVisible();
});

test("the Free plan's project limit is enforced and explained", async () => {
  // Default project + "Launch site" = 2; Free allows 3
  for (const name of ["Third", "Fourth"]) {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project" }).first().click();
    await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("dialog").getByRole("button", { name: /^Create/ }).click();
  }
  await expect(page.getByText(/The Free plan includes up to 3 active projects/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/settings/billing");
  await expect(page.getByRole("progressbar", { name: "Active projects" })).toHaveAttribute("aria-valuenow", "3");
});

test("analytics reflect the work", async () => {
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByText("Open now")).toBeVisible();
});

test("sign out and back in", async () => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page);
});
