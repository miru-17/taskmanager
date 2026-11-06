import request from "supertest";
import Stripe from "stripe";
import { Client } from "pg";
import { addMember, app, prisma, resetDb, signUp, tokenFromOutbox, type TestUser } from "./helpers";
import { stopEvents } from "../src/core/events";
import { config } from "../src/core/config";
import { PLANS, effectivePlan } from "../src/core/plans";
import { setStripeForTests } from "../src/modules/billing/stripe";
import { setProviderForTests } from "../src/modules/ai/provider";
import { resetBreakerForTests } from "../src/modules/ai/run";

const mutableConfig = config as unknown as Record<string, unknown>;
beforeEach(async () => {
  await resetDb();
  setStripeForTests(null);
  setProviderForTests(null);
  resetBreakerForTests();
});
afterAll(async () => {
  setStripeForTests(undefined);
  setProviderForTests(undefined);
  await stopEvents();
});

const setPlan = (u: TestUser, plan: "FREE" | "PRO" | "BUSINESS", extra: Record<string, unknown> = {}) => prisma.organization.update({ where: { id: u.orgId! }, data: { plan, ...extra } });
const invite = (u: TestUser, email: string, role = "MEMBER") => request(app).post("/orgs/current/invitations").set(u.auth).send({ email, role });
const project = (u: TestUser, name: string) => request(app).post("/projects").set(u.auth).send({ name });

