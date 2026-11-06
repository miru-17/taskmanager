import type { OrgRole, Plan, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { AppError } from "./errors";

/**
 * Plans and their limits live in code (versioned and tested with the checks that use them).
 * Every limit is enforced here, on the server; the UI only displays them.
 * null = unlimited.
 */
export interface PlanLimits {
  /** Internal people (every role except Client), including pending invitations */
  members: number | null;
  /** External clients, including pending invitations */
  clients: number | null;
  /** Projects that aren't archived */
  projects: number | null;
  storageMb: number;
  /** Enabled automation rules across the organization */
  automations: number | null;
  /** AI model calls per calendar month (rule-based answers are free and unlimited) */
  aiRequestsPerMonth: number | null;
  /** Custom logo and brand colour */
  branding: boolean;
}

export const PLANS: Record<Plan, { name: string; priceNote: string; limits: PlanLimits }> = {
  FREE: { name: "Free", priceNote: "Free", limits: { members: 5, clients: 2, projects: 3, storageMb: 500, automations: 3, aiRequestsPerMonth: 50, branding: false } },
  PRO: { name: "Pro", priceNote: "Billed monthly through Stripe", limits: { members: 25, clients: 25, projects: 50, storageMb: 10_240, automations: 50, aiRequestsPerMonth: 2_000, branding: true } },
  BUSINESS: { name: "Business", priceNote: "Billed monthly through Stripe", limits: { members: null, clients: null, projects: null, storageMb: 102_400, automations: null, aiRequestsPerMonth: 20_000, branding: true } },
};
export const TRIAL_PLAN: Plan = "PRO";
export const TRIAL_DAYS = 14;
const RANK: Record<Plan, number> = { FREE: 0, PRO: 1, BUSINESS: 2 };

type Db = Prisma.TransactionClient | typeof prisma;
type OrgPlanFields = { plan: Plan; trialEndsAt: Date | null };

/** The plan in force now: a running trial lifts the organization to Pro (never lowers a paid plan). */
export const effectivePlan = (o: OrgPlanFields, now = new Date()): Plan =>
  o.trialEndsAt && o.trialEndsAt > now && RANK[TRIAL_PLAN] > RANK[o.plan] ? TRIAL_PLAN : o.plan;

export const limitsFor = async (organizationId: string, db: Db = prisma) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plan: true, trialEndsAt: true } });
  const plan = effectivePlan(org);
  return { plan, limits: PLANS[plan].limits };
};

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

const seatKind = (role: OrgRole) => (role === "CLIENT" ? ("clients" as const) : ("members" as const));
const seatWhere = (kind: "members" | "clients") => (kind === "clients" ? { role: "CLIENT" as const } : { role: { not: "CLIENT" as const } });

export const usageFor = async (organizationId: string, db: Db = prisma) => {
  const now = new Date();
  const pending = { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
  const [members, clients, pendingMembers, pendingClients, projects, storage, automations, ai] = await Promise.all([
    db.membership.count({ where: { organizationId, ...seatWhere("members") } }),
    db.membership.count({ where: { organizationId, ...seatWhere("clients") } }),
    db.invitation.count({ where: { ...pending, ...seatWhere("members") } }),
    db.invitation.count({ where: { ...pending, ...seatWhere("clients") } }),
    db.project.count({ where: { organizationId, status: { not: "ARCHIVED" } } }),
    db.attachment.aggregate({ where: { organizationId }, _sum: { size: true } }),
    db.automationRule.count({ where: { organizationId, enabled: true } }),
    db.aiUsage.findUnique({ where: { organizationId_month: { organizationId, month: monthKey(now) } }, select: { count: true } }),
  ]);
  return { members, clients, pendingMembers, pendingClients, projects, storageBytes: storage._sum.size ?? 0, automations, aiThisMonth: ai?.count ?? 0 };
};

const LABEL = { members: "team members", clients: "clients", projects: "active projects", automations: "active automations" } as const;

/** 402 with enough detail for the UI to explain the limit and offer an upgrade. */
export const planLimit = (plan: Plan, what: keyof typeof LABEL | "storage" | "branding" | "ai", limit: number | null, used?: number) =>
  new AppError(
    402,
    "PLAN_LIMIT",
    what === "branding"
      ? `Custom branding isn't included in the ${PLANS[plan].name} plan. Upgrade to use it.`
      : what === "storage"
        ? `Your organization has used the ${limit} MB of file storage in the ${PLANS[plan].name} plan. Delete files or upgrade.`
        : what === "ai"
          ? `This month's ${limit} AI requests in the ${PLANS[plan].name} plan are used up.`
          : `The ${PLANS[plan].name} plan includes up to ${limit} ${LABEL[what]}. Upgrade, or ${what === "projects" ? "archive a project" : what === "automations" ? "turn another automation off" : "remove someone"} first.`,
    { limit: what, plan, max: limit, used: used ?? null }
  );

/**
 * Before inviting someone: current people of that kind plus pending invitations must be below the limit.
 * Pending invitations count so a free organization can't send 100 invitations and accept them all.
 */
export const assertCanInvite = async (organizationId: string, role: OrgRole, email: string, db: Db = prisma) => {
  const { plan, limits } = await limitsFor(organizationId, db);
  const kind = seatKind(role);
  const max = limits[kind];
  if (max === null) return;
  // Re-inviting the same address replaces their pending invitation, so it doesn't count twice
  const [people, pending] = await Promise.all([
    db.membership.count({ where: { organizationId, ...seatWhere(kind) } }),
    db.invitation.count({ where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, email: { not: email }, ...seatWhere(kind) } }),
  ]);
  const used = people + pending;
  if (used >= max) throw planLimit(plan, kind, max, used);
};

