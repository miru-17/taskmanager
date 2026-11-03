import { z } from "zod";
import { cuidSchema, emailSchema, newPasswordSchema, passwordInputSchema } from "../../core/schemas";

const optionalName = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const registerBody = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  name: optionalName(100, "Name"),
  organizationName: optionalName(100, "Organization name"),
  inviteToken: z.string().regex(/^[a-f0-9]{64}$/, "This invitation is invalid or has expired").optional(),
});

export const loginBody = z.object({
  email: emailSchema,
  password: passwordInputSchema,
});

export const forgotPasswordBody = z.object({ email: emailSchema });

export const resetPasswordBody = z.object({ password: newPasswordSchema });

export const verifyEmailBody = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, "This link is invalid or has expired"),
});

export const switchOrganizationBody = z.object({ organizationId: cuidSchema });

export const sessionIdParams = z.object({ id: cuidSchema });