describe("Plan limits are enforced on the server", () => {
  it("seats: people plus pending invitations, separately for clients, re-invites don't double count", async () => {
    const admin = await signUp();
    // Free: 5 internal people. Admin + 3 joined + 1 pending = 5
    for (let i = 0; i < 3; i++) await addMember(admin, "MEMBER");
    await invite(admin, "pending@x.test").expect(201);
    const over = await invite(admin, "sixth@x.test");
    expect(over.status).toBe(402);
    expect(over.body).toMatchObject({ code: "PLAN_LIMIT", details: { limit: "members", plan: "FREE", max: 5, used: 5 } });
    await invite(admin, "pending@x.test").expect(201); // re-sending the same invitation is fine
    // Clients have their own allowance (2)
    await invite(admin, "c1@x.test", "CLIENT").expect(201);
    await invite(admin, "c2@x.test", "CLIENT").expect(201);
    expect((await invite(admin, "c3@x.test", "CLIENT")).status).toBe(402);
    // Revoking a pending invitation frees the seat
    const inv = await prisma.invitation.findFirstOrThrow({ where: { email: "pending@x.test", acceptedAt: null, revokedAt: null } });
    await request(app).delete(`/orgs/current/invitations/${inv.id}`).set(admin.auth).expect(200);
    await invite(admin, "sixth@x.test").expect(201);
  });

  it("joining is re-checked when the invitation is used, and role changes between client and internal need a seat", async () => {
    const admin = await signUp();
    await setPlan(admin, "PRO");
    for (let i = 0; i < 4; i++) await addMember(admin, "MEMBER");
    await invite(admin, "late@x.test").expect(201); // fine on Pro
    await invite(admin, "existing@x.test").expect(201);
    const someone = await signUp({ email: "existing@x.test" }); // already has an account
    await setPlan(admin, "FREE"); // e.g. the subscription ended
    const r = await request(app).post("/auth/register").send({ email: "late@x.test", password: "correct-horse-battery-staple", inviteToken: tokenFromOutbox("invite", "late@x.test") });
    expect(r.status).toBe(402);
    expect(await prisma.user.count({ where: { email: "late@x.test" } })).toBe(0); // nothing half-created
    const acc = await request(app).post(`/invitations/${tokenFromOutbox("invite", "existing@x.test")}/accept`).set(someone.auth);
    expect(acc.status).toBe(402);
    expect(await prisma.invitation.count({ where: { email: "existing@x.test", acceptedAt: { not: null } } })).toBe(0); // still usable after upgrading

    // A client can't be turned into an internal member while internal seats are full
    await setPlan(admin, "PRO");
    const client = await addMember(admin, "CLIENT");
    await setPlan(admin, "FREE");
    expect((await request(app).patch(`/orgs/current/members/${client.userId}`).set(admin.auth).send({ role: "MEMBER" })).status).toBe(402);
    // …but changing roles within the same kind is always allowed
    const m = await prisma.membership.findFirstOrThrow({ where: { organizationId: admin.orgId!, role: "MEMBER" } });
    await request(app).patch(`/orgs/current/members/${m.userId}`).set(admin.auth).send({ role: "TEAM_LEAD" }).expect(200);
  });

  it("projects: active ones count, archiving frees a slot, parallel creates can't overshoot", async () => {
    const admin = await signUp(); // has its default project
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => project(admin, `P${i}`)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 402, 402, 402]);
    expect(await prisma.project.count({ where: { organizationId: admin.orgId! } })).toBe(3);
    const p = results.find((r) => r.status === 201)!.body;
    await request(app).patch(`/projects/${p.id}`).set(admin.auth).send({ status: "ARCHIVED" }).expect(200);
    const replacement = (await project(admin, "Replacement").expect(201)).body;
    expect(replacement.name).toBe("Replacement");
    // Restoring the archived one would make 4
    expect((await request(app).patch(`/projects/${p.id}`).set(admin.auth).send({ status: "ACTIVE" })).status).toBe(402);
  });

  it("the limit check and the insert happen under a per-organization lock", async () => {
    // Deterministic version of the race: hold the lock from another connection and the create must wait
    const admin = await signUp();
    const other = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await other.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`projects:${admin.orgId}`]);
      let done = false;
      const pending = project(admin, "Waits").then((r) => ((done = true), r));
      await new Promise((r) => setTimeout(r, 400));
      expect(done).toBe(false);
      await other.query("COMMIT");
      expect((await pending).status).toBe(201);
    } finally {
      await other.end();
    }
  });

  it("automations: only enabled rules count", async () => {
    const admin = await signUp();
    const pid = (await prisma.project.findFirstOrThrow({ where: { organizationId: admin.orgId! } })).id;
    const rule = (enabled = true) => request(app).post(`/projects/${pid}/automations`).set(admin.auth).send({ name: "R", enabled, trigger: "TASK_CREATED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] });
    for (let i = 0; i < 3; i++) await rule().expect(201);
    expect((await rule()).status).toBe(402);
    const off = (await rule(false).expect(201)).body;
    expect((await request(app).patch(`/automations/${off.id}`).set(admin.auth).send({ enabled: true })).status).toBe(402);
  });

  it("storage: the plan's allowance applies on top of the server cap", async () => {
    const saved = PLANS.FREE.limits.storageMb;
    (PLANS.FREE.limits as { storageMb: number }).storageMb = 0.002; // ~2 KB
    try {
      const admin = await signUp();
      const t = (await request(app).post("/tasks").set(admin.auth).send({ title: "x" }).expect(201)).body;
      const up = (n: number) => request(app).post(`/tasks/${t.id}/attachments`).set(admin.auth).attach("file", Buffer.alloc(n, "a"), "notes.txt");
      await up(1500).expect(201);
      const r = await up(1500);
      expect(r.status).toBe(402);
      expect(r.body.details).toMatchObject({ limit: "storage", plan: "FREE" });
      expect((await request(app).get("/attachments/usage").set(admin.auth)).body.quotaBytes).toBe(0.002 * 1024 * 1024); // the smaller of plan and server cap
    } finally {
      (PLANS.FREE.limits as { storageMb: number }).storageMb = saved;
    }
  });

  it("AI: past the monthly allowance, features keep working on the rules and the model isn't called", async () => {
    const saved = PLANS.FREE.limits.aiRequestsPerMonth;
    (PLANS.FREE.limits as { aiRequestsPerMonth: number }).aiRequestsPerMonth = 2;
    let calls = 0;
    setProviderForTests({ name: "t", model: "t", complete: async () => (calls++, JSON.stringify({ answer: "From the model", taskIds: [] })) });
    try {
      const admin = await signUp();
      const other = await signUp();
      const ask = (u: TestUser) => request(app).post("/ai/assistant").set(u.auth).send({ message: "what's overdue?" }).expect(200);
      expect((await ask(admin)).body.source).toBe("ai");
      expect((await ask(admin)).body.source).toBe("ai");
      const third = (await ask(admin)).body;
      expect(third).toMatchObject({ source: "rules", fallbackReason: "plan_limit" });
      expect(calls).toBe(2);
      expect((await ask(other)).body.source).toBe("ai"); // counted per organization
      const usage = (await request(app).get("/billing").set(admin.auth)).body.usage;
      expect(usage.aiThisMonth).toBe(2);
    } finally {
      (PLANS.FREE.limits as { aiRequestsPerMonth: number | null }).aiRequestsPerMonth = saved;
    }
  });
});

