/**
 * Operator tool for servers without Stripe (or for support): set an organization's plan.
 *   npm run plan:set -- <organization-slug> <FREE|PRO|BUSINESS>
 * The change is written to the organization's audit log.
 */
import { prisma } from "../src/core/prisma";

const [slug, plan] = process.argv.slice(2);
const PLANS = ["FREE", "PRO", "BUSINESS"] as const;
const main = async () => {
  if (!slug || !PLANS.includes(plan as (typeof PLANS)[number])) {
    console.error("Usage: npm run plan:set -- <organization-slug> <FREE|PRO|BUSINESS>");
    process.exit(2);
  }
  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true, plan: true } });
  if (!org) {
    console.error(`No organization with slug "${slug}"`);
    process.exit(1);
  }
  await prisma.$transaction([
    prisma.organization.update({ where: { id: org.id }, data: { plan: plan as (typeof PLANS)[number] } }),
    prisma.auditLog.create({ data: { action: "billing.plan_changed", organizationId: org.id, targetType: "organization", targetId: org.id, metadata: { from: org.plan, to: plan, via: "operator" } } }),
  ]);
  console.log(`${org.name}: ${org.plan} → ${plan}`);
};
main().finally(() => prisma.$disconnect());
