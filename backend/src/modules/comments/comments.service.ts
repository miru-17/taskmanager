import type { Request } from "express";
import { z } from "zod";
import { prisma } from "../../core/prisma";
import { AppError, badRequest, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import { publishTaskChange } from "../../core/events";
import { projectAccessWhere, resolveProjectAccess, type Actor } from "../../core/access";
import { findVisible } from "../tasks/tasks.service";
import { excerpt, notify } from "../notifications/notifications.service";

export const REACTIONS = ["👍", "👎", "🎉", "❤️", "😄", "👀", "🚀", "✅"] as const;
const MAX_COMMENTS_PER_TASK = 5000;

export const commentBody = z.object({
  body: z.string({ error: "Write something first" }).trim().min(1, "Write something first").max(10_000, "Comments can be at most 10,000 characters"),
  parentId: z.string().max(40).nullable().optional(),
});
export const editBody = commentBody.pick({ body: true });
export const reactionBody = z.object({ emoji: z.enum(REACTIONS) });

const userSelect = { id: true, email: true, name: true } as const;
const MENTION = /@\[([^\]\n]{1,80})\]\(user:(\d{1,10})\)/g;
const nameOf = (u: { name: string | null; email: string }) => u.name || u.email.split("@")[0];

/**
 * Keeps only mentions of people who can see the task, and rewrites their display name
 * to the real one (so "@[CEO](user:7)" can't impersonate). Anything else becomes plain "@text".
 */
export const sanitizeMentions = async (orgId: string, projectId: string, body: string) => {
  const ids = [...new Set([...body.matchAll(MENTION)].map((m) => Number(m[2])))].slice(0, 50);
  const valid = new Map<number, string>();
  if (ids.length) {
    const members = await prisma.membership.findMany({
      where: { organizationId: orgId, userId: { in: ids } },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    });
    for (const m of members) {
      const sees = await prisma.project.count({ where: { id: projectId, ...projectAccessWhere({ userId: m.userId, tenant: { organizationId: orgId, role: m.role } }) } });
      if (sees) valid.set(m.userId, nameOf(m.user).replace(/[\]\n]/g, ""));
    }
  }
  const clean = body.replace(MENTION, (_all, label: string, id: string) => (valid.has(Number(id)) ? `@[${valid.get(Number(id))}](user:${id})` : `@${label}`));
  return { body: clean, userIds: [...valid.keys()] };
};

/** Commenting is a write: org viewers are read-only; clients may comment on what they can see. */
const assertCanComment = async (actor: Actor, taskId: number) => {
  const task = await findVisible(actor, taskId);
  if (actor.tenant.role === "VIEWER") throw forbidden("Viewers can read comments but can't write them");
  if (task.archivedAt) throw badRequest("Unarchive this task before commenting");
  const p = await prisma.project.findUniqueOrThrow({ where: { id: task.projectId }, select: { status: true } });
  if (p.status === "ARCHIVED") throw badRequest("This project is archived");
  return task;
};

const commentSelect = {
  id: true,
  parentId: true,
  body: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
  author: { select: userSelect },
  reactions: { select: { emoji: true, userId: true } },
} as const;

type Row = { id: string; parentId: string | null; body: string; editedAt: Date | null; deletedAt: Date | null; createdAt: Date; author: { id: number; email: string; name: string | null } | null; reactions: { emoji: string; userId: number }[] };

const shape = (c: Row, me: number) => ({
  id: c.id,
  parentId: c.parentId,
  body: c.deletedAt ? "" : c.body,
  deleted: Boolean(c.deletedAt),
  editedAt: c.editedAt,
  createdAt: c.createdAt,
  author: c.deletedAt ? null : c.author,
  reactions: REACTIONS.map((emoji) => {
    const who = c.reactions.filter((r) => r.emoji === emoji);
    return { emoji, count: who.length, mine: who.some((r) => r.userId === me) };
  }).filter((r) => r.count > 0),
});

