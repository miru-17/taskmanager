import type { Request } from "express";
import type Stripe from "stripe";
import { Prisma, type Plan } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { config } from "../../core/config";
import { logger } from "../../core/logger";
import { audit } from "../../core/audit";
import { AppError, badRequest, conflict } from "../../core/errors";
import { PLANS, TRIAL_DAYS, TRIAL_PLAN, effectivePlan, usageFor } from "../../core/plans";
import type { TenantContext } from "../../core/tenant";
import { getStripe, planForPrice, priceFor } from "./stripe";

const orgBilling = (organizationId: string) =>
  prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, name: true, plan: true, trialEndsAt: true, trialUsed: true, stripeCustomerId: true, stripeSubscriptionId: true, subscriptionStatus: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
  });

/** Everything the billing page shows: plan in force, limits, usage, trial and subscription. */
export const summary = async (tenant: TenantContext) => {
  const org = await orgBilling(tenant.organizationId);
  const now = new Date();
  const plan = effectivePlan(org, now);
  const usage = await usageFor(tenant.organizationId);
  const stripe = getStripe();
  return {
    plan,
    paidPlan: org.plan,
    limits: PLANS[plan].limits,
    usage,
    trial: {
      active: Boolean(org.trialEndsAt && org.trialEndsAt > now),
      endsAt: org.trialEndsAt,
      available: !org.trialUsed && org.plan === "FREE",
      days: TRIAL_DAYS,
      plan: TRIAL_PLAN,
    },
    subscription: org.stripeSubscriptionId ? { status: org.subscriptionStatus, currentPeriodEnd: org.currentPeriodEnd, cancelAtPeriodEnd: org.cancelAtPeriodEnd } : null,
    billing: {
      configured: Boolean(stripe),
      testMode: true,
      purchasable: (["PRO", "BUSINESS"] as const).filter((p) => stripe && priceFor(p)),
    },
    plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, { name: v.name, priceNote: v.priceNote, limits: v.limits }])),
  };
};

export const startTrial = async (req: Request, tenant: TenantContext) => {
  const ends = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
  // One trial per organization, ever; only from Free (conditional update, so double clicks can't start two)
  const { count } = await prisma.organization.updateMany({ where: { id: tenant.organizationId, trialUsed: false, plan: "FREE" }, data: { trialUsed: true, trialEndsAt: ends } });
  if (!count) throw conflict("The free trial has already been used, or you're on a paid plan");
  await audit(req, { action: "billing.trial_started", organizationId: tenant.organizationId, targetType: "organization", targetId: tenant.organizationId, metadata: { plan: TRIAL_PLAN, endsAt: ends.toISOString() } });
  return summary(tenant);
};

const requireStripe = () => {
  const s = getStripe();
  if (!s) throw new AppError(503, "BILLING_NOT_CONFIGURED", "Billing isn't set up on this server");
  return s;
};

export const startCheckout = async (req: Request, tenant: TenantContext, userEmail: string, plan: "PRO" | "BUSINESS") => {
  const stripe = requireStripe();
  const price = priceFor(plan);
  if (!price) throw badRequest(`The ${PLANS[plan].name} plan can't be bought on this server yet`);
  const org = await orgBilling(tenant.organizationId);
  if (org.stripeSubscriptionId && org.subscriptionStatus && !["canceled", "incomplete_expired"].includes(org.subscriptionStatus)) {
    throw conflict("You already have a subscription. Change it from the billing portal.");
  }
  let customer = org.stripeCustomerId;
  if (!customer) {
    const c = await stripe.customers.create({ name: org.name, email: userEmail, metadata: { organizationId: org.id } }, { idempotencyKey: `customer:${org.id}` });
    customer = c.id;
    await prisma.organization.update({ where: { id: org.id }, data: { stripeCustomerId: customer } });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: org.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { organizationId: org.id } },
    success_url: `${config.frontendUrl}/settings/billing?checkout=success`,
    cancel_url: `${config.frontendUrl}/settings/billing?checkout=cancelled`,
    allow_promotion_codes: false,
  });
  await audit(req, { action: "billing.checkout_started", organizationId: org.id, targetType: "organization", targetId: org.id, metadata: { plan } });
  if (!session.url) throw new AppError(502, "BILLING_ERROR", "Stripe didn't return a checkout page");
  return { url: session.url };
};

export const openPortal = async (tenant: TenantContext) => {
  const stripe = requireStripe();
  const org = await orgBilling(tenant.organizationId);
  if (!org.stripeCustomerId) throw badRequest("There's no billing account yet. Choose a plan first.");
  const s = await stripe.billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: `${config.frontendUrl}/settings/billing` });
  return { url: s.url };
};

// ─── Webhooks ────────────────────────────────────────────────────────────────

const LIVE = new Set(["active", "trialing", "past_due"]);

/** Stripe's subscription → our plan. Anything not live (canceled, unpaid, expired) means Free. */
export const planFromSubscription = (sub: Stripe.Subscription): Plan => (LIVE.has(sub.status) ? planForPrice(sub.items.data[0]?.price?.id) ?? "FREE" : "FREE");

const periodEnd = (sub: Stripe.Subscription) => {
  const s = sub as unknown as { current_period_end?: number; items: { data: { current_period_end?: number }[] } };
  const t = s.current_period_end ?? s.items.data[0]?.current_period_end;
  return t ? new Date(t * 1000) : null;
};

/**
 * Applies one Stripe event, exactly once. The event id is recorded in the same transaction as the
 * change, so a redelivered event is skipped and a failed one is retried by Stripe. Subscription state
 * is re-read from Stripe rather than trusted from the event, so out-of-order delivery can't regress it.
 */
export const handleEvent = async (event: Stripe.Event) => {
  const stripe = requireStripe();
  let subscriptionId: string | null = null;
  let orgHint: string | null = null;
  let customerId: string | null = null;
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.mode !== "subscription") return { handled: false };
    subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
    orgHint = s.client_reference_id;
    customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
  } else if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    subscriptionId = sub.id;
    orgHint = sub.metadata?.organizationId ?? null;
    customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  } else {
    return { handled: false };
  }
  if (!subscriptionId) return { handled: false };

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const org = await prisma.organization.findFirst({
    where: { OR: [...(orgHint ? [{ id: orgHint }] : []), ...(customerId ? [{ stripeCustomerId: customerId }] : []), { stripeSubscriptionId: subscriptionId }] },
    select: { id: true, plan: true, stripeCustomerId: true },
  });
  if (!org) {
    logger.warn({ eventId: event.id, type: event.type }, "Stripe event for an unknown organization");
    return { handled: false };
  }
  // A customer id must never move a subscription onto a different organization
  if (org.stripeCustomerId && customerId && org.stripeCustomerId !== customerId) {
    logger.warn({ eventId: event.id }, "Stripe customer doesn't match the organization; ignored");
    return { handled: false };
  }
  const plan = planFromSubscription(sub);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
      await tx.organization.update({
        where: { id: org.id },
        data: {
          plan,
          stripeCustomerId: customerId ?? org.stripeCustomerId,
          stripeSubscriptionId: sub.status === "canceled" ? null : sub.id,
          subscriptionStatus: sub.status,
          currentPeriodEnd: periodEnd(sub),
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        },
      });
      if (plan !== org.plan) {
        await tx.auditLog.create({ data: { action: "billing.plan_changed", organizationId: org.id, targetType: "organization", targetId: org.id, metadata: { from: org.plan, to: plan, status: sub.status, via: "stripe" } } });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { handled: true, duplicate: true };
    throw err;
  }
  return { handled: true, plan };
};
