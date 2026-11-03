import { z } from "zod";
import { emailSchema, newPasswordSchema } from "../../core/schemas";

export const registerBody = z.object({
  email: emailSchema,
  password: newPasswordSchema,
});

export const loginBody = z.object({
  email: emailSchema,
  password: z.string({ error: "Email and password are required" }).min(1, "Email and password are required").max(128),
});

export const forgotPasswordBody = z.object({
  email: emailSchema,
});

export const resetTokenParams = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid or expired reset token"),
});

export const resetPasswordBody = z.object({
  password: newPasswordSchema,
});