export const listComments = async (actor: Actor, taskId: number) => {
  await findVisible(actor, taskId);
  const rows = await prisma.taskComment.findMany({ where: { taskId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: commentSelect, take: MAX_COMMENTS_PER_TASK });
  const replies = new Map<string, Row[]>();
  for (const r of rows) if (r.parentId) replies.set(r.parentId, [...(replies.get(r.parentId) ?? []), r]);
  return rows
    .filter((r) => !r.parentId)
    .map((r) => ({ ...shape(r, actor.userId), replies: (replies.get(r.id) ?? []).filter((x) => !x.deletedAt).map((x) => shape(x, actor.userId)) }))
    // A deleted comment stays only as a placeholder above its surviving replies
    .filter((r) => !r.deleted || r.replies.length > 0);
};

export const createComment = async (req: Request, actor: Actor, taskId: number, input: z.infer<typeof commentBody>) => {
  const task = await assertCanComment(actor, taskId);
  const { organizationId } = actor.tenant;
  if (input.parentId) {
    const parent = await prisma.taskComment.findFirst({ where: { id: input.parentId, taskId, deletedAt: null } });
    if (!parent) throw notFound("The comment you're replying to no longer exists");
    if (parent.parentId) throw badRequest("Replies can't be nested further; reply to the main comment");
  }
  if ((await prisma.taskComment.count({ where: { taskId } })) >= MAX_COMMENTS_PER_TASK) throw new AppError(409, "TOO_MANY_COMMENTS", "This task has too many comments");

  const { body, userIds: mentioned } = await sanitizeMentions(organizationId, task.projectId, input.body);
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.taskComment.create({ data: { taskId, authorId: actor.userId, parentId: input.parentId ?? null, body }, select: commentSelect });
    if (mentioned.length) await tx.commentMention.createMany({ data: mentioned.map((userId) => ({ commentId: c.id, userId })), skipDuplicates: true });
    // Taking part in a conversation means following it
    await tx.taskWatcher.createMany({ data: [{ taskId, userId: actor.userId }], skipDuplicates: true });
    return c;
  });

  const text = excerpt(body);
  await notify({ orgId: organizationId, type: "MENTIONED", actorId: actor.userId, taskId, userIds: mentioned, data: { excerpt: text, commentId: comment.id } });
  const watchers = await prisma.taskWatcher.findMany({ where: { taskId }, select: { userId: true } });
  await notify({
    orgId: organizationId,
    type: "COMMENTED",
    actorId: actor.userId,
    taskId,
    userIds: watchers.map((w) => w.userId).filter((id) => !mentioned.includes(id)),
    data: { excerpt: text, commentId: comment.id },
  });
  await publishTaskChange(organizationId, [taskId], actor.userId, "comment.changed");
  await audit(req, { action: "comment.created", organizationId, targetType: "task", targetId: taskId, metadata: { commentId: comment.id, mentions: mentioned.length } });
  return shape(comment, actor.userId);
};

const findComment = async (actor: Actor, id: string) => {
  const c = await prisma.taskComment.findFirst({ where: { id, task: { organizationId: actor.tenant.organizationId } }, include: { mentions: true } });
  if (!c) throw notFound("Comment not found");
  try {
    await findVisible(actor, c.taskId);
  } catch {
    throw notFound("Comment not found");
  }
  return c;
};

export const updateComment = async (actor: Actor, id: string, input: z.infer<typeof editBody>) => {
  const c = await findComment(actor, id);
  if (c.deletedAt) throw notFound("Comment not found");
  if (c.authorId !== actor.userId) throw forbidden("You can only edit your own comments");
  const task = await assertCanComment(actor, c.taskId);

  const { body, userIds } = await sanitizeMentions(actor.tenant.organizationId, task.projectId, input.body);
  const before = new Set(c.mentions.map((m) => m.userId));
  const added = userIds.filter((u) => !before.has(u));
  const updated = await prisma.$transaction(async (tx) => {
    await tx.commentMention.deleteMany({ where: { commentId: id, userId: { notIn: userIds } } });
    if (added.length) await tx.commentMention.createMany({ data: added.map((userId) => ({ commentId: id, userId })), skipDuplicates: true });
    return tx.taskComment.update({ where: { id }, data: { body, editedAt: body !== c.body ? new Date() : c.editedAt }, select: commentSelect });
  });
  // Only people newly mentioned by the edit hear about it
  await notify({ orgId: actor.tenant.organizationId, type: "MENTIONED", actorId: actor.userId, taskId: c.taskId, userIds: added, data: { excerpt: excerpt(body), commentId: id } });
  await publishTaskChange(actor.tenant.organizationId, [c.taskId], actor.userId, "comment.changed");
  return shape(updated, actor.userId);
};

