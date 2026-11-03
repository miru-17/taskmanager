import { createDefaultProject } from "../projects/projects.service";
import type { Request, Response } from "express";
import type { Prisma, UserTokenType } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { config } from "../../core/config";
import { AppError, badRequest, unauthorized } from "../../core/errors";
import { getDummyHash, hashPassword, randomToken, sha256, verifyPassword } from "../../core/crypto";
import { sendMail } from "../../core/mailer";
import { audit } from "../../core/audit";
import { logger } from "../../core/logger";
import { makeSlug } from "../orgs/slug";
import { createSession, revokeAllSessions } from "./sessions";

const HOUR_MS = 60 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const VERIFY_TTL_MS = 24 * HOUR_MS;

export const REGISTER_MESSAGE =
  "Account created. Check your email to verify your address, then sign in.";

// ─── Emailed single-use tokens ───────────────────────────────────────────────

const issueUserToken = async (
  tx: Prisma.TransactionClient,
  userId: number,
  type: UserTokenType,
  ttlMs: number
): Promise<string> => {
  const token = randomToken();
  // Only the newest link of each type works
  await tx.userToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  await tx.userToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
};

const findUsableToken = async (token: string, type: UserTokenType) => {
  const record = await prisma.userToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!record || record.type !== type || record.usedAt || record.expiresAt <= new Date()) {
    throw badRequest("This link is invalid or has expired");
  }
  return record;
};

const sendVerificationEmail = async (email: string, token: string) => {
  const link = `${config.frontendUrl}/verify-email/${token}`;
  await sendMail({
    to: email,
    subject: "Verify your TaskForge email",
    text: `Confirm your email address by opening this link within 24 hours: ${link}`,
    html: `<h2>Welcome to TaskForge</h2><p><a href="${link}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
  });
};

// ─── Registration ─────────────────────────────────────────────────────────────

interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  organizationName?: string;
  inviteToken?: string;
}

/**
 * Creates the account plus either a new organisation (the registrant becomes its admin)
 * or, with an invitation token, a membership in the inviting organisation.
 * The response is identical when the email is already registered, so the endpoint
 * can't be used to discover accounts; the real owner gets a heads-up email instead.
 */
export const register = async (req: Request, input: RegisterInput): Promise<void> => {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    await sendMail({
      to: existing.email,
      subject: "Someone tried to create a TaskForge account with your email",
      text: `An account already exists for this address. If this was you, sign in or reset your password at ${config.frontendUrl}/forgot-password. Otherwise you can ignore this email.`,
      html: `<p>An account already exists for this address.</p><p>If this was you, <a href="${config.frontendUrl}/login">sign in</a> or <a href="${config.frontendUrl}/forgot-password">reset your password</a>. Otherwise you can ignore this email.</p>`,
    });
    return;
  }

  const passwordHash = await hashPassword(input.password);

  if (input.inviteToken) {
    const invitation = await prisma.invitation.findUnique({ where: { tokenHash: sha256(input.inviteToken) } });
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
      throw badRequest("This invitation is invalid or has expired");
    }
    if (invitation.email !== input.email) {
      throw badRequest("Register with the email address the invitation was sent to");
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        // The invitation link reached this inbox, which proves ownership of the address
        data: { email: input.email, password: passwordHash, name: input.name, emailVerifiedAt: new Date() },
      });
      await tx.membership.create({
        data: { organizationId: invitation.organizationId, userId: created.id, role: invitation.role },
      });
      await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      return created;
    });

    await audit(req, { action: "auth.register", actorId: user.id, targetType: "user", targetId: user.id });
    await audit(req, {
      action: "member.joined",
      actorId: user.id,
      organizationId: invitation.organizationId,
      targetType: "user",
      targetId: user.id,
      metadata: { role: invitation.role, via: "invitation" },
    });
    return;
  }

  const orgName = input.organizationName || `${input.name || input.email.split("@")[0]}'s Workspace`;

  const { user, token, organizationId } = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: input.email, password: passwordHash, name: input.name },
    });
    const org = await tx.organization.create({ data: { name: orgName, slug: makeSlug(orgName) } });
    await tx.membership.create({ data: { organizationId: org.id, userId: created.id, role: "ORG_ADMIN" } });
    await createDefaultProject(tx, org.id, created.id);
    const verifyToken = await issueUserToken(tx, created.id, "VERIFY_EMAIL", VERIFY_TTL_MS);
    return { user: created, token: verifyToken, organizationId: org.id };
  });

  await sendVerificationEmail(user.email, token);
  await audit(req, { action: "auth.register", actorId: user.id, targetType: "user", targetId: user.id });
  await audit(req, { action: "org.created", actorId: user.id, organizationId, targetType: "organization", targetId: organizationId });
};

