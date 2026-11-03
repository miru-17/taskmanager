import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { authenticate, currentUser } from "../../core/auth";
import { validate } from "../../core/validate";
import { prisma } from "../../core/prisma";
import { badRequest, notFound } from "../../core/errors";
import { newPasswordSchema } from "../../core/schemas";

export const usersRouter = Router();

const changePasswordBody = z.object({
  currentPassword: z.string({ error: "All fields are required" }).min(1, "All fields are required").max(128),
  newPassword: newPasswordSchema,
});

usersRouter.put(
  "/change-password",
  authenticate,
  validate({ body: changePasswordBody }),
  async (req, res) => {
    const { id } = currentUser(req);
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound("User not found");

    // 400, not 401: the session is valid; only the submitted field is wrong.
    // (A 401 here used to make the frontend log the user out.)
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw badRequest("Current password is incorrect");
    }

    await prisma.user.update({
      where: { id },
      data: { password: await bcrypt.hash(newPassword, 12) },
    });

    res.status(200).json({ message: "Password changed successfully" });
  }
);
