import express, { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { prisma } from "../../core/prisma";
import { logger } from "../../core/logger";
import * as billing from "./billing.service";
import * as branding from "./branding";
import { verifyWebhook } from "./stripe";

/** Mounted at /billing */
export const billingRouter = Router();
billingRouter.use(authenticate, requireTenant);
// Plan and usage are internal: clients (who have org:read only) don't see them
billingRouter.get("/", requirePermission("members:read"), async (req, res) => {
  res.json(await billing.summary(currentTenant(req)));
});
billingRouter.post("/trial", requirePermission("billing:manage"), async (req, res) => {
  res.json(await billing.startTrial(req, currentTenant(req)));
});
billingRouter.post("/checkout", requirePermission("billing:manage"), validate({ body: z.object({ plan: z.enum(["PRO", "BUSINESS"]) }) }), async (req, res) => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: currentAuth(req).userId }, select: { email: true } });
  res.json(await billing.startCheckout(req, currentTenant(req), me.email, req.body.plan));
});
billingRouter.post("/portal", requirePermission("billing:manage"), async (req, res) => {
  res.json(await billing.openPortal(currentTenant(req)));
});

/**
 * Stripe webhooks: mounted before express.json() because the signature covers the exact raw bytes.
 * No session auth: the signature is the authentication.
 */
export const stripeWebhookHandler = [
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: express.Request, res: express.Response) => {
    let event;
    try {
      event = verifyWebhook(req.body as Buffer, req.header("stripe-signature"));
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Rejected Stripe webhook");
      res.status(400).json({ message: "Invalid signature" });
      return;
    }
    // A failure here returns 500 so Stripe retries; the event isn't marked handled until it succeeds
    const r = await billing.handleEvent(event);
    res.json({ received: true, ...r });
  },
] as const;

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: branding.MAX_LOGO_BYTES, files: 1, fields: 0, parts: 1 } });
const color = z.object({ brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #4f46e5").transform((s) => s.toLowerCase()).nullable() });

/** Mounted at /orgs/current/branding */
export const brandingRouter = Router();
brandingRouter.use(authenticate, requireTenant, requirePermission("org:read"));
brandingRouter.get("/", async (req, res) => {
  res.json(await branding.getBranding(currentTenant(req)));
});
brandingRouter.patch("/", requirePermission("org:update"), validate({ body: color }), async (req, res) => {
  res.json(await branding.setBrandColor(req, currentTenant(req), req.body.brandColor));
});
brandingRouter.put("/logo", requirePermission("org:update"), (req, res, next) =>
  logoUpload.single("file")(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ message: err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? "Logos can be at most 512 KB" : "Upload one image file" });
      return;
    }
    branding.setLogo(req, currentTenant(req), req.file?.buffer).then((b) => res.json(b), next);
  })
);
brandingRouter.delete("/logo", requirePermission("org:update"), async (req, res) => {
  res.json(await branding.removeLogo(req, currentTenant(req)));
});
brandingRouter.get("/logo", async (req, res) => {
  const { mime, stream } = await branding.readLogo(currentTenant(req));
  res.setHeader("Content-Type", mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("Cache-Control", "private, max-age=300");
  stream.pipe(res);
});