/** The author, or a project manager (moderation). */
export const deleteComment = async (req: Request, actor: Actor, id: string) => {
  const c = await findComment(actor, id);
  if (c.deletedAt) return;
  const task = await findVisible(actor, c.taskId);
  const caps = await resolveProjectAccess(actor, task.projectId);
  if (c.authorId !== actor.userId && !caps.manage) throw forbidden("You can only delete your own comments");
  await prisma.$transaction([
    prisma.commentMention.deleteMany({ where: { commentId: id } }),
    prisma.commentReaction.deleteMany({ where: { commentId: id } }),
    prisma.taskComment.update({ where: { id }, data: { deletedAt: new Date(), body: "" } }),
  ]);
  await publishTaskChange(actor.tenant.organizationId, [c.taskId], actor.userId, "comment.changed");
  if (c.authorId !== actor.userId) {
    await audit(req, { action: "comment.moderated", organizationId: actor.tenant.organizationId, targetType: "task", targetId: c.taskId, metadata: { commentId: id, authorId: c.authorId } });
  }
};

export const toggleReaction = async (actor: Actor, id: string, emoji: (typeof REACTIONS)[number]) => {
  const c = await findComment(actor, id);
  if (c.deletedAt) throw notFound("Comment not found");
  if (actor.tenant.role === "VIEWER") throw forbidden("Viewers can't react to comments");
  const key = { commentId_userId_emoji: { commentId: id, userId: actor.userId, emoji } };
  const existing = await prisma.commentReaction.findUnique({ where: key });
  if (existing) await prisma.commentReaction.delete({ where: key });
  else await prisma.commentReaction.create({ data: { commentId: id, userId: actor.userId, emoji } });
  await publishTaskChange(actor.tenant.organizationId, [c.taskId], actor.userId, "comment.changed");
  const fresh = await prisma.taskComment.findUniqueOrThrow({ where: { id }, select: commentSelect });
  return shape(fresh, actor.userId);
};

// ─── Project activity feed ───────────────────────────────────────────────────

export const feedQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) });

/** Recent task changes and comments in one project, newest first. */
export const projectFeed = async (actor: Actor, projectId: string, limit: number) => {
  const visible = await prisma.project.count({ where: { id: projectId, ...projectAccessWhere(actor) } });
  if (!visible) throw notFound("Project not found");
  const taskWhere = { projectId, deletedAt: null };
  const taskRef = { select: { id: true, number: true, title: true, project: { select: { key: true } } } } as const;
  const [activities, comments] = await Promise.all([
    prisma.taskActivity.findMany({
      where: { task: taskWhere },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, type: true, changes: true, createdAt: true, actor: { select: userSelect }, task: taskRef },
    }),
    prisma.taskComment.findMany({
      where: { task: taskWhere, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, body: true, createdAt: true, author: { select: userSelect }, task: taskRef },
    }),
  ]);
  const ref = (t: { id: number; number: number; title: string; project: { key: string } }) => ({ id: t.id, key: `${t.project.key}-${t.number}`, title: t.title });
  return [
    ...activities.map((a) => ({ kind: "activity" as const, id: a.id, type: a.type, changes: a.changes, createdAt: a.createdAt, actor: a.actor, task: ref(a.task) })),
    ...comments.map((c) => ({ kind: "comment" as const, id: c.id, excerpt: excerpt(c.body, 200), createdAt: c.createdAt, actor: c.author, task: ref(c.task) })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
};
