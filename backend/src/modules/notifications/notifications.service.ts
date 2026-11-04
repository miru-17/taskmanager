import type { NotificationType, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../core/prisma";
import { config } from "../../core/config";
import { logger } from "../../core/logger";
import { sendMail } from "../../core/mailer";
import { publish } from "../../core/events";
import { projectAccessWhere, type Actor } from "../../core/access";

export const NOTIFICATION_TYPES = ["MENTIONED", "COMMENTED", "ASSIGNED", "STATUS_CHANGED", "APPROVAL_REQUESTED", "APPROVAL_DECIDED", "DUE_SOON", "AUTOMATION"] as const;
/** Emailed unless the person turns them off: the ones that ask something of you */
export const DEFAULT_EMAIL_TYPES: NotificationType[] = ["MENTIONED", "ASSIGNED", "APPROVAL_REQUESTED"];

export interface NotifyInput {
  orgId: string;
  type: NotificationType;
  actorId: number | null;
  taskId: number;
  userIds: number[];
  /** Extra display data, e.g. { excerpt } or { from, to } */
  data?: Record<string, unknown>;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Turns stored mention tokens back into "@Name" for plain-text contexts (emails, excerpts). */
export const plainText = (body: string) => body.replace(/@\[([^\]]{1,80})\]\(user:\d+\)/g, "@$1");
export const excerpt = (body: string, max = 160) => {
  const t = plainText(body).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const SUBJECT: Record<NotificationType, (d: { actor: string; key: string; title: string }) => string> = {
  MENTIONED: (d) => `${d.actor} mentioned you on ${d.key}`,
  COMMENTED: (d) => `${d.actor} commented on ${d.key}`,
  ASSIGNED: (d) => `${d.actor} assigned ${d.key} to you`,
  STATUS_CHANGED: (d) => `${d.key} changed status`,
  APPROVAL_REQUESTED: (d) => `${d.actor} asked for your approval on ${d.key}`,
  APPROVAL_DECIDED: (d) => `Your approval request on ${d.key} was decided`,
  DUE_SOON: (d) => `${d.key} is due tomorrow`,
  AUTOMATION: (d) => `Automation update on ${d.key}`,
};

/**
 * Creates in-app notifications (and emails, per preference). Recipients are filtered to people
 * who are still members and can see the task's project, and never include the actor.
 */
export const notify = async (input: NotifyInput) => {
  const ids = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  if (!ids.length) return [];

  const task = await prisma.task.findFirst({
    where: { id: input.taskId, organizationId: input.orgId, deletedAt: null },
    select: { id: true, number: true, title: true, projectId: true, project: { select: { key: true, name: true } } },
  });
  if (!task) return [];

  const members = await prisma.membership.findMany({ where: { organizationId: input.orgId, userId: { in: ids } }, select: { userId: true, role: true } });
  const recipients: number[] = [];
  for (const m of members) {
    const sees = await prisma.project.count({ where: { id: task.projectId, ...projectAccessWhere({ userId: m.userId, tenant: { organizationId: input.orgId, role: m.role } }) } });
    if (sees) recipients.push(m.userId);
  }
  if (!recipients.length) return [];

  const actor = input.actorId ? await prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true, email: true } }) : null;
  const named = typeof input.data?.actorName === "string" ? input.data.actorName : null; // e.g. an automation
  const actorName = actor ? actor.name || actor.email.split("@")[0] : (named ?? "TaskForge");
  const key = `${task.project.key}-${task.number}`;
  const data = { key, title: task.title, projectId: task.projectId, projectName: task.project.name, actorName, ...input.data } as Prisma.InputJsonValue;

  await prisma.notification.createMany({
    data: recipients.map((userId) => ({ organizationId: input.orgId, userId, actorId: input.actorId, type: input.type, taskId: task.id, data })),
  });
  await publish({ type: "notification.created", orgId: input.orgId, userIds: recipients, taskIds: [task.id], actorId: input.actorId });

  // Email after the in-app rows exist; a mail failure never undoes the notification
  void emailRecipients(input, recipients, { actor: actorName, key, title: task.title, projectId: task.projectId, taskId: task.id }).catch((err) =>
    logger.warn({ err }, "Notification email failed")
  );
  return recipients;
};

