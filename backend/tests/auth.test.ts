import request from "supertest";
import jwt from "jsonwebtoken";
import { app, createUser, prisma, resetDb } from "./helpers";
import { testOutbox } from "../src/core/mailer";
import { hashResetToken } from "../src/modules/auth/auth.service";

beforeEach(async () => {
  await resetDb();
  testOutbox.length = 0;
});
afterAll(() => prisma.$disconnect());

describe("POST /auth/register", () => {
  it("creates a user, normalises the email and never returns the password", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "  New.User@Example.COM ", password: "secret123" });

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: expect.any(Number), email: "new.user@example.com" });
    expect(JSON.stringify(res.body)).not.toContain("password\":");
  });

  it("returns 400 (not 500) when email is missing", async () => {
    const res = await request(app).post("/auth/register").send({ password: "secret123" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email is required");
  });

  it("rejects non-string email without crashing", async () => {
    const res = await request(app).post("/auth/register").send({ email: { $gt: "" }, password: "secret123" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid email and short password", async () => {
    expect((await request(app).post("/auth/register").send({ email: "nope", password: "secret123" })).status).toBe(400);
    expect((await request(app).post("/auth/register").send({ email: "a@b.co", password: "123" })).status).toBe(400);
  });

  it("returns 409 for a duplicate email (case-insensitive)", async () => {
    await request(app).post("/auth/register").send({ email: "dup@example.com", password: "secret123" }).expect(201);
    const res = await request(app).post("/auth/register").send({ email: "DUP@example.com", password: "secret123" });
    expect(res.status).toBe(409);
  });

  it("stores a bcrypt hash, not the plain password", async () => {
    await request(app).post("/auth/register").send({ email: "hash@example.com", password: "secret123" });
    const user = await prisma.user.findUnique({ where: { email: "hash@example.com" } });
    expect(user?.password).toMatch(/^\$2[aby]\$/);
  });
});

describe("POST /auth/login", () => {
  it("returns a token for valid credentials", async () => {
    const u = await createUser();
    const res = await request(app).post("/auth/login").send({ email: u.email.toUpperCase(), password: u.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(u.email);
  });

  it("uses the same generic 401 for wrong password and unknown email", async () => {
    const u = await createUser();
    const wrong = await request(app).post("/auth/login").send({ email: u.email, password: "wrongpass" });
    const unknown = await request(app).post("/auth/login").send({ email: "ghost@example.com", password: "wrongpass" });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 400 (not 500) when email is missing", async () => {
    const res = await request(app).post("/auth/login").send({ password: "x" });
    expect(res.status).toBe(400);
  });
});

describe("token verification", () => {
  it("rejects a missing, malformed, wrongly-signed or alg=none token", async () => {
    expect((await request(app).get("/tasks")).body.code).toBe("TOKEN_MISSING");
    expect((await request(app).get("/tasks").set("Authorization", "Bearer garbage")).status).toBe(401);

    const forged = jwt.sign({ id: 1, email: "a@b.co" }, "some-other-secret");
    expect((await request(app).get("/tasks").set("Authorization", `Bearer ${forged}`)).status).toBe(401);

    const none = jwt.sign({ id: 1, email: "a@b.co" }, "", { algorithm: "none" });
    expect((await request(app).get("/tasks").set("Authorization", `Bearer ${none}`)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign({ id: 1, email: "a@b.co" }, process.env.JWT_SECRET!, { expiresIn: -10 });
    const res = await request(app).get("/tasks").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });
});

describe("password reset", () => {
  const extractToken = () => {
    const mail = testOutbox.at(-1);
    const match = mail?.text.match(/reset-password\/([a-f0-9]{64})/);
    if (!match) throw new Error("No reset link in outbox");
    return match[1];
  };

  it("does not reveal whether an email is registered", async () => {
    const u = await createUser();
    const known = await request(app).post("/auth/forgot-password").send({ email: u.email });
    const unknown = await request(app).post("/auth/forgot-password").send({ email: "ghost@example.com" });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(testOutbox).toHaveLength(1);
  });

  it("matches the account regardless of email case", async () => {
    const u = await createUser();
    await request(app).post("/auth/forgot-password").send({ email: u.email.toUpperCase() }).expect(200);
    expect(testOutbox[0].to).toBe(u.email);
  });

  it("stores only a hash of the reset token", async () => {
    const u = await createUser();
    await request(app).post("/auth/forgot-password").send({ email: u.email });
    const token = extractToken();
    const user = await prisma.user.findUnique({ where: { email: u.email } });

    expect(user?.resetToken).toBe(hashResetToken(token));
    expect(user?.resetToken).not.toBe(token);
  });

  it("resets the password once, then the link stops working", async () => {
    const u = await createUser();
    await request(app).post("/auth/forgot-password").send({ email: u.email });
    const token = extractToken();

    expect((await request(app).get(`/auth/reset-user/${token}`)).body.email).toBe(u.email);
    await request(app).post(`/auth/reset-password/${token}`).send({ password: "brandnew1" }).expect(200);

    await request(app).post("/auth/login").send({ email: u.email, password: "brandnew1" }).expect(200);
    await request(app).post("/auth/login").send({ email: u.email, password: u.password }).expect(401);

    const reuse = await request(app).post(`/auth/reset-password/${token}`).send({ password: "another12" });
    expect(reuse.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const u = await createUser();
    await request(app).post("/auth/forgot-password").send({ email: u.email });
    const token = extractToken();
    await prisma.user.update({ where: { email: u.email }, data: { resetTokenExpiry: new Date(Date.now() - 1000) } });

    expect((await request(app).post(`/auth/reset-password/${token}`).send({ password: "brandnew1" })).status).toBe(400);
  });

  it("rejects malformed tokens with 400", async () => {
    expect((await request(app).get("/auth/reset-user/not-a-token")).status).toBe(400);
  });
});

describe("PUT /user/change-password", () => {
  it("changes the password with the correct current password", async () => {
    const u = await createUser();
    await request(app)
      .put("/user/change-password")
      .set(u.auth)
      .send({ currentPassword: u.password, newPassword: "changed123" })
      .expect(200);
    await request(app).post("/auth/login").send({ email: u.email, password: "changed123" }).expect(200);
  });

  it("returns 400 (not 401) for a wrong current password, so the client is not logged out", async () => {
    const u = await createUser();
    const res = await request(app)
      .put("/user/change-password")
      .set(u.auth)
      .send({ currentPassword: "wrong", newPassword: "changed123" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Current password is incorrect");
  });

  it("requires authentication", async () => {
    const res = await request(app).put("/user/change-password").send({ currentPassword: "a", newPassword: "changed123" });
    expect(res.status).toBe(401);
  });
});
