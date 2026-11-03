import { z } from "zod";

export const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .pipe(z.email({ error: "Invalid email format" }));

/**
 * NIST SP 800-63B style policy: length over composition rules, plus a deny-list
 * of the most common passwords. (A breached-password API check can be added later.)
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "11111111", "00000000", "abc12345", "abcd1234",
  "iloveyou", "welcome1", "welcome123", "admin123", "letmein1", "sunshine1", "princess1",
  "football1", "monkey123", "dragon123", "baseball1", "trustno1", "1q2w3e4r", "1qaz2wsx",
  "zaq12wsx", "qwerty12", "asdfghjk", "changeme", "changeme1", "taskforge", "taskforge1",
]);

export const newPasswordSchema = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), {
    message: "This password is too common. Choose something harder to guess.",
  });

export const passwordInputSchema = z
  .string({ error: "Password is required" })
  .min(1, "Password is required")
  .max(128);

export const idParamSchema = z.object({
  id: z.coerce
    .number({ error: "Invalid id" })
    .int("Invalid id")
    .positive("Invalid id")
    .max(2_147_483_647, "Invalid id"),
});

export const cuidSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "Invalid id");

export const tokenParamSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid or expired link"),
});
