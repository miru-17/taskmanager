import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  app,
  CSRF,
  DEFAULT_PASSWORD,
  login,
  prisma,
  resetDb,
  signUp,
  testOutbox,
  tokenFromOutbox,
  uniqueEmail,
} from "./helpers";
import { sha256 } from "../src/core/crypto";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("Registration", () => {
  it("creates the user, a new organization with them as admin, and sends a verification email", async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post("/auth/register")
      .send({ email: email.toUpperCase(), password: DEFAULT_PASSWORD, name: "Ada", organizationName: "Acme Corp" });

    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { memberships: { include: { organization: true } } },
    });
    expect(user.name).toBe("Ada");
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0].role).toBe("ORG_ADMIN");
    expect(user.memberships[0].organization.name).toBe("Acme Corp");
    expect(user.memberships[0].organization.slug).toMatch(/^acme-corp-[a-z0-9]{6}$/);
    expect(testOutbox.at(-1)?.text).toMatch(/verify-email\/[a-f0-9]{64}/);
  });

  it("stores an Argon2id hash", async () => {
    const u = await signUp();
    const row = await prisma.user.findUniqueOrThrow({ where: { email: u.email } });
    expect(row.password).toMatch(/^\$argon2id\$/);
  });

  it("gives the same response for an existing email and warns the real owner instead (no enumeration)", async () => {
    const u = await signUp();
    testOutbox.length = 0;

    const fresh = await request(app).post("/auth/register").send({ email: uniqueEmail(), password: DEFAULT_PASSWORD });
    const dup = await request(app).post("/auth/register").send({ email: u.email, password: "another-long-pass" });

    expect(dup.status).toBe(fresh.status);
    expect(dup.body).toEqual(fresh.body);
    expect(testOutbox.find((m) => m.to === u.email)?.subject).toMatch(/tried to create/);
    // The original password still works
    await login(u.email, u.password);
  });

  it("rejects short and common passwords", async () => {
    const short = await request(app).post("/auth/register").send({ email: uniqueEmail(), password: "abc123" });
    const common = await request(app).post("/auth/register").send({ email: uniqueEmail(), password: "Password123" });
    expect(short.status).toBe(400);
    expect(common.status).toBe(400);
    expect(common.body.message).toMatch(/too common/);
  });

  it("returns 400 (not 500) for missing or non-string email", async () => {
    expect((await request(app).post("/auth/register").send({ password: DEFAULT_PASSWORD })).status).toBe(400);
    expect((await request(app).post("/auth/register").send({ email: { $gt: "" }, password: DEFAULT_PASSWORD })).status).toBe(400);
  });
});

describe("Login", () => {
  it("returns an access token, the active organization and permissions, and sets a hardened refresh cookie", async () => {
    const u = await signUp({ organizationName: "Org A" });
    const res = await request(app).post("/auth/login").send({ email: u.email, password: u.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.user).toMatchObject({ email: u.email, emailVerified: true, isSuperAdmin: false });
    expect(res.body.organization).toMatchObject({ name: "Org A", role: "ORG_ADMIN" });
    expect(res.body.permissions).toContain("members:manage");
    expect(JSON.stringify(res.body)).not.toMatch(/password|refresh/i);

    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("tf_refresh="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/auth/);
  });

  it("uses the same 401 for a wrong password and an unknown email", async () => {
    const u = await signUp();
    const wrong = await request(app).post("/auth/login").send({ email: u.email, password: "wrong-password-x" });
    const unknown = await request(app).post("/auth/login").send({ email: "ghost@example.com", password: "wrong-password-x" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("upgrades a legacy bcrypt hash to Argon2id on successful login", async () => {
    const email = uniqueEmail();
    await signUp({ email });
    await prisma.user.update({ where: { email }, data: { password: await bcrypt.hash("legacy-password-1", 10) } });

    await login(email, "legacy-password-1");
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.password).toMatch(/^\$argon2id\$/);
    await login(email, "legacy-password-1"); // still works after the upgrade
  });
});

describe("Account lockout (brute force)", () => {
  it("locks the account after 5 wrong passwords, even for the correct password, and logs it", async () => {
    const u = await signUp();
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post("/auth/login").send({ email: u.email, password: `wrong-pass-${i}` })).status).toBe(401);
    }

    const locked = await request(app).post("/auth/login").send({ email: u.email, password: u.password });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("ACCOUNT_LOCKED");
    expect(locked.headers["retry-after"]).toBeDefined();

    const actions = (await prisma.auditLog.findMany({ where: { actorId: u.userId } })).map((a) => a.action);
    expect(actions.filter((a) => a === "auth.login_failed")).toHaveLength(5);
    expect(actions).toContain("auth.account_locked");
  });

  it("unlocks after the lockout window", async () => {
    const u = await signUp();
    await prisma.user.update({ where: { email: u.email }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await login(u.email, u.password);
  });

  it("resets the failure counter after a successful login", async () => {
    const u = await signUp();
    for (let i = 0; i < 4; i++) await request(app).post("/auth/login").send({ email: u.email, password: "nope-nope-1" });
    await login(u.email, u.password);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: u.email } })).failedLoginCount).toBe(0);
  });
});

