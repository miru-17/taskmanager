import request from "supertest";
import type { OrgRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/core/prisma";
import { testOutbox } from "../src/core/mailer";

export const app = createApp();
export { prisma, testOutbox };

export const CSRF = { "X-TaskForge-CSRF": "1" };

export const resetDb = async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "Invitation", "Membership", "Session", "UserToken", "Task", "Organization", "User", "StripeEvent" RESTART IDENTITY CASCADE'
  );
  testOutbox.length = 0;
};

let counter = 0;
export const uniqueEmail = (prefix = "user") => `${prefix}${++counter}_${Date.now()}@example.com`;

export const DEFAULT_PASSWORD = "correct-horse-battery";

/** Pulls the token out of the newest email whose link matches `/path/<token>`. */
export const tokenFromOutbox = (path: string, to?: string): string => {
  const mail = [...testOutbox].reverse().find((m) => (!to || m.to === to) && m.text.includes(`/${path}/`));
  const match = mail?.text.match(new RegExp(`/${path}/([a-f0-9]{64})`));
  if (!match) throw new Error(`No /${path}/ link in outbox${to ? ` for ${to}` : ""}`);
  return match[1];
};

export interface TestUser {
  email: string;
  password: string;
  userId: number;
  orgId: string | null;
  token: string;
  auth: { Authorization: string };
  /** supertest agent holding this user's refresh cookie */
  agent: ReturnType<typeof request.agent>;
}

const fromLogin = (email: string, password: string, agent: TestUser["agent"], body: any): TestUser => ({
  email,
  password,
  agent,
  userId: body.user.id,
  orgId: body.organization?.id ?? null,
  token: body.accessToken,
  auth: { Authorization: `Bearer ${body.accessToken}` },
});

export const login = async (email: string, password = DEFAULT_PASSWORD): Promise<TestUser> => {
  const agent = request.agent(app);
  const res = await agent.post("/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return fromLogin(email, password, agent, res.body);
};

/** Registers a new user (who becomes ORG_ADMIN of a new organisation) and signs in. */
export const signUp = async (
  opts: { email?: string; password?: string; organizationName?: string; verified?: boolean } = {}
): Promise<TestUser> => {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? DEFAULT_PASSWORD;
  const res = await request(app)
    .post("/auth/register")
    .send({ email, password, organizationName: opts.organizationName });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (opts.verified !== false) {
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  }
  return login(email, password);
};

/** Invites a fresh user into `admin`'s organisation with `role`, registers them via the link, signs them in. */
export const addMember = async (admin: TestUser, role: OrgRole): Promise<TestUser> => {
  const email = uniqueEmail(role.toLowerCase());
  await request(app).post("/orgs/current/invitations").set(admin.auth).send({ email, role }).expect(201);
  const inviteToken = tokenFromOutbox("invite", email);
  await request(app)
    .post("/auth/register")
    .send({ email, password: DEFAULT_PASSWORD, inviteToken })
    .expect(201);
  const member = await login(email);
  if (member.orgId !== admin.orgId) throw new Error("invited member landed in the wrong org");
  return member;
};

export const isoDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const createTask = async (user: TestUser, title = "task") => {
  const res = await request(app).post("/tasks").set(user.auth).send({ title });
  if (res.status !== 201) throw new Error(`create task failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; organizationId: string; createdById: number };
};
