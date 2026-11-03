import type { OrgRole } from "@prisma/client";
import type { Request, RequestHandler } from "express";
import { AppError } from "./errors";
import { prisma } from "./prisma";
import { currentAuth } from "./auth";

export interface TenantContext {
  organizationId: string;
  role: OrgRole;
}

declare module "express-serve-static-core" {
  interface Request {
    tenant?: TenantContext;
  }
}

/**
 * Resolves the tenant for this request. The organisation comes from the signed
 * access token (set server-side on login/switch) and the role is re-read from the
 * database on every request, so a removed member or a demoted admin loses access
 * immediately — even with a still-valid token. Use after `authenticate`.
 */
export const requireTenant: RequestHandler = async (req, _res, next) => {
  const { userId, organizationId } = currentAuth(req);
  if (!organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Create or join an organization first.");
  }

  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  if (!membership) {
    throw new AppError(403, "NOT_A_MEMBER", "You are no longer a member of this organization.");
  }

  req.tenant = { organizationId, role: membership.role };
  next();
};

export const currentTenant = (req: Request): TenantContext => {
  if (!req.tenant) throw new AppError(500, "TENANT_MISSING", "Internal Server Error");
  return req.tenant;
};
