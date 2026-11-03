import request from "supertest";

/**
 * Loads a fresh copy of the app with a tiny per-IP limit. Other test files run with
 * a high limit so they don't trip it.
 */
describe("Per-IP brute-force protection", () => {
  let app: import("express").Express;
  let disconnect: () => Promise<void>;

  beforeAll(() => {
    jest.resetModules();
    process.env.AUTH_RATE_LIMIT_MAX = "3";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    app = require("../src/app").createApp();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prisma } = require("../src/core/prisma");
    disconnect = () => prisma.$disconnect();
  });
  afterAll(() => disconnect());

  it("returns 429 after too many login attempts from one client", async () => {
    const attempt = () => request(app).post("/auth/login").send({ email: "victim@example.com", password: "guess" });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
  });

  it("limits password-reset requests separately", async () => {
    const attempt = () => request(app).post("/auth/forgot-password").send({ email: "victim@example.com" });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(200);
    expect((await attempt()).status).toBe(429);
  });
});