// ─── Login with per-account lockout ──────────────────────────────────────────

export const login = async (req: Request, res: Response, email: string, password: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  const now = new Date();

  if (user?.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000);
    res.setHeader("Retry-After", String(minutes * 60));
    throw new AppError(
      429,
      "ACCOUNT_LOCKED",
      `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`
    );
  }

  const { valid, needsRehash } = await verifyPassword(user?.password ?? (await getDummyHash()), password);

  if (!user || !valid) {
    if (user) {
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      await audit(req, { action: "auth.login_failed", actorId: user.id, targetType: "user", targetId: user.id });

      if (updated.failedLoginCount >= config.LOGIN_LOCKOUT_THRESHOLD) {
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + config.LOGIN_LOCKOUT_MINUTES * 60000) },
        });
        await audit(req, { action: "auth.account_locked", actorId: user.id, targetType: "user", targetId: user.id });
      }
    }
    throw unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      // Transparently upgrade legacy bcrypt (or weaker Argon2) hashes
      ...(needsRehash ? { password: await hashPassword(password) } : {}),
    },
  });

  const payload = await createSession(req, res, user.id);
  await audit(req, { action: "auth.login", actorId: user.id, organizationId: payload.organization?.id, targetType: "user", targetId: user.id });
  return payload;
};

// ─── Email verification ──────────────────────────────────────────────────────

export const verifyEmail = async (req: Request, token: string): Promise<void> => {
  const record = await findUsableToken(token, "VERIFY_EMAIL");
  await prisma.$transaction([
    prisma.userToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  await audit(req, { action: "auth.email_verified", actorId: record.userId, targetType: "user", targetId: record.userId });
};

export const resendVerification = async (userId: number): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) throw badRequest("Your email address is already verified");
  const token = await prisma.$transaction((tx) => issueUserToken(tx, userId, "VERIFY_EMAIL", VERIFY_TTL_MS));
  await sendVerificationEmail(user.email, token);
};

// ─── Password reset ──────────────────────────────────────────────────────────

/** Same response whether or not the account exists. */
export const requestPasswordReset = async (req: Request, email: string): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    logger.info("Password reset requested for unknown email");
    return;
  }

  const token = await prisma.$transaction((tx) => issueUserToken(tx, user.id, "RESET_PASSWORD", RESET_TTL_MS));
  const link = `${config.frontendUrl}/reset-password/${token}`;
  await sendMail({
    to: user.email,
    subject: "Reset your TaskForge password",
    text: `You requested a password reset. Open this link within 15 minutes: ${link}\nIf you didn't request this, you can ignore this email.`,
    html: `<h2>Password reset</h2><p>You requested a password reset.</p><p><a href="${link}">Reset your password</a></p><p>This link expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`,
  });
  await audit(req, { action: "auth.password_reset_requested", actorId: user.id, targetType: "user", targetId: user.id });
};

export const getResetUserEmail = async (token: string) => {
  const record = await findUsableToken(token, "RESET_PASSWORD");
  return { email: record.user.email };
};

export const resetPassword = async (req: Request, token: string, password: string): Promise<void> => {
  const record = await findUsableToken(token, "RESET_PASSWORD");
  const passwordHash = await hashPassword(password);

  // Conditional update: only one request can consume the token
  const consumed = await prisma.userToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) throw badRequest("This link is invalid or has expired");

  await prisma.user.update({
    where: { id: record.userId },
    data: { password: passwordHash, failedLoginCount: 0, lockedUntil: null },
  });
  // Receiving the reset email proves the user controls the address
  await prisma.user.updateMany({
    where: { id: record.userId, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  });
  // Anyone who was signed in with the old password is signed out
  await revokeAllSessions(record.userId, "password_reset");
  await audit(req, { action: "auth.password_reset", actorId: record.userId, targetType: "user", targetId: record.userId });
};
