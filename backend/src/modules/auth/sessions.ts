import type { Request, Response } from "express";
import { prisma } from "../../core/prisma";
import { config } from "../../core/config";
import { randomToken, sha256 } from "../../core/crypto";
import { AppError, unauthorized } from "../../core/errors";
import { signAccessToken } from "../../core/auth";
import { ROLE_PERMISSIONS } from "../../core/rbac";
import { audit } from "../../core/audit";

export const REFRESH_COOKIE = "tf_refresh";
const DAY_MS = 24 * 60 * 60 * 1000;
/** A rotated-out token presented within this window is treated as a benign race between tabs. */
const ROTATION_GRACE_MS = 30 * 1000;

const refreshExpiry = () => new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * DAY_MS);

export const setRefreshCookie = (res: Response, token: string) => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true, // unreadable by JavaScript, so XSS can't steal it
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/auth", // only sent to the endpoints that need it
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
  });
};

export const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: "strict", path: "/auth" });
};

const clientMeta = (req: Request) => ({
  userAgent: req.get("user-agent")?.slice(0, 256) ?? null,
  ipAddress: req.ip?.slice(0, 64) ?? null,
});

/** Picks the organisation to activate: the requested one if the user belongs to it, else their first. */
const resolveActiveOrganization = async (userId: number, preferred?: string | null) => {
  if (preferred) {
    const m = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: preferred, userId } },
      select: { organizationId: true },
    });
    if (m) return m.organizationId;
  }
  const first = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return first?.organizationId ?? null;
};

/** Everything the client needs after login/refresh/switch: identity, tenant, role, permissions. */
export const buildAuthPayload = async (userId: number, sessionId: string, organizationId: string | null) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerifiedAt: true,
      isSuperAdmin: true,
      memberships: {
        orderBy: { createdAt: "asc" },
        select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  const organizations = user.memberships.map((m) => ({ ...m.organization, role: m.role }));
  const active = organizations.find((o) => o.id === organizationId) ?? null;

  return {
    accessToken: signAccessToken({ userId, sessionId, organizationId: active?.id ?? null }),
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: Boolean(user.emailVerifiedAt),
      isSuperAdmin: user.isSuperAdmin,
    },
    organization: active,
    organizations,
    permissions: active ? ROLE_PERMISSIONS[active.role] : [],
  };
};

export type AuthPayload = Awaited<ReturnType<typeof buildAuthPayload>>;

export const createSession = async (req: Request, res: Response, userId: number, preferredOrg?: string | null) => {
  const refreshToken = randomToken();
  const organizationId = await resolveActiveOrganization(userId, preferredOrg);

  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      activeOrganizationId: organizationId,
      expiresAt: refreshExpiry(),
      ...clientMeta(req),
    },
  });

  setRefreshCookie(res, refreshToken);
  return buildAuthPayload(userId, session.id, organizationId);
};

/**
 * Refresh-token rotation with reuse detection (OAuth 2.0 Security BCP §4.14):
 * every refresh issues a new token and retires the old one. If a retired token
 * shows up again later, someone else has a copy, so the whole session is revoked.
 */
export const refreshSession = async (req: Request, res: Response, rawToken: string | undefined) => {
  if (!rawToken || !/^[a-f0-9]{64}$/.test(rawToken)) {
    throw unauthorized("Please sign in again.", "SESSION_INVALID");
  }
  const hash = sha256(rawToken);
  const now = new Date();

  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash } });

  if (session) {
    if (session.revokedAt || session.expiresAt <= now) {
      clearRefreshCookie(res);
      throw unauthorized("Please sign in again.", "SESSION_INVALID");
    }

    const next = randomToken();
    // Conditional update: if two requests race with the same token, only one wins
    const { count } = await prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: {
        refreshTokenHash: sha256(next),
        previousTokenHash: hash,
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt: refreshExpiry(),
        ...clientMeta(req),
      },
    });
    if (count === 0) throw new AppError(409, "REFRESH_RACE", "Session refresh in progress, please retry");

    setRefreshCookie(res, next);
    const organizationId = await resolveActiveOrganization(session.userId, session.activeOrganizationId);
    if (organizationId !== session.activeOrganizationId) {
      await prisma.session.update({ where: { id: session.id }, data: { activeOrganizationId: organizationId } });
    }
    return buildAuthPayload(session.userId, session.id, organizationId);
  }

  const retired = await prisma.session.findUnique({ where: { previousTokenHash: hash } });
  if (retired && !retired.revokedAt) {
    const withinGrace = retired.rotatedAt && now.getTime() - retired.rotatedAt.getTime() < ROTATION_GRACE_MS;
    if (withinGrace) {
      // Two tabs refreshed at once; the browser already holds the newer cookie.
      throw new AppError(409, "REFRESH_RACE", "Session refresh in progress, please retry");
    }
    await prisma.session.update({
      where: { id: retired.id },
      data: { revokedAt: now, revokedReason: "refresh_token_reuse" },
    });
    await audit(req, {
      action: "auth.refresh_reuse_detected",
      actorId: retired.userId,
      targetType: "session",
      targetId: retired.id,
    });
  }

  clearRefreshCookie(res);
  throw unauthorized("Please sign in again.", "SESSION_INVALID");
};

export const revokeSession = (sessionId: string, reason: string) =>
  prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });

export const revokeAllSessions = (userId: number, reason: string, exceptSessionId?: string) =>
  prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });

/** Points the session at an organisation (verified membership) and returns a fresh access token. */
export const switchSessionOrganization = async (userId: number, sessionId: string, organizationId: string | null) => {
  await prisma.session.update({ where: { id: sessionId }, data: { activeOrganizationId: organizationId } });
  return buildAuthPayload(userId, sessionId, organizationId);
};

/** After membership changes, move the session to a valid organisation (or none). */
export const reselectOrganization = async (userId: number, sessionId: string) => {
  const organizationId = await resolveActiveOrganization(userId, null);
  return switchSessionOrganization(userId, sessionId, organizationId);
};
