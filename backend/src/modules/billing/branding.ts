import type { Request } from "express";
import { prisma } from "../../core/prisma";
import { audit } from "../../core/audit";
import { badRequest, notFound } from "../../core/errors";
import { assertBranding } from "../../core/plans";
import { newStorageKey, storage } from "../../core/storage";
import { logger } from "../../core/logger";
import type { TenantContext } from "../../core/tenant";

export const MAX_LOGO_BYTES = 512 * 1024;

/** Logos are sniffed from their bytes, never trusted from the upload's name or type. No SVG: it can carry script. */
export const sniffImage = (b: Buffer): "image/png" | "image/jpeg" | "image/webp" | null => {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
};

const channel = (h: string) => {
  const c = parseInt(h, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** WCAG contrast of a colour against white text (buttons use the brand colour behind white labels). */
export const contrastWithWhite = (hex: string) => {
  const L = 0.2126 * channel(hex.slice(1, 3)) + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7));
  return 1.05 / (L + 0.05);
};
export const MIN_CONTRAST = 4.5;

export const getBranding = async (tenant: TenantContext) => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { id: tenant.organizationId }, select: { name: true, brandColor: true, logoKey: true, updatedAt: true } });
  return { name: o.name, brandColor: o.brandColor, hasLogo: Boolean(o.logoKey), version: o.updatedAt.getTime() };
};

export const setBrandColor = async (req: Request, tenant: TenantContext, brandColor: string | null) => {
  if (brandColor) {
    await assertBranding(tenant.organizationId);
    if (contrastWithWhite(brandColor) < MIN_CONTRAST) {
      throw badRequest(`That colour is too light for white text on buttons (contrast ${contrastWithWhite(brandColor).toFixed(1)}:1, needs ${MIN_CONTRAST}:1). Pick a darker shade.`);
    }
  }
  await prisma.organization.update({ where: { id: tenant.organizationId }, data: { brandColor } });
  await audit(req, { action: "branding.updated", organizationId: tenant.organizationId, targetType: "organization", targetId: tenant.organizationId, metadata: { brandColor } });
  return getBranding(tenant);
};

export const setLogo = async (req: Request, tenant: TenantContext, file: Buffer | undefined) => {
  await assertBranding(tenant.organizationId);
  if (!file?.length) throw badRequest("Choose an image");
  if (file.length > MAX_LOGO_BYTES) throw badRequest("Logos can be at most 512 KB");
  const mime = sniffImage(file);
  if (!mime) throw badRequest("Logos must be PNG, JPEG or WebP images");
  const key = newStorageKey();
  await storage.put(key, file);
  const old = await prisma.organization.findUniqueOrThrow({ where: { id: tenant.organizationId }, select: { logoKey: true } });
  await prisma.organization.update({ where: { id: tenant.organizationId }, data: { logoKey: key, logoMime: mime } });
  if (old.logoKey) await storage.remove(old.logoKey).catch((err) => logger.warn({ err }, "Could not remove old logo"));
  await audit(req, { action: "branding.updated", organizationId: tenant.organizationId, targetType: "organization", targetId: tenant.organizationId, metadata: { logo: "uploaded", bytes: file.length } });
  return getBranding(tenant);
};

export const removeLogo = async (req: Request, tenant: TenantContext) => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { id: tenant.organizationId }, select: { logoKey: true } });
  if (o.logoKey) {
    await prisma.organization.update({ where: { id: tenant.organizationId }, data: { logoKey: null, logoMime: null } });
    await storage.remove(o.logoKey).catch((err) => logger.warn({ err }, "Could not remove logo"));
    await audit(req, { action: "branding.updated", organizationId: tenant.organizationId, targetType: "organization", targetId: tenant.organizationId, metadata: { logo: "removed" } });
  }
  return getBranding(tenant);
};

export const readLogo = async (tenant: TenantContext) => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { id: tenant.organizationId }, select: { logoKey: true, logoMime: true } });
  if (!o.logoKey || !o.logoMime) throw notFound("No logo");
  return { mime: o.logoMime, stream: await storage.read(o.logoKey) };
};
