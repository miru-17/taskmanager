import request from "supertest";
import { app, prisma } from "./helpers";

afterAll(() => prisma.$disconnect());

describe("Platform", () => {
  it("serves liveness and readiness checks", async () => {
    expect((await request(app).get("/health")).body).toEqual({ status: "ok" });
    expect((await request(app).get("/health/ready")).body).toEqual({ status: "ok", database: "up" });
  });

  it("returns JSON 404 for unknown routes", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("sets security headers and hides the framework", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("allows the configured frontend origin and not others", async () => {
    const ok = await request(app).options("/tasks").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "PATCH");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(ok.headers["access-control-allow-methods"]).toContain("PATCH");

    const bad = await request(app).options("/tasks").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects oversized bodies", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "a@b.co", password: "x".repeat(200_000) });
    expect(res.status).toBe(413);
  });
});
