import { Router } from "express";
import { validate } from "../../core/validate";
import { authRateLimit, requireCsrfHeader } from "../../core/security";
import { authenticate, currentAuth } from "../../core/auth";
import { AppError, notFound } from "../../core/errors";
import { prisma } from "../../core/prisma";
import { audit } from "../../core/audit";
import { tokenParamSchema } from "../../core/schemas";
import { sha256 } from "../../core/crypto";
import * as auth from "./auth.service";
import {
  REFRESH_COOKIE,
  buildAuthPayload,
  clearRefreshCookie,
  refreshSession,
  revokeAllSessions,
  revokeSession,
  switchSessionOrganization,
} from "./sessions";
import {
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  sessionIdParams,
  switchOrganizationBody,
  verifyEmailBody,
} from "./auth.schemas";

export const authRouter = Router();

// Separate buckets so a burst on one endpoint doesn't block the others
const loginLimiter = authRateLimit();
const registerLimiter = authRateLimit();
const resetLimiter = authRateLimit();
const emailLimiter = authRateLimit();
// Refresh happens every few minutes per open tab, so it gets a much larger budget
const refreshLimiter = authRateLimit(20);

// ─── Public ──────────────────────────────────────────────────────────────────

authRouter.post("/register", registerLimiter, validate({ body: registerBody }), async (req, res) => {
  await auth.register(req, req.body);
  res.status(201).json({ message: auth.REGISTER_MESSAGE });
});

authRouter.post("/login", loginLimiter, validate({ body: loginBody }), async (req, res) => {
  res.status(200).json(await auth.login(req, res, req.body.email, req.body.password));
});

authRouter.post("/refresh", refreshLimiter, requireCsrfHeader, async (req, res) => {
  res.status(200).json(await refreshSession(req, res, req.cookies?.[REFRESH_COOKIE]));
});

/** Ends the session identified by the refresh cookie (works even if the access token has expired). */
authRouter.post("/logout", requireCsrfHeader, async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw === "string") {
    const session = await prisma.session.findUnique({ where: { refreshTokenHash: sha256(raw) } });
    if (session) {
      await revokeSession(session.id, "logout");
      await audit(req, { action: "auth.logout", actorId: session.userId, targetType: "session", targetId: session.id });
    }
  }
  clearRefreshCookie(res);
  res.status(200).json({ message: "Signed out" });
});

authRouter.post("/verify-email", emailLimiter, validate({ body: verifyEmailBody }), async (req, res) => {
  await auth.verifyEmail(req, req.body.token);
  res.status(200).json({ message: "Email verified" });
});

authRouter.post("/forgot-password", resetLimiter, validate({ body: forgotPasswordBody }), async (req, res) => {
  await auth.requestPasswordReset(req, req.body.email);
  res.status(200).json({
    message: "If an account exists for that email, a password reset link has been sent.",
  });
});

authRouter.get("/reset-user/:token", resetLimiter, validate({ params: tokenParamSchema }), async (req, res) => {
  res.status(200).json(await auth.getResetUserEmail(req.params.token as string));
});

authRouter.post(
  "/reset-password/:token",
  resetLimiter,
  validate({ params: tokenParamSchema, body: resetPasswordBody }),
  async (req, res) => {
    await auth.resetPassword(req, req.params.token as string, req.body.password);
    res.status(200).json({ message: "Password reset successful. Please sign in with your new password." });
  }
);

// ─── Authenticated ───────────────────────────────────────────────────────────

authRouter.get("/me", authenticate, async (req, res) => {
  const { userId, sessionId, organizationId } = currentAuth(req);
  res.status(200).json(await buildAuthPayload(userId, sessionId, organizationId));
});

authRouter.post("/resend-verification", authenticate, emailLimiter, async (req, res) => {
  await auth.resendVerification(currentAuth(req).userId);
  res.status(200).json({ message: "Verification email sent" });
});

authRouter.post("/switch-organization", authenticate, validate({ body: switchOrganizationBody }), async (req, res) => {
  const { userId, sessionId } = currentAuth(req);
  const { organizationId } = req.body;

  // The membership check is the authorisation: an org id the user doesn't belong to is rejected
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!membership) throw new AppError(403, "NOT_A_MEMBER", "You are not a member of that organization");

  const payload = await switchSessionOrganization(userId, sessionId, organizationId);
  await audit(req, { action: "org.switched", organizationId, targetType: "organization", targetId: organizationId });
  res.status(200).json(payload);
});

authRouter.get("/sessions", authenticate, async (req, res) => {
  const { userId, sessionId } = currentAuth(req);
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true },
  });
  res.status(200).json(sessions.map((s) => ({ ...s, current: s.id === sessionId })));
});

authRouter.delete("/sessions/:id", authenticate, validate({ params: sessionIdParams }), async (req, res) => {
  const { userId } = currentAuth(req);
  const id = req.params.id as string;
  // Scoped to the caller: another user's session id is indistinguishable from a missing one
  const session = await prisma.session.findFirst({ where: { id, userId, revokedAt: null } });
  if (!session) throw notFound("Session not found");

  await revokeSession(id, "revoked_by_user");
  await audit(req, { action: "session.revoked", targetType: "session", targetId: id });
  res.status(200).json({ message: "Session revoked" });
});

authRouter.post("/logout-all", authenticate, async (req, res) => {
  const { userId } = currentAuth(req);
  await revokeAllSessions(userId, "logout_all");
  await audit(req, { action: "auth.logout_all", targetType: "user", targetId: userId });
  clearRefreshCookie(res);
  res.status(200).json({ message: "Signed out of all devices" });
});
