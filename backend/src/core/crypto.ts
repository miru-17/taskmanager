import crypto from "node:crypto";
import argon2 from "argon2";
import bcrypt from "bcrypt";

/** 256-bit URL-safe random token for emails, invitations and refresh tokens. */
export const randomToken = (): string => crypto.randomBytes(32).toString("hex");

/** Tokens are stored as SHA-256 hashes; a database leak must not yield usable tokens. */
export const sha256 = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");

/**
 * Argon2id with the OWASP-recommended baseline (19 MiB, t=2, p=1).
 * Deliberately modest so a laptop or small VM can handle bursts of logins.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, ARGON2_OPTIONS);

const isBcryptHash = (hash: string) => /^\$2[aby]\$/.test(hash);

/**
 * Verifies against Argon2id, or against a legacy bcrypt hash from before Phase 2.
 * `needsRehash` tells the caller to upgrade the stored hash after a successful login.
 */
export const verifyPassword = async (
  hash: string,
  password: string
): Promise<{ valid: boolean; needsRehash: boolean }> => {
  try {
    if (isBcryptHash(hash)) {
      return { valid: await bcrypt.compare(password, hash), needsRehash: true };
    }
    const valid = await argon2.verify(hash, password);
    return { valid, needsRehash: valid && argon2.needsRehash(hash, ARGON2_OPTIONS) };
  } catch {
    return { valid: false, needsRehash: false };
  }
};

let dummyHash: Promise<string> | null = null;
/** Compared against when an email is unknown, so response time doesn't reveal which emails exist. */
export const getDummyHash = (): Promise<string> =>
  (dummyHash ??= hashPassword("timing-equaliser-not-a-real-password"));
