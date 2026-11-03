import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { prisma } from "../../core/prisma";
import { config } from "../../core/config";
import { badRequest, conflict, unauthorized } from "../../core/errors";
import { signAccessToken } from "../../core/auth";
import { sendMail } from "../../core/mailer";
import { logger } from "../../core/logger";

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

// Compared against when the email is unknown, so login takes the same time either way
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-real-password", BCRYPT_ROUNDS);

/** Reset tokens are stored hashed: a database leak must not yield usable reset links. */
export const hashResetToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

const publicUser = (u: { id: number; email: string }) => ({ id: u.id, email: u.email });

export const register = async (email: string, password: string) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict("Email already registered");

  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, BCRYPT_ROUNDS) },
  });
  return publicUser(user);
};

export const login = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);

  if (!user || !valid) throw unauthorized("Invalid email or password", "INVALID_CREDENTIALS");

  return { token: signAccessToken(publicUser(user)), user: publicUser(user) };
};

/**
 * Always resolves the same way whether or not the account exists,
 * so the endpoint can't be used to discover registered emails.
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    logger.info("Password reset requested for unknown email");
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken: hashResetToken(token),
      resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const link = `${config.FRONTEND_URL.replace(/\/$/, "")}/reset-password/${token}`;
  await sendMail({
    to: user.email,
    subject: "Reset your TaskForge password",
    text: `You requested a password reset. Open this link within 15 minutes: ${link}\nIf you didn't request this, you can ignore this email.`,
    html: `
      <h2>Password reset</h2>
      <p>You requested a password reset.</p>
      <p><a href="${link}">Reset your password</a></p>
      <p>This link expires in 15 minutes. If you didn't request this, you can ignore this email.</p>
    `,
  });
};

const findUserByResetToken = async (token: string) => {
  const user = await prisma.user.findFirst({
    where: { resetToken: hashResetToken(token), resetTokenExpiry: { gt: new Date() } },
  });
  if (!user) throw badRequest("Invalid or expired reset token");
  return user;
};

export const getResetUserEmail = async (token: string) => {
  const user = await findUserByResetToken(token);
  return { email: user.email };
};

export const resetPassword = async (token: string, password: string): Promise<void> => {
  const user = await findUserByResetToken(token);

  // Conditional update: only succeeds if the token is still the current one (single use)
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, resetToken: user.resetToken },
    data: {
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      resetToken: null,
      resetTokenExpiry: null,
    },
  });
  if (count === 0) throw badRequest("Invalid or expired reset token");
};