describe("Trial", () => {
  it("one Pro trial per organization, admins only; when it ends Free limits return and existing data stays", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    expect((await request(app).post("/billing/trial").set(member.auth)).status).toBe(403);
    const s = (await request(app).post("/billing/trial").set(admin.auth).expect(200)).body;
    expect(s).toMatchObject({ plan: "PRO", paidPlan: "FREE", trial: { active: true, available: false, days: 14 } });
    expect((await request(app).post("/billing/trial").set(admin.auth)).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "billing.trial_started" } })).toBe(1);

    for (let i = 0; i < 4; i++) await project(admin, `T${i}`).expect(201); // 5 active: fine on Pro
    await prisma.organization.update({ where: { id: admin.orgId! }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    const after = (await request(app).get("/billing").set(admin.auth)).body;
    expect(after).toMatchObject({ plan: "FREE", trial: { active: false, available: false }, usage: { projects: 5 } });
    expect((await project(admin, "One more")).status).toBe(402);
    expect((await request(app).get("/projects").set(admin.auth)).body).toHaveLength(5); // nothing removed

    expect(effectivePlan({ plan: "BUSINESS", trialEndsAt: new Date(Date.now() + 1e6) })).toBe("BUSINESS"); // a trial never lowers a paid plan
  });
});

describe("Branding", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  it("needs a paid plan or trial; colours must keep white button text readable; logos are sniffed", async () => {
    const admin = await signUp();
    const member = await addMember(admin, "MEMBER");
    expect((await request(app).patch("/orgs/current/branding").set(admin.auth).send({ brandColor: "#1d4ed8" })).status).toBe(402);
    expect((await request(app).put("/orgs/current/branding/logo").set(admin.auth).attach("file", PNG, "logo.png")).status).toBe(402);
    await request(app).post("/billing/trial").set(admin.auth).expect(200);

    expect((await request(app).patch("/orgs/current/branding").set(member.auth).send({ brandColor: "#1d4ed8" })).status).toBe(403);
    expect((await request(app).patch("/orgs/current/branding").set(admin.auth).send({ brandColor: "#fde047" })).body.message).toMatch(/too light/);
    expect((await request(app).patch("/orgs/current/branding").set(admin.auth).send({ brandColor: "blue" })).status).toBe(400);
    expect((await request(app).patch("/orgs/current/branding").set(admin.auth).send({ brandColor: "#1D4ED8" }).expect(200)).body).toMatchObject({ brandColor: "#1d4ed8", hasLogo: false });

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await request(app).put("/orgs/current/branding/logo").set(admin.auth).attach("file", svg, "logo.svg")).body.message).toMatch(/PNG, JPEG or WebP/);
    expect((await request(app).put("/orgs/current/branding/logo").set(admin.auth).attach("file", Buffer.from("not an image"), { filename: "logo.png", contentType: "image/png" })).status).toBe(400);
    expect((await request(app).put("/orgs/current/branding/logo").set(admin.auth).attach("file", Buffer.concat([PNG, Buffer.alloc(600 * 1024)]), "big.png")).status).toBe(400);
    await request(app).put("/orgs/current/branding/logo").set(admin.auth).attach("file", PNG, "logo.png").expect(200);

    const got = await request(app).get("/orgs/current/branding/logo").set(member.auth).expect(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-security-policy"]).toBe("default-src 'none'");
    // Another organization only ever gets its own (none)
    const outsider = await signUp();
    expect((await request(app).get("/orgs/current/branding/logo").set(outsider.auth)).status).toBe(404);
    expect((await request(app).get("/orgs/current/branding").set(outsider.auth)).body).toMatchObject({ brandColor: null, hasLogo: false });

    await request(app).delete("/orgs/current/branding/logo").set(admin.auth).expect(200);
    expect((await request(app).get("/orgs/current/branding/logo").set(member.auth)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: "branding.updated" } })).toBe(3);
  });
});