const emailRecipients = async (
  input: NotifyInput,
  recipients: number[],
  d: { actor: string; key: string; title: string; projectId: string; taskId: number }
) => {
  const [prefs, users] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { organizationId: input.orgId, userId: { in: recipients } } }),
    prisma.user.findMany({ where: { id: { in: recipients }, emailVerifiedAt: { not: null } }, select: { id: true, email: true } }),
  ]);
  const wants = (userId: number) => (prefs.find((p) => p.userId === userId)?.emailTypes ?? DEFAULT_EMAIL_TYPES).includes(input.type);
  const link = `${config.FRONTEND_URL}/projects/${d.projectId}/board?task=${d.taskId}`;
  const subject = SUBJECT[input.type](d);
  const detail = typeof input.data?.excerpt === "string" ? input.data.excerpt : "";

  for (const u of users) {
    if (!wants(u.id)) continue;
    await sendMail({
      to: u.email,
      subject,
      text: `${subject}\n\n${d.key}: ${d.title}\n${detail ? `\n“${detail}”\n` : ""}\nOpen it: ${link}\n\nYou can change which emails you get under Settings → Notifications.`,
      // Everything user-written is escaped: titles and comments can contain anything
      html: `<p>${escapeHtml(subject)}</p><p><strong>${escapeHtml(d.key)}</strong> ${escapeHtml(d.title)}</p>${detail ? `<blockquote>${escapeHtml(detail)}</blockquote>` : ""}<p><a href="${escapeHtml(link)}">Open the task</a></p><p style="color:#6b7280;font-size:12px">Change which emails you get under Settings → Notifications.</p>`,
    });
    await prisma.notification.updateMany({ where: { userId: u.id, taskId: d.taskId, type: input.type, emailedAt: null }, data: { emailedAt: new Date() } });
  }
};

// ─── Inbox ───────────────────────────────────────────────────────────────────

export const listQuery = z.object({
  unread: z.enum(["true"]).transform(() => true).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Cursor: id of the last item from the previous page */
  before: z.string().max(40).optional(),
});

const mine = (actor: Actor) => ({ userId: actor.userId, organizationId: actor.tenant.organizationId });

export const listNotifications = async (actor: Actor, q: z.infer<typeof listQuery>) => {
  const cursor = q.before ? await prisma.notification.findFirst({ where: { id: q.before, ...mine(actor) }, select: { createdAt: true, id: true } }) : null;
  const items = await prisma.notification.findMany({
    where: {
      ...mine(actor),
      ...(q.unread ? { readAt: null } : {}),
      // Hide notifications about tasks that were deleted since
      OR: [{ taskId: null }, { task: { deletedAt: null } }],
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    select: { id: true, type: true, taskId: true, data: true, readAt: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } },
  });
  const hasMore = items.length > q.limit;
  return { items: items.slice(0, q.limit), nextCursor: hasMore ? items[q.limit - 1].id : null };
};

export const unreadCount = (actor: Actor) => prisma.notification.count({ where: { ...mine(actor), readAt: null, OR: [{ taskId: null }, { task: { deletedAt: null } }] } });

export const markRead = async (actor: Actor, ids: string[] | "all") => {
  const { count } = await prisma.notification.updateMany({
    where: { ...mine(actor), readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
  return { updated: count };
};

/** Opening a task marks its notifications read. */
export const markTaskRead = (actor: Actor, taskId: number) =>
  prisma.notification.updateMany({ where: { ...mine(actor), taskId, readAt: null }, data: { readAt: new Date() } });

export const prefsBody = z.object({ emailTypes: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length) });

export const getPreferences = async (actor: Actor) => {
  const p = await prisma.notificationPreference.findUnique({ where: { userId_organizationId: { userId: actor.userId, organizationId: actor.tenant.organizationId } } });
  return { emailTypes: p?.emailTypes ?? DEFAULT_EMAIL_TYPES, emailConfigured: config.mailEnabled || config.isTest };
};

export const setPreferences = async (actor: Actor, emailTypes: NotificationType[]) => {
  const unique = [...new Set(emailTypes)];
  await prisma.notificationPreference.upsert({
    where: { userId_organizationId: { userId: actor.userId, organizationId: actor.tenant.organizationId } },
    create: { userId: actor.userId, organizationId: actor.tenant.organizationId, emailTypes: unique },
    update: { emailTypes: unique },
  });
  return getPreferences(actor);
};

// ─── Due-soon reminders ──────────────────────────────────────────────────────

/**
 * Notifies assignees about open tasks due tomorrow (UTC), once per task and day.
 * Safe to run from several processes: an advisory lock lets only one do the work.
 */
export const runDueSoonSweep = async (now = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const end = new Date(start.getTime() + 86_400_000);
  const dayKey = start.toISOString().slice(0, 10);
  return prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('due-soon-sweep')) AS locked`;
    if (!locked) return 0;
    const tasks = await tx.task.findMany({
      where: { dueDate: { gte: start, lt: end }, status: { not: "DONE" }, deletedAt: null, archivedAt: null, assigneeId: { not: null }, project: { status: { not: "ARCHIVED" } } },
      select: { id: true, organizationId: true, assigneeId: true },
      take: 5000,
    });
    let sent = 0;
    for (const t of tasks) {
      const already = await tx.notification.count({ where: { taskId: t.id, userId: t.assigneeId!, type: "DUE_SOON", data: { path: ["dueDay"], equals: dayKey } } });
      if (already) continue;
      const r = await notify({ orgId: t.organizationId, type: "DUE_SOON", actorId: null, taskId: t.id, userIds: [t.assigneeId!], data: { dueDay: dayKey } });
      sent += r.length;
    }
    return sent;
  }, { timeout: 120_000 });
};
