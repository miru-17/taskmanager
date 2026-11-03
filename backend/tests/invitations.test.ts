import request from "supertest";
import {
  addMember,
  app,
  DEFAULT_PASSWORD,
  login,
  prisma,
  resetDb,
  signUp,
  tokenFromOutbox,
  uniqueEmail,
  type TestUser,
} from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const invite = (admin: TestUser, email: string, role = "MEMBER") =>
  request(app).post("/orgs/current/invitations").set(admin.auth).send({ email, role });

describe("Invitations", () => {
  it("previews without signing in and registers the invitee straight into the organization", async () => {
    const admin = await signUp({ organizationName: "Inviters" });
    const email = uniqueEmail("new");
    await invite(admin, email, "TEAM_LEAD").expect(201);
    const token = tokenFromOutbox("invite", email);

    const preview = await request(app).get(`/invitations/${token}`);
    expect(preview.body).toMatchObject({ organizationName: "Inviters", email, role: "TEAM_LEAD", accountExists: false });

    await request(app).post("/auth/register").send({ email, password: DEFAULT_PASSWORD, inviteToken: token }).expect(201);
    const member = await login(email);
    expect(member.orgId).toBe(admin.orgId);

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } });
    expect(user.emailVerifiedAt).not.toBeNull(); // the link proved the inbox
    expect(user.memberships).toHaveLength(1); // no extra personal org
    expect(user.memberships[0].role).toBe("TEAM_LEAD");
  });

  it("lets an existing user accept and switches them into the organization", async () => {
    const admin = await signUp({ organizationName: "Host" });
    const guest = await signUp({ organizationName: "Guest Home" });
    await invite(admin, guest.email, "VIEWER").expect(201);
    const token = tokenFromOutbox("invite", guest.email);
    expect((await request(app).get(`/invitations/${token}`)).body.accountExists).toBe(true);

    const res = await request(app).post(`/invitations/${token}/accept`).set(guest.auth);
    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({ id: admin.orgId, role: "VIEWER" });
    expect(res.body.organizations).toHaveLength(2);
  });

  it("can only be accepted by the invited email address", async () => {
    const admin = await signUp();
    const intruder = await signUp();
    await invite(admin, "intended@example.com").expect(201);
    const token = tokenFromOutbox("invite", "intended@example.com");

    const res = await request(app).post(`/invitations/${token}/accept`).set(intruder.auth);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INVITATION_EMAIL_MISMATCH");
    const reg = await request(app).post("/auth/register").send({ email: uniqueEmail(), password: DEFAULT_PASSWORD, inviteToken: token });
    expect(reg.status).toBe(400);
  });

  it("works only once", async () => {
    const admin = await signUp();
    const guest = await signUp();
    await invite(admin, guest.email).expect(201);
    const token = tokenFromOutbox("invite", guest.email);
    await request(app).post(`/invitations/${token}/accept`).set(guest.auth).expect(200);
    expect((await request(app).post(`/invitations/${token}/accept`).set(guest.auth)).status).toBe(404);
    expect((await request(app).get(`/invitations/${token}`)).status).toBe(404);
  });

  it("stops working when revoked, expired, or replaced by a newer invitation", async () => {
    const admin = await signUp();
    const guest = await signUp();

    await invite(admin, guest.email).expect(201);
    const first = tokenFromOutbox("invite", guest.email);
    await invite(admin, guest.email, "VIEWER").expect(201);
    const second = tokenFromOutbox("invite", guest.email);
    expect((await request(app).get(`/invitations/${first}`)).status).toBe(404);

    const pending = (await request(app).get("/orgs/current/invitations").set(admin.auth)).body;
    expect(pending).toHaveLength(1);
    await request(app).delete(`/orgs/current/invitations/${pending[0].id}`).set(admin.auth).expect(200);
    expect((await request(app).post(`/invitations/${second}/accept`).set(guest.auth)).status).toBe(404);

    await invite(admin, guest.email).expect(201);
    const third = tokenFromOutbox("invite", guest.email);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post(`/invitations/${third}/accept`).set(guest.auth)).status).toBe(404);
  });

  it("stores only a hash of the token", async () => {
    const admin = await signUp();
    await invite(admin, "hash@example.com").expect(201);
    const token = tokenFromOutbox("invite", "hash@example.com");
    const row = await prisma.invitation.findFirstOrThrow({ where: { email: "hash@example.com" } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects inviting an existing member", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    expect((await invite(admin, member.email)).status).toBe(409);
  });

  it("requires the inviter to have verified their email", async () => {
    const admin = await signUp({ verified: false });
    const res = await invite(admin, "someone@example.com");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("one organization can't revoke another organization's invitation (IDOR)", async () => {
    const acme = await signUp();
    const globex = await signUp();
    await invite(acme, "target@example.com").expect(201);
    const acmeInvite = (await request(app).get("/orgs/current/invitations").set(acme.auth)).body[0];

    expect((await request(app).delete(`/orgs/current/invitations/${acmeInvite.id}`).set(globex.auth)).status).toBe(404);
    expect((await request(app).get("/orgs/current/invitations").set(acme.auth)).body).toHaveLength(1);
  });

  it("rejects malformed tokens", async () => {
    expect((await request(app).get("/invitations/nope")).status).toBe(400);
    expect((await request(app).get(`/invitations/${"0".repeat(64)}`)).status).toBe(404);
  });
});
