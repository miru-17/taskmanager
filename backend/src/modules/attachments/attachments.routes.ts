import { Router, type Request, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticate, currentAuth } from "../../core/auth";
import { requireTenant, currentTenant } from "../../core/tenant";
import { requirePermission } from "../../core/rbac";
import { validate } from "../../core/validate";
import { cuidSchema } from "../../core/schemas";
import { AppError } from "../../core/errors";
import { config } from "../../core/config";
import type { Actor } from "../../core/access";
import * as files from "./attachments.service";
import { isInline } from "./filetypes";

const actor = (req: Request): Actor => ({ userId: currentAuth(req).userId, tenant: currentTenant(req) });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5, parts: 6 },
});

/** Multer errors → clear 4xx responses instead of a 500. */
const singleFile: RequestHandler = (req, res, next) =>
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new AppError(413, "FILE_TOO_LARGE", `Files can be at most ${config.MAX_UPLOAD_MB} MB`));
      return next(new AppError(400, "BAD_UPLOAD", "Upload one file in the \"file\" field"));
    }
    next(err);
  });

const taskParams = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });
const attachmentParams = z.object({ attachmentId: cuidSchema });
const downloadQuery = z.object({ inline: z.enum(["1"]).optional() });

/** Mounted at /tasks/:id/attachments */
export const taskAttachmentsRouter = Router({ mergeParams: true });
taskAttachmentsRouter.use(authenticate, requireTenant);

taskAttachmentsRouter.get("/", requirePermission("tasks:read"), validate({ params: taskParams }), async (req, res) => {
  res.json(await files.listAttachments(actor(req), req.params.id as unknown as number));
});

// Auth and permission checks run before multer reads the body, so anonymous uploads are never buffered
taskAttachmentsRouter.post("/", requirePermission("tasks:update_any", "tasks:update_own"), validate({ params: taskParams }), singleFile, async (req, res) => {
  res.status(201).json(await files.uploadAttachment(req, actor(req), req.params.id as unknown as number, req.file));
});

/** Mounted at /attachments */
export const attachmentsRouter = Router();
attachmentsRouter.use(authenticate, requireTenant);

attachmentsRouter.get("/usage", async (req, res) => {
  res.json(await files.storageUsage(currentTenant(req).organizationId));
});

attachmentsRouter.get("/:attachmentId/download", requirePermission("tasks:read"), validate({ params: attachmentParams, query: downloadQuery }), async (req, res) => {
  const { attachment, stream } = await files.openAttachment(actor(req), req.params.attachmentId as string);
  const inline = res.locals.query.inline === "1" && isInline(attachment.mimeType);
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Length", String(attachment.size));
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
  // User content: never sniffed, never scripted, never cached by shared caches
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  stream.on("error", () => res.destroy());
  stream.pipe(res);
});

attachmentsRouter.delete("/:attachmentId", validate({ params: attachmentParams }), async (req, res) => {
  await files.deleteAttachment(req, actor(req), req.params.attachmentId as string);
  res.json({ message: "File removed" });
});
