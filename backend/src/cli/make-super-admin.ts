/**
 * Grants (or with --revoke, removes) platform Super Admin to an existing account.
 *   npx ts-node scripts/make-super-admin.ts someone@example.com [--revoke]
 * Run from a trusted shell only — there is deliberately no API for this.
 */
import { prisma } from "../core/prisma";

const main = async () => {
  const email = process.argv[2]?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  if (!email) {
    console.error("Usage: npm run make-super-admin -- <email> [--revoke]");
    process.exit(1);
  }
  const { count } = await prisma.user.updateMany({ where: { email }, data: { isSuperAdmin: !revoke } });
  console.log(count ? `${email}: Super Admin ${revoke ? "revoked" : "granted"}` : `No account found for ${email}`);
  await prisma.$disconnect();
  process.exit(count ? 0 : 1);
};

void main();
