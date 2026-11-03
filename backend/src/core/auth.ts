import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config";
import { AppError, forbidden, unauthorized } from "./errors";
import { prisma } from "./prisma";

export interface AuthContext {
  userId: number;
  sessionId: string;
  /** Active organisation chosen server-side (session), never taken from request input. */
  organizationId: string | null;
  /** When the access token stops being valid (ms since epoch); long-lived streams close then */
  tokenExpiresAt?: number;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

const ALGORITHM = "HS256" as const;
const ISSUER = "taskforge";
const AUDIENCE = "taskforge-api";

interface AccessClaims {
  sub: string;
  sid: string;
  org: string | null;
}

export const signAccessToken = (ctx: AuthContext): string =>
  jwt.sign({ sid: ctx.sessionId, org: ctx.organizationId } satisfies Omit<AccessClaims, "sub">, config.JWT_SECRET, {
    algorithm: ALGORITHM,
    subject: String(ctx.userId),
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  });

const decodeAccessToken = (token: string): AuthContext => {
  const decoded = jwt.verify(token, config.JWT_SECRET, {
    algorithms: [ALGORITHM], // pin the algorithm; never accept "none" or key confusion
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as jwt.JwtPayload & Partial<AccessClaims>;

  const userId = Number(decoded.sub);
  if (!Number.isInteger(userId) || typeof decoded.sid !== "string") {
    throw new Error("Malformed token payload");
  }
  return { userId, sessionId: decoded.sid, organizationId: decoded.org ?? null, tokenExpiresAt: decoded.exp ? decoded.exp * 1000 : undefined };
};

/**
 * Verifies the access token AND that its session is still live, so logout,
 * "sign out everywhere" and password changes take effect immediately rather
 * than when the token expires.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Access token required", "TOKEN_MISSING");
  }

  let ctx: AuthContext;
  try {
    ctx = decodeAccessToken(header.slice(7));
  } catch {
    throw unauthorized("Invalid or expired token", "TOKEN_INVALID");
  }

  const session = await prisma.session.findUnique({
    where: { id: ctx.sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session || session.userId !== ctx.userId || session.revokedAt || session.expiresAt <= new Date()) {
    throw unauthorized("Your session has ended. Please sign in again.", "SESSION_INVALID");
  }

  req.auth = ctx;
  next();
};

export const currentAuth = (req: Request): AuthContext => {
  if (!req.auth) throw unauthorized();
  return req.auth;
};

export const requireSuperAdmin: RequestHandler = async (req, _res, next) => {
  const user = await prisma.user.findUnique({
    where: { id: currentAuth(req).userId },
    select: { isSuperAdmin: true },
  });
  if (!user?.isSuperAdmin) throw forbidden();
  next();
};

export const requireVerifiedEmail = async (userId: number) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  if (!user?.emailVerifiedAt) {
    throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email address before doing this.");
  }
};