// ─── Stripe (test mode) ──────────────────────────────────────────────────────

describe("Billing with Stripe", () => {
  const SECRET = "whsec_test_secret";
  const saved = { ...mutableConfig };
  beforeAll(() => {
    Object.assign(mutableConfig, { STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_BUSINESS: "price_biz" });
  });
  afterAll(() => {
    for (const k of ["STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO", "STRIPE_PRICE_BUSINESS"]) mutableConfig[k] = saved[k];
  });

  const subs = new Map<string, Partial<Stripe.Subscription>>();
  const fake = {
    customers: { create: jest.fn(async () => ({ id: "cus_1" })) },
    checkout: { sessions: { create: jest.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" })) } },
    billingPortal: { sessions: { create: jest.fn(async () => ({ url: "https://billing.stripe.com/p/session/test_1" })) } },
    subscriptions: { retrieve: jest.fn(async (id: string) => subs.get(id)) },
  };
  const sub = (id: string, status: string, price: string, orgId: string, customer = "cus_1") =>
    subs.set(id, { id, status: status as Stripe.Subscription.Status, customer, cancel_at_period_end: false, metadata: { organizationId: orgId }, items: { data: [{ price: { id: price }, current_period_end: 1_900_000_000 }] } as never });
  const hook = (event: object, secret = SECRET) => {
    const payload = JSON.stringify(event);
    return request(app).post("/billing/webhook").set("content-type", "application/json").set("stripe-signature", Stripe.webhooks.generateTestHeaderString({ payload, secret })).send(payload);
  };
  const subEvent = (id: string, type: string, subId: string, orgId: string, customer = "cus_1") => ({ id, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object: { id: subId, object: "subscription", customer, metadata: { organizationId: orgId }, status: "active", items: { data: [] } } } });

  beforeEach(() => {
    subs.clear();
    Object.values(fake).forEach((g) => Object.values(g).forEach((f) => (typeof f === "function" ? (f as jest.Mock).mockClear() : Object.values(f).forEach((x) => (x as jest.Mock).mockClear()))));
  });

  it("without Stripe the billing page says so and checkout is refused", async () => {
    const admin = await signUp();
    const client = await addMember(admin, "CLIENT");
    expect((await request(app).get("/billing").set(client.auth)).status).toBe(403);
    expect((await request(app).get("/billing").set(admin.auth)).body).toMatchObject({ plan: "FREE", billing: { configured: false, purchasable: [] }, trial: { available: true } });
    expect((await request(app).post("/billing/checkout").set(admin.auth).send({ plan: "PRO" })).status).toBe(503);
  });

  it("checkout creates one customer and a subscription checkout tied to the organization; admins only", async () => {
    setStripeForTests(fake as unknown as Stripe);
    const admin = await signUp();
    const pm = await addMember(admin, "PROJECT_MANAGER");
    expect((await request(app).post("/billing/checkout").set(pm.auth).send({ plan: "PRO" })).status).toBe(403);
    expect((await request(app).post("/billing/checkout").set(admin.auth).send({ plan: "FREE" })).status).toBe(400);
    const r = await request(app).post("/billing/checkout").set(admin.auth).send({ plan: "PRO" }).expect(200);
    expect(r.body.url).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(fake.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ mode: "subscription", customer: "cus_1", client_reference_id: admin.orgId, line_items: [{ price: "price_pro", quantity: 1 }], subscription_data: { metadata: { organizationId: admin.orgId } } }));
    await request(app).post("/billing/checkout").set(admin.auth).send({ plan: "BUSINESS" }).expect(200);
    expect(fake.customers.create).toHaveBeenCalledTimes(1); // reused
    expect((await request(app).post("/billing/portal").set(admin.auth).expect(200)).body.url).toMatch(/billing\.stripe\.com/);
    // Nothing changes until Stripe confirms through the webhook
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: admin.orgId! } })).plan).toBe("FREE");
  });

  it("signed webhooks set the plan, exactly once, from Stripe's current state", async () => {
    setStripeForTests(fake as unknown as Stripe);
    const admin = await signUp();
    await prisma.organization.update({ where: { id: admin.orgId! }, data: { stripeCustomerId: "cus_1" } });
    sub("sub_1", "active", "price_pro", admin.orgId!);

    // Bad or missing signatures are rejected before anything is read
    expect((await hook(subEvent("evt_x", "customer.subscription.updated", "sub_1", admin.orgId!), "whsec_wrong")).status).toBe(400);
    expect((await request(app).post("/billing/webhook").set("content-type", "application/json").send("{}")).status).toBe(400);
    expect(fake.subscriptions.retrieve).not.toHaveBeenCalled();

    const e1 = subEvent("evt_1", "customer.subscription.created", "sub_1", admin.orgId!);
    expect((await hook(e1).expect(200)).body).toMatchObject({ handled: true, plan: "PRO" });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: admin.orgId! } })).toMatchObject({ plan: "PRO", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", currentPeriodEnd: new Date(1_900_000_000_000) });
    expect((await hook(e1).expect(200)).body).toMatchObject({ duplicate: true }); // redelivery
    expect(await prisma.auditLog.count({ where: { action: "billing.plan_changed" } })).toBe(1);

    // Out of order: an old "active" event arrives after cancellation; Stripe's current state wins
    sub("sub_1", "canceled", "price_pro", admin.orgId!);
    await hook(subEvent("evt_2", "customer.subscription.updated", "sub_1", admin.orgId!)).expect(200);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: admin.orgId! } })).toMatchObject({ plan: "FREE", stripeSubscriptionId: null, subscriptionStatus: "canceled" });

    // past_due keeps the plan while Stripe retries the payment
    sub("sub_2", "past_due", "price_biz", admin.orgId!);
    await hook(subEvent("evt_3", "customer.subscription.updated", "sub_2", admin.orgId!)).expect(200);
    expect((await request(app).get("/billing").set(admin.auth)).body).toMatchObject({ plan: "BUSINESS", subscription: { status: "past_due" } });
  });

  it("a subscription can't be moved onto another organization", async () => {
    setStripeForTests(fake as unknown as Stripe);
    const victim = await signUp();
    await prisma.organization.update({ where: { id: victim.orgId! }, data: { stripeCustomerId: "cus_victim" } });
    // Attacker-controlled metadata names the victim's org, but the customer is someone else's
    sub("sub_evil", "active", "price_biz", victim.orgId!, "cus_attacker");
    expect((await hook(subEvent("evt_e", "customer.subscription.created", "sub_evil", victim.orgId!, "cus_attacker")).expect(200)).body).toMatchObject({ handled: false });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: victim.orgId! } })).plan).toBe("FREE");
  });
});

