import request from "supertest";
import { app, CSRF, login, prisma, resetDb, signUp } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const refreshCookieOf = (res: request.Response) =>
  (res.headers["set-cookie"] as unknown as string[] | undefined)
    ?.find((c) => c.startsWith("tf_refresh="))
    ?.split(";")[0]
    .slice("tf_refresh=".length);

describe("Refresh token rotation", () => {
  it("issues a new access token and rotates the refresh cookie", async () => {
    const u = await signUp();
    const res = await u.agent.post("/auth/refresh").set(CSRF);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.organization.id).toBe(u.orgId);
    expect(refreshCookieOf(res)).toMatch(/^[a-f0-9]{64}$/);

    await request(app).get("/tasks").set("Authorization", `Bearer ${res.body.accessToken}`).expect(200);
  });

  it("detects reuse of a rotated-out token and revokes the whole session", async () => {
    const u = await signUp();
    const loginRes = await request(app).post("/auth/login").send({ email: u.email, password: u.password });
    const stolen = refreshCookieOf(loginRes)!;
    const access = loginRes.body.accessToken;

    // Legitimate client refreshes (rotating the token)…
    const rotated = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", `tf_refresh=${stolen}`);
    expect(rotated.status).toBe(200);
    const current = refreshCookieOf(rotated)!;

    // …later an attacker replays the old token (outside the multi-tab grace window)
    await prisma.session.updateMany({ data: { rotatedAt: new Date(Date.now() - 60_000) } });
    const replay = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", `tf_refresh=${stolen}`);
    expect(replay.status).toBe(401);

    // The session is dead for everyone: new refresh token and access tokens both rejected
    expect((await request(app).post("/auth/refresh").set(CSRF).set("Cookie", `tf_refresh=${current}`)).status).toBe(401);
    expect((await request(app).get("/tasks").set("Authorization", `Bearer ${access}`)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: "auth.refresh_reuse_detected" } })).toBe(1);
  });

  it("treats an immediate second use of the old token as a benign multi-tab race (409, not revocation)", async () => {
    const u = await signUp();
    const loginRes = await request(app).post("/auth/login").send({ email: u.email, password: u.password });
    const old = refreshCookieOf(loginRes)!;

    const first = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", `tf_refresh=${old}`);
    const second = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", `tf_refresh=${old}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("REFRESH_RACE");

    // The session survives
    const next = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", `tf_refresh=${refreshCookieOf(first)}`);
    expect(next.status).toBe(200);
  });

  it("rejects missing, malformed and unknown refresh tokens", async () => {
    expect((await request(app).post("/auth/refresh").set(CSRF)).status).toBe(401);
    expect((await request(app).post("/auth/refresh").set(CSRF).set("Cookie", "tf_refresh=abc")).status).toBe(401);
    expect((await request(app).post("/auth/refresh").set(CSRF).set("Cookie", `tf_refresh=${"a".repeat(64)}`)).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const u = await signUp();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await u.agent.post("/auth/refresh").set(CSRF)).status).toBe(401);
  });
});

describe("CSRF protection on cookie-authenticated endpoints", () => {
  it("requires the custom header", async () => {
    const u = await signUp();
    const res = await u.agent.post("/auth/refresh");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_REJECTED");
  });

  it("rejects requests from a foreign Origin even with the header", async () => {
    const u = await signUp();
    const res = await u.agent.post("/auth/refresh").set(CSRF).set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect((await u.agent.post("/auth/logout").set(CSRF).set("Origin", "https://evil.example")).status).toBe(403);
  });

  it("accepts our own Origin", async () => {
    const u = await signUp();
    expect((await u.agent.post("/auth/refresh").set(CSRF).set("Origin", "http://localhost:5173")).status).toBe(200);
  });
});

describe("Logout and session management", () => {
  it("logout ends the session immediately — the access token stops working", async () => {
    const u = await signUp();
    await u.agent.post("/auth/logout").set(CSRF).expect(200);
    expect((await request(app).get("/tasks").set(u.auth)).status).toBe(401);
    expect((await u.agent.post("/auth/refresh").set(CSRF)).status).toBe(401);
  });

  it("lists active sessions and marks the current one", async () => {
    const u = await signUp();
    await login(u.email, u.password);
    const res = await request(app).get("/auth/sessions").set(u.auth).set("User-Agent", "jest");
    expect(res.body).toHaveLength(2);
    expect(res.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/Hash/);
  });

  it("revokes another device's session", async () => {
    const u = await signUp();
    const laptop = await login(u.email, u.password);
    const sessions = (await request(app).get("/auth/sessions").set(u.auth)).body;
    const other = sessions.find((s: { current: boolean }) => !s.current);

    await request(app).delete(`/auth/sessions/${other.id}`).set(u.auth).expect(200);
    expect((await request(app).get("/tasks").set(laptop.auth)).status).toBe(401);
    expect((await request(app).get("/tasks").set(u.auth)).status).toBe(200);
  });

  it("cannot revoke someone else's session (IDOR)", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const bobSession = (await request(app).get("/auth/sessions").set(bob.auth)).body[0];

    expect((await request(app).delete(`/auth/sessions/${bobSession.id}`).set(alice.auth)).status).toBe(404);
    expect((await request(app).get("/tasks").set(bob.auth)).status).toBe(200);
  });

  it("logout-all signs out every device", async () => {
    const u = await signUp();
    const phone = await login(u.email, u.password);
    await request(app).post("/auth/logout-all").set(u.auth).expect(200);
    expect((await request(app).get("/tasks").set(u.auth)).status).toBe(401);
    expect((await request(app).get("/tasks").set(phone.auth)).status).toBe(401);
  });

  it("/auth/me returns the current identity and permissions", async () => {
    const u = await signUp({ organizationName: "Me Org" });
    const res = await request(app).get("/auth/me").set(u.auth);
    expect(res.body.organization.name).toBe("Me Org");
    expect(res.body.accessToken).toEqual(expect.any(String));
  });
});
