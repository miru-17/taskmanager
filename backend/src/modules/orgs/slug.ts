import crypto from "node:crypto";

/** URL-friendly, unique-enough slug: "Acme Corp" → "acme-corp-k3x9q2". */
export const makeSlug = (name: string): string => {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";
  const suffix = crypto.randomBytes(4).readUInt32BE(0).toString(36).padStart(6, "0").slice(0, 6);
  return `${base}-${suffix}`;
};
