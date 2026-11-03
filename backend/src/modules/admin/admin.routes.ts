import { Router } from "express";
import { authenticate, requireSuperAdmin } from "../../core/auth";
import { prisma } from "../../core/prisma";

/**
 * Platform operator endpoints. Deliberately metadata-only: a Super Admin can see
 * which tenants exist and how big they are, but cannot read any tenant's tasks.
 */
export const adminRouter = Router();
adminRouter.use(authenticate, requireSuperAdmin);

adminRouter.get("/organizations", async (_req, res) => {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: { select: { memberships: true, tasks: true } },
    },
  });
  res.status(200).json(
    orgs.map((o) => ({ ...o, _count: undefined, memberCount: o._count.memberships, taskCount: o._count.tasks }))
  );
});

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      email: true,
      name: true,
      isSuperAdmin: true,
      emailVerifiedAt: true,
      lockedUntil: true,
      createdAt: true,
      _count: { select: { memberships: true } },
    },
  });
  res.status(200).json(
    users.map((u) => ({ ...u, _count: undefined, organizationCount: u._count.memberships }))
  );
});
