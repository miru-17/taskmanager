import Stripe from "stripe";
import type { Plan } from "@prisma/client";
import { config } from "../../core/config";

/** Only test-mode keys are accepted (checked in config); null when billing isn't set up. */
let override: Stripe | null | undefined;
let client: Stripe | null = null;
export const getStripe = (): Stripe | null => {
  if (override !== undefined) return override;
  if (!config.STRIPE_SECRET_KEY) return null;
  client ??= new Stripe(config.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 15_000, appInfo: { name: "TaskForge" } });
  return client;
};
export const setStripeForTests = (s: Stripe | null | undefined) => {
  override = s;
};

export const priceFor = (plan: Plan): string | null => (plan === "PRO" ? config.STRIPE_PRICE_PRO ?? null : plan === "BUSINESS" ? config.STRIPE_PRICE_BUSINESS ?? null : null);
export const planForPrice = (priceId: string | undefined): Plan | null =>
  priceId && priceId === config.STRIPE_PRICE_PRO ? "PRO" : priceId && priceId === config.STRIPE_PRICE_BUSINESS ? "BUSINESS" : null;

/** Webhook signature check (Stripe's own algorithm: HMAC-SHA256 over the raw body, with a 5-minute tolerance). */
export const verifyWebhook = (raw: Buffer, signature: string | undefined): Stripe.Event => {
  if (!config.STRIPE_WEBHOOK_SECRET) throw new Error("Webhook secret not configured");
  if (!signature) throw new Error("Missing Stripe-Signature header");
  return Stripe.webhooks.constructEvent(raw, signature, config.STRIPE_WEBHOOK_SECRET, 300);
};