describe("Access token verification", () => {
  it("rejects missing, malformed, forged, alg=none, wrong-audience and expired tokens", async () => {
    const u = await signUp();
    const claims = { sid: "x", org: u.orgId };
    const secret = process.env.JWT_SECRET!;
    const bad = [
      undefined,
      "garbage",
      jwt.sign(claims, "some-other-secret", { subject: String(u.userId), issuer: "taskforge", audience: "taskforge-api" }),
      jwt.sign(claims, "", { algorithm: "none", subject: String(u.userId) }),
      jwt.sign(claims, secret, { subject: String(u.userId), issuer: "taskforge", audience: "someone-else" }),
      jwt.sign(claims, secret, { subject: String(u.userId), issuer: "taskforge", audience: "taskforge-api", expiresIn: -10 }),
    ];
    for (const token of bad) {
      const req = request(app).get("/tasks");
      if (token) req.set("Authorization", `Bearer ${token}`);
      expect((await req).status).toBe(401);
    }
  });

  it("rejects a validly signed token whose session doesn't exist", async () => {
    const u = await signUp();
    const token = jwt.sign({ sid: "no-such-session", org: u.orgId }, process.env.JWT_SECRET!, {
      subject: String(u.userId),
      issuer: "taskforge",
      audience: "taskforge-api",
    });
    const res = await request(app).get("/tasks").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_INVALID");
  });
});

describe("Email verification", () => {
  it("verifies once with the emailed link", async () => {
    const email = uniqueEmail();
    await request(app).post("/auth/register").send({ email, password: DEFAULT_PASSWORD }).expect(201);
    const token = tokenFromOutbox("verify-email", email);

    await request(app).post("/auth/verify-email").send({ token }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();
    expect((await request(app).post("/auth/verify-email").send({ token })).status).toBe(400);
  });

  it("lets a signed-in unverified user request a new link, which invalidates the old one", async () => {
    const u = await signUp({ verified: false });
    const first = tokenFromOutbox("verify-email", u.email);
    await request(app).post("/auth/resend-verification").set(u.auth).expect(200);
    const second = tokenFromOutbox("verify-email", u.email);

    expect(second).not.toBe(first);
    expect((await request(app).post("/auth/verify-email").send({ token: first })).status).toBe(400);
    await request(app).post("/auth/verify-email").send({ token: second }).expect(200);
    expect((await request(app).post("/auth/resend-verification").set(u.auth)).status).toBe(400);
  });
});

describe("Password reset", () => {
  it("does not reveal whether an email is registered", async () => {
    const u = await signUp();
    testOutbox.length = 0;
    const known = await request(app).post("/auth/forgot-password").send({ email: u.email.toUpperCase() });
    const unknown = await request(app).post("/auth/forgot-password").send({ email: "ghost@example.com" });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(testOutbox).toHaveLength(1);
  });

  it("stores only a hash of the token, works once, and signs out every existing session", async () => {
    const u = await signUp();
    await request(app).post("/auth/forgot-password").send({ email: u.email });
    const token = tokenFromOutbox("reset-password", u.email);

    const stored = await prisma.userToken.findFirstOrThrow({ where: { userId: u.userId, type: "RESET_PASSWORD" } });
    expect(stored.tokenHash).toBe(sha256(token));

    expect((await request(app).get(`/auth/reset-user/${token}`)).body.email).toBe(u.email);
    await request(app).post(`/auth/reset-password/${token}`).send({ password: "brand-new-password" }).expect(200);

    // Old access token stops working immediately
    expect((await request(app).get("/tasks").set(u.auth)).status).toBe(401);
    await login(u.email, "brand-new-password");
    expect((await request(app).post(`/auth/reset-password/${token}`).send({ password: "another-new-pass" })).status).toBe(400);
  });

  it("clears an account lockout", async () => {
    const u = await signUp();
    await prisma.user.update({ where: { email: u.email }, data: { lockedUntil: new Date(Date.now() + 3600_000) } });
    await request(app).post("/auth/forgot-password").send({ email: u.email });
    await request(app)
      .post(`/auth/reset-password/${tokenFromOutbox("reset-password", u.email)}`)
      .send({ password: "brand-new-password" })
      .expect(200);
    await login(u.email, "brand-new-password");
  });

  it("rejects expired and malformed tokens", async () => {
    const u = await signUp();
    await request(app).post("/auth/forgot-password").send({ email: u.email });
    const token = tokenFromOutbox("reset-password", u.email);
    await prisma.userToken.updateMany({ where: { userId: u.userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post(`/auth/reset-password/${token}`).send({ password: "brand-new-password" })).status).toBe(400);
    expect((await request(app).get("/auth/reset-user/not-a-token")).status).toBe(400);
  });
});

describe("Change password", () => {
  it("returns 400 (not 401) for a wrong current password so the client isn't logged out", async () => {
    const u = await signUp();
    const res = await request(app)
      .put("/user/change-password")
      .set(u.auth)
      .send({ currentPassword: "wrong", newPassword: "changed-password-1" });
    expect(res.status).toBe(400);
  });

  it("keeps this session but signs out every other device", async () => {
    const u = await signUp();
    const otherDevice = await login(u.email, u.password);

    await request(app)
      .put("/user/change-password")
      .set(u.auth)
      .send({ currentPassword: u.password, newPassword: "changed-password-1" })
      .expect(200);

    expect((await request(app).get("/tasks").set(u.auth)).status).toBe(200);
    expect((await request(app).get("/tasks").set(otherDevice.auth)).status).toBe(401);
    expect((await otherDevice.agent.post("/auth/refresh").set(CSRF)).status).toBe(401);
  });
});

describe("Profile", () => {
  it("updates the display name", async () => {
    const u = await signUp();
    const res = await request(app).patch("/user/profile").set(u.auth).send({ name: "  Grace Hopper " });
    expect(res.body.name).toBe("Grace Hopper");
  });
});
