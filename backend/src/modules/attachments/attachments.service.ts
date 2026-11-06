import type { Request } from "express";
import { createHash } from "node:crypto";
import { prisma } from "../../core/prisma";
import { AppError, badRequest, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import { config } from "../../core/config";
import { logger } from "../../core/logger";
import { newStorageKey, storage } from "../../core/storage";
import { canTouchTask, resolveProjectAccess, type Actor } from "../../core/access";
import { editableTask, findVisible } from "../tasks/tasks.service";
import { logActivity } from "../tasks/lifecycle";
import { assertStorage, limitsFor } from "../../core/plans";
import { FILE_TYPES, detect, safeFileName } from "./filetypes";

const MB = 1024 * 1024;
const select = { id: true, fileName: true, mimeType: true, size: true, createdAt: true, uploadedBy: { select: { id: true, email: true, name: true } } } as const;

export const allowedExtensions = Object.keys(FILE_TYPES);

export const listAttachments = async (actor: Actor, taskId: number) => {
  await findVisible(actor, taskId);
  return prisma.attachment.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, select });
};

export const uploadAttachment = async (req: Request, actor: Actor, taskId: number, file: { originalname: string; buffer: Buffer } | undefined) => {
  if (!file) throw badRequest("Choose a file to upload");
  const { task } = await editableTask(actor, taskId);
  if (task.archivedAt) throw badRequest("Unarchive this task before adding files");

  const fileName = safeFileName(Buffer.from(file.originalname, "latin1").toString("utf8"));
  const type = detect(fileName, file.buffer);
  if (!type) throw new AppError(415, "UNSUPPORTED_FILE", `That file type isn't allowed, or its contents don't match its extension. Allowed: ${allowedExtensions.join(", ")}.`);

  const storageKey = newStorageKey();
  let written = false;
  try {
    const attachment = await prisma.$transaction(async (tx) => {
      // One upload at a time per organization, so two parallel uploads can't both slip under the quota
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"upload:" + actor.tenant.organizationId}))`;
      const [count, used] = await Promise.all([
        tx.attachment.count({ where: { taskId } }),
        tx.attachment.aggregate({ where: { organizationId: actor.tenant.organizationId }, _sum: { size: true } }),
      ]);
      if (count >= config.MAX_ATTACHMENTS_PER_TASK) throw badRequest(`A task can have at most ${config.MAX_ATTACHMENTS_PER_TASK} files`);
      if ((used._sum.size ?? 0) + file.buffer.length > config.ORG_STORAGE_QUOTA_MB * MB) {
        throw new AppError(413, "QUOTA_EXCEEDED", `Your organization has used its ${config.ORG_STORAGE_QUOTA_MB} MB of file storage. Delete some files first.`);
      }
      // The plan's storage allowance (the server-wide cap above still applies on top)
      await assertStorage(actor.tenant.organizationId, file.buffer.length, used._sum.size ?? 0);
      // Write the file inside the transaction; if anything after this fails, it's removed again
      await storage.put(storageKey, file.buffer);
      written = true;
      const a = await tx.attachment.create({
        data: {
          organizationId: actor.tenant.organizationId,
          taskId,
          uploadedById: actor.userId,
          fileName,
          mimeType: type.mime,
          size: file.buffer.length,
          storageKey,
          sha256: createHash("sha256").update(file.buffer).digest("hex"),
        },
        select,
      });
      await logActivity(tx, taskId, actor.userId, "attachment_added", { fileName });
      return a;
    });
    await audit(req, { action: "attachment.uploaded", organizationId: actor.tenant.organizationId, targetType: "attachment", targetId: attachment.id, metadata: { taskId, fileName, size: attachment.size } });
    return attachment;
  } catch (err) {
    if (written) await storage.remove(storageKey).catch(() => {});
    throw err;
  }
};

/** Same 404 for a missing file and one on a task you can't see. */
const findAttachment = async (actor: Actor, id: string) => {
  const a = await prisma.attachment.findFirst({ where: { id, organizationId: actor.tenant.organizationId } });
  if (!a) throw notFound("File not found");
  try {
    await findVisible(actor, a.taskId);
  } catch {
    throw notFound("File not found");
  }
  return a;
};

export const openAttachment = async (actor: Actor, id: string) => {
  const a = await findAttachment(actor, id);
  try {
    return { attachment: a, stream: await storage.read(a.storageKey) };
  } catch (err) {
    logger.error({ err, attachmentId: a.id }, "Attachment missing from storage");
    throw notFound("This file is no longer available");
  }
};

/** The uploader (while they can still edit the task) or anyone who can edit every task in the project. */
export const deleteAttachment = async (req: Request, actor: Actor, id: string) => {
  const a = await findAttachment(actor, id);
  const task = await findVisible(actor, a.taskId);
  const caps = await resolveProjectAccess(actor, task.projectId);
  const allowed = caps.editTasks === "any" || (a.uploadedById === actor.userId && canTouchTask(caps, actor, task, "edit"));
  if (!allowed) throw forbidden("You can only remove files you uploaded");

  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id } });
    await logActivity(tx, a.taskId, actor.userId, "attachment_removed", { fileName: a.fileName });
  });
  await storage.remove(a.storageKey).catch((err) => logger.warn({ err, key: a.storageKey }, "Could not remove attachment file"));
  await audit(req, { action: "attachment.deleted", organizationId: actor.tenant.organizationId, targetType: "attachment", targetId: id, metadata: { taskId: a.taskId, fileName: a.fileName } });
  return a.taskId;
};

/** For project deletion: rows go with the cascade, files are removed afterwards. */
export const storageKeysForProject = async (projectId: string) =>
  (await prisma.attachment.findMany({ where: { task: { projectId } }, select: { storageKey: true } })).map((a) => a.storageKey);

export const removeStoredFiles = async (keys: string[]) => {
  for (const k of keys) await storage.remove(k).catch((err) => logger.warn({ err, key: k }, "Could not remove attachment file"));
};

export const storageUsage = async (organizationId: string) => {
  const r = await prisma.attachment.aggregate({ where: { organizationId }, _sum: { size: true }, _count: { _all: true } });
  return { usedBytes: r._sum.size ?? 0, files: r._count._all, quotaBytes: Math.min(config.ORG_STORAGE_QUOTA_MB, (await limitsFor(organizationId)).limits.storageMb) * MB, maxFileBytes: config.MAX_UPLOAD_MB * MB, allowedExtensions };
};
