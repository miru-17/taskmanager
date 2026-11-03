import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config";
import { unauthorized } from "./errors";

export interface AuthUser {
  id: number;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

const ALGORITHM = "HS256" as const;

export const signAccessToken = (user: AuthUser): string =>
  jwt.sign({ id: user.id, email: user.email }, config.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Access token required", "TOKEN_MISSING");
  }

  try {
    const decoded = jwt.verify(header.slice(7), config.JWT_SECRET, {
      algorithms: [ALGORITHM], // pin the algorithm; never accept "none" or asymmetric confusion
    }) as jwt.JwtPayload;

    if (typeof decoded.id !== "number" || typeof decoded.email !== "string") {
      throw new Error("Malformed token payload");
    }
    req.user = { id: decoded.id, email: decoded.email };
    next();
  } catch {
    throw unauthorized("Invalid or expired token", "TOKEN_INVALID");
  }
};

/** Use only after `authenticate`; narrows req.user to non-null. */
export const currentUser = (req: Request): AuthUser => {
  if (!req.user) throw unauthorized();
  return req.user;
};