/** When someone joins (accepting an invitation) or changes between client and internal: actual people only. */
export const assertSeatFree = async (organizationId: string, role: OrgRole, db: Db = prisma) => {
  const { plan, limits } = await limitsFor(organizationId, db);
  const kind = seatKind(role);
  const max = limits[kind];
  if (max === null) return;
  const used = await db.membership.count({ where: { organizationId, ...seatWhere(kind) } });
  if (used >= max) throw planLimit(plan, kind, max, used);
};
export const changesSeatKind = (from: OrgRole, to: OrgRole) => seatKind(from) !== seatKind(to);

/** Serializes limit checks for one organization inside a transaction, so parallel requests can't both pass. */
export const lockOrg = (tx: Prisma.TransactionClient, organizationId: string, what: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${what}:${organizationId}`}))`;

export const assertCanAddProject = async (organizationId: string, db: Db = prisma) => {
  const { plan, limits } = await limitsFor(organizationId, db);
  if (limits.projects === null) return;
  const used = await db.project.count({ where: { organizationId, status: { not: "ARCHIVED" } } });
  if (used >= limits.projects) throw planLimit(plan, "projects", limits.projects, used);
};

export const assertCanEnableAutomation = async (organizationId: string, db: Db = prisma) => {
  const { plan, limits } = await limitsFor(organizationId, db);
  if (limits.automations === null) return;
  const used = await db.automationRule.count({ where: { organizationId, enabled: true } });
  if (used >= limits.automations) throw planLimit(plan, "automations", limits.automations, used);
};

export const assertStorage = async (organizationId: string, addBytes: number, usedBytes: number) => {
  const { plan, limits } = await limitsFor(organizationId);
  if (usedBytes + addBytes > limits.storageMb * 1024 * 1024) throw planLimit(plan, "storage", limits.storageMb);
};

export const assertBranding = async (organizationId: string) => {
  const { plan, limits } = await limitsFor(organizationId);
  if (!limits.branding) throw planLimit(plan, "branding", null);
};

/** True if one more AI model call fits this month's allowance. */
export const aiAllowanceLeft = async (organizationId: string) => {
  const { limits } = await limitsFor(organizationId);
  if (limits.aiRequestsPerMonth === null) return true;
  const row = await prisma.aiUsage.findUnique({ where: { organizationId_month: { organizationId, month: monthKey() } }, select: { count: true } });
  return (row?.count ?? 0) < limits.aiRequestsPerMonth;
};

/** Counts one model call (atomic, so concurrent requests can't lose counts). */
export const recordAiCall = (organizationId: string) =>
  prisma.aiUsage.upsert({
    where: { organizationId_month: { organizationId, month: monthKey() } },
    create: { organizationId, month: monthKey(), count: 1 },
    update: { count: { increment: 1 } },
  });
