import { Router } from "express";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { validate } from "../../core/validate";
import { prisma } from "../../core/prisma";
import { badRequest } from "../../core/errors";
import { newPasswordSchema, passwordInputSchema } from "../../core/schemas";
import { hashPassword, verifyPassword } from "../../core/crypto";
import { audit } from "../../core/audit";
import { revokeAllSessions } from "../auth/sessions";

export const usersRouter = Router();

usersRouter.use(authenticate);

const changePasswordBody = z.object({
  currentPassword: passwordInputSchema,
  newPassword: newPasswordSchema,
});

usersRouter.put("/change-password", validate({ body: changePasswordBody }), async (req, res) => {
  const { userId, sessionId } = currentAuth(req);
  const { currentPassword, newPassword } = req.body;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // 400, not 401: the session is valid; only the submitted field is wrong
  if (!(await verifyPassword(user.password, currentPassword)).valid) {
    throw badRequest("Current password is incorrect");
  }
  if (currentPassword === newPassword) {
    throw badRequest("Choose a password different from your current one");
  }

  await prisma.user.update({ where: { id: userId }, data: { password: await hashPassword(newPassword) } });
  // Keep this device signed in; sign out everywhere else
  await revokeAllSessions(userId, "password_changed", sessionId);
  await audit(req, { action: "auth.password_changed", targetType: "user", targetId: userId });

  res.status(200).json({ message: "Password changed. Other devices have been signed out." });
});

const profileBody = z.object({
  name: z.string().trim().max(100, "Name must be at most 100 characters").nullable(),
});

usersRouter.patch("/profile", validate({ body: profileBody }), async (req, res) => {
  const user = await prisma.user.update({
    where: { id: currentAuth(req).userId },
    data: { name: req.body.name || null },
    select: { id: true, email: true, name: true },
  });
  res.status(200).json(user);
});
