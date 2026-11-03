import { z } from "zod";

export const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .pipe(z.email({ error: "Invalid email format" }));

// Phase 2 raises this to a stronger policy alongside Argon2id
export const newPasswordSchema = z
  .string({ error: "Password is required" })
  .min(6, "Password must be at least 6 characters")
  .max(128, "Password must be at most 128 characters");

export const idParamSchema = z.object({
  id: z.coerce
    .number({ error: "Invalid id" })
    .int("Invalid id")
    .positive("Invalid id")
    .max(2_147_483_647, "Invalid id"),
});
