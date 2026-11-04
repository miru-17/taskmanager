import type { Request } from "express";
import { z } from "zod";
import { prisma } from "../../core/prisma";
import { badRequest, forbidden, notFound } from "../../core/errors";
import { audit } from "../../core/audit";
import { projectAccessWhere, resolveProjectAccess, type Actor } from "../../core/access";
import { findVisible, visibleTasks } from "../tasks/tasks.service";
import { getProvider } from "./provider";
import { aiAvailability, data, runAI } from "./run";
import { parseTask, todayIn, type Draft, type LabelRef, type Person, type ProjectRef } from "./parse";
import {
  assistantRules,
  breakdownRules,
  daysBetween,
  prioritizeRules,
  projectSummaryRules,
  riskNarrativeRules,
  riskRules,
  taskSummaryRules,
  workloadRules,
  type TaskFacts,
} from "./rules";

const PRIORITY = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const name = (u: { name: string | null; email: string }) => u.name || u.email.split("@")[0];
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);

/** Clients (external people) don't get AI features: they'd see org-wide workload and summaries. */
const assertCanUseAI = (actor: Actor) => {
  if (actor.tenant.role === "CLIENT") throw forbidden("AI features aren't available to clients");
};

// ─── Status and settings ─────────────────────────────────────────────────────

export const status = async (actor: Actor) => {
  const p = getProvider();
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.tenant.organizationId }, select: { aiEnabled: true } });
  const avail = await aiAvailability(actor.tenant.organizationId);
  return {
    configured: Boolean(p),
    model: p?.model ?? null,
    orgEnabled: org.aiEnabled,
    /** What requests will use right now */
    mode: avail.available ? ("ai" as const) : ("rules" as const),
    reason: avail.reason ?? null,
  };
};

export const updateSettings = async (req: Request, actor: Actor, enabled: boolean) => {
  await prisma.organization.update({ where: { id: actor.tenant.organizationId }, data: { aiEnabled: enabled } });
  await audit(req, { action: "ai.settings_updated", organizationId: actor.tenant.organizationId, targetType: "organization", targetId: actor.tenant.organizationId, metadata: { enabled } });
  return status(actor);
};

// ─── Loading facts (always scoped to what the caller can see) ───────────────

const factSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  estimateHours: true,
  updatedAt: true,
  parentId: true,
  project: { select: { key: true } },
  assignee: { select: { id: true, name: true, email: true } },
  dependsOn: { select: { dependsOn: { select: { number: true, status: true, dueDate: true, deletedAt: true, project: { select: { key: true } } } } } },
  blocks: { select: { task: { select: { status: true, deletedAt: true } } } },
} as const;

type FactRow = Awaited<ReturnType<typeof loadRows>>[number];
const loadRows = (where: object, take: number) =>
  prisma.task.findMany({ where, select: factSelect, take, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }] });

const toFacts = (r: FactRow, today: string): TaskFacts => {
  const blockers = r.dependsOn.map((d) => d.dependsOn).filter((b) => !b.deletedAt && b.status !== "DONE");
  return {
    id: r.id,
    key: `${r.project.key}-${r.number}`,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
    assignee: r.assignee ? { id: r.assignee.id, name: name(r.assignee) } : null,
    estimateHours: r.estimateHours,
    updatedDay: r.updatedAt.toISOString().slice(0, 10),
    parentId: r.parentId,
    openBlockers: blockers.length,
    overdueBlockerKeys: blockers.filter((b) => b.dueDate && b.dueDate.toISOString().slice(0, 10) < today).map((b) => `${b.project.key}-${b.number}`),
    blocksOpen: r.blocks.filter((b) => !b.task.deletedAt && b.task.status !== "DONE").length,
  };
};

const MAX_PROJECT_TASKS = 1000;
const projectFacts = async (actor: Actor, projectId: string, today: string) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(actor) }, select: { id: true, name: true, key: true } });
  if (!project) throw notFound("Project not found");
  const rows = await loadRows({ ...visibleTasks(actor), projectId, archivedAt: null }, MAX_PROJECT_TASKS);
  return { project, tasks: rows.map((r) => toFacts(r, today)) };
};

/** A compact line per task for the model: enough to reason about, nothing it doesn't need. */
const compact = (t: TaskFacts) => ({
  id: t.id,
  key: t.key,
  title: clip(t.title, 120),
  status: t.status,
  priority: t.priority,
  due: t.dueDate,
  assignee: t.assignee?.name ?? null,
  estimateHours: t.estimateHours,
  waitingOn: t.openBlockers,
  blocks: t.blocksOpen,
  lastChanged: t.updatedDay,
});

const wrap = <T>(o: { result: T; source: "ai" | "rules"; fallbackReason?: string }) => ({ ...o.result, source: o.source, fallbackReason: o.fallbackReason ?? null });

// ─── Natural-language task creation ──────────────────────────────────────────

const parseOut = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullish(),
  priority: PRIORITY.nullish(),
  dueDate: z.string().regex(DAY_KEY).nullish(),
  assigneeId: z.number().int().nullish(),
  labelIds: z.array(z.string()).max(20).nullish(),
  projectId: z.string().nullish(),
});

const assignablePeople = async (actor: Actor, projectId: string): Promise<Person[]> => {
  const members = await prisma.membership.findMany({ where: { organizationId: actor.tenant.organizationId }, select: { role: true, user: { select: { id: true, name: true, email: true } } } });
  const out: Person[] = [];
  for (const m of members) {
    const sees = await prisma.project.count({ where: { id: projectId, ...projectAccessWhere({ userId: m.user.id, tenant: { organizationId: actor.tenant.organizationId, role: m.role } }) } });
    if (sees) out.push(m.user);
  }
  return out;
};

export const parse = async (actor: Actor, input: { text: string; projectId?: string; tz?: string }) => {
  assertCanUseAI(actor);
  const today = todayIn(input.tz ?? "UTC");
  const projects: ProjectRef[] = await prisma.project.findMany({ where: { ...projectAccessWhere(actor), status: { not: "ARCHIVED" } }, select: { id: true, key: true, name: true }, orderBy: { createdAt: "asc" } });
  if (!projects.length) throw badRequest("Create a project first");
  if (input.projectId && !projects.some((p) => p.id === input.projectId)) throw notFound("Project not found");
  const baseProject = input.projectId ?? projects[0].id;
  const [people, labels] = await Promise.all([
    assignablePeople(actor, baseProject),
    prisma.label.findMany({ where: { organizationId: actor.tenant.organizationId }, select: { id: true, name: true } }) as Promise<LabelRef[]>,
  ]);
  const ctx = { today, people, labels, projects };
  const rules = () => {
    const { draft, understood } = parseTask(input.text, ctx);
    return { draft: { ...draft, projectId: draft.projectId ?? baseProject, description: null as string | null }, understood, dropped: [] as string[] };
  };

  const out = await runAI({
    organizationId: actor.tenant.organizationId,
    feature: "parse",
    instructions: [
      "Turn the user's request into one task.",
      'Answer as {"title": string, "description": string|null, "priority": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|null, "dueDate": "YYYY-MM-DD"|null, "assigneeId": number|null, "labelIds": string[], "projectId": string|null}.',
      "Use only ids from the people, labels and projects lists. Leave a field null if the request doesn't say. Dates are relative to today. Keep the title short; put extra detail in the description.",
    ].join(" "),
    context: [data("request", input.text), data("today", today), data("people", people.map((p) => ({ id: p.id, name: name(p) }))), data("labels", labels), data("projects", projects)].join("\n"),
    schema: parseOut,
    accept: (o) => {
      // Unknown ids and past dates are dropped one by one, and reported, rather than trusted
      const dropped: string[] = [];
      const draft: Draft & { description: string | null } = { title: o.title, description: o.description ?? null, labelIds: [], projectId: baseProject };
      if (o.priority) draft.priority = o.priority;
      if (o.dueDate) {
        if (o.dueDate >= today && !Number.isNaN(Date.parse(`${o.dueDate}T00:00:00Z`))) draft.dueDate = o.dueDate;
        else dropped.push("due date");
      }
      if (o.assigneeId != null) {
        if (people.some((p) => p.id === o.assigneeId)) draft.assigneeId = o.assigneeId;
        else dropped.push("assignee");
      }
      for (const id of o.labelIds ?? []) {
        if (labels.some((l) => l.id === id)) draft.labelIds.push(id);
        else if (!dropped.includes("label")) dropped.push("label");
      }
      if (o.projectId) {
        if (projects.some((p) => p.id === o.projectId)) draft.projectId = o.projectId;
        else dropped.push("project");
      }
      const understood = [draft.priority && "priority", draft.dueDate && "due date", draft.assigneeId && "assignee", draft.labelIds.length && "labels", o.description && "description"].filter(Boolean) as string[];
      return { draft, understood, dropped };
    },
    fallback: rules,
  });
  return wrap(out);
};

// ─── Breakdown ───────────────────────────────────────────────────────────────

const breakdownOut = z.object({ subtasks: z.array(z.object({ title: z.string().trim().min(1).max(200), estimateHours: z.number().min(0).max(1000).nullish() })).max(12) });

export const breakdown = async (actor: Actor, taskId: number) => {
  assertCanUseAI(actor);
  const task = await findVisible(actor, taskId);
  const caps = await resolveProjectAccess(actor, task.projectId);
  if (!caps.createTasks) throw forbidden("You can't add subtasks in this project");
  if (task.parentId) throw badRequest("Subtasks can't have their own subtasks");
  const existing = (await prisma.task.findMany({ where: { parentId: taskId, deletedAt: null }, select: { title: true } })).map((s) => s.title);
  const rules = (): { basis: "ai" | "description" | "template"; subtasks: { title: string; estimateHours: number | null }[] } => breakdownRules(task.title, task.description, existing);
  const have = new Set(existing.map((s) => s.toLowerCase()));

  const out = await runAI({
    organizationId: actor.tenant.organizationId,
    feature: "breakdown",
    instructions: 'Break the task into 3 to 8 concrete subtasks a person can finish in a day or two. Answer as {"subtasks": [{"title": string, "estimateHours": number|null}]}. Don\'t repeat existing subtasks.',
    context: [data("task", { title: task.title, description: clip(task.description, 3000) }), data("existingSubtasks", existing)].join("\n"),
    schema: breakdownOut,
    accept: (o) => {
      const subtasks = o.subtasks.filter((s) => !have.has(s.title.toLowerCase())).slice(0, 8).map((s) => ({ title: s.title, estimateHours: s.estimateHours ?? null }));
      return subtasks.length ? { basis: "ai" as const, subtasks } : null;
    },
    fallback: rules,
  });
  return wrap(out);
};

// ─── Summaries ───────────────────────────────────────────────────────────────

const summaryOut = z.object({ summary: z.string().trim().min(1).max(1500), highlights: z.array(z.string().trim().min(1).max(300)).max(6).default([]) });

const describeChange = (type: string, changes: unknown) => {
  if (type !== "updated" || !changes || typeof changes !== "object") return type.replace(/_/g, " ");
  return Object.keys(changes as object)
    .filter((k) => !k.startsWith("_"))
    .map((k) => `${k.replace(/Id$/, "")} changed`)
    .join(", ");
};

export const taskSummary = async (actor: Actor, taskId: number, tz?: string) => {
  assertCanUseAI(actor);
  const today = todayIn(tz ?? "UTC");
  await findVisible(actor, taskId);
  const [row] = await loadRows({ id: taskId, ...visibleTasks(actor) }, 1);
  const facts = toFacts(row, today);
  const [checklist, subtasks, comments, activity] = await Promise.all([
    prisma.checklistItem.findMany({ where: { taskId }, select: { done: true } }),
    prisma.task.findMany({ where: { parentId: taskId, deletedAt: null }, select: { status: true } }),
    prisma.taskComment.findMany({ where: { taskId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 30, select: { body: true, createdAt: true, automationName: true, author: { select: { name: true, email: true } } } }),
    prisma.taskActivity.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, take: 20, select: { type: true, changes: true, createdAt: true } }),
  ]);
  const input = {
    task: facts,
    checklist: { done: checklist.filter((c) => c.done).length, total: checklist.length },
    subtasks: { done: subtasks.filter((s) => s.status === "DONE").length, total: subtasks.length },
    comments: comments.reverse().map((c) => ({ author: c.automationName ? `Automation “${c.automationName}”` : c.author ? name(c.author) : "Someone", excerpt: clip(c.body.replace(/@\[([^\]]+)\]\(user:\d+\)/g, "@$1"), 200)!, day: c.createdAt.toISOString().slice(0, 10) })),
    recentChanges: activity.reverse().map((a) => `${describeChange(a.type, a.changes)} (${a.createdAt.toISOString().slice(0, 10)})`),
  };

  const out = await runAI({
    organizationId: actor.tenant.organizationId,
    feature: "task_summary",
    instructions: 'Summarize where this task stands for a busy teammate: progress, open questions from the comments, and what happens next. Answer as {"summary": string (2-4 sentences), "highlights": string[] (up to 5 short points)}.',
    context: [data("today", today), data("task", { ...compact(facts), description: clip(facts.description, 2000) }), data("checklist", input.checklist), data("subtasks", input.subtasks), data("comments", input.comments), data("recentChanges", input.recentChanges)].join("\n"),
    schema: summaryOut,
    accept: (o) => o,
    fallback: () => taskSummaryRules(input, today),
  });
  return wrap(out);
};

export const projectSummary = async (actor: Actor, projectId: string, tz?: string) => {
  assertCanUseAI(actor);
  const today = todayIn(tz ?? "UTC");
  const { project, tasks } = await projectFacts(actor, projectId, today);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000);
  const completedLast7 = await prisma.task.count({ where: { ...visibleTasks(actor), projectId, completedAt: { gte: since } } });
  const risks = riskRules(tasks, today);
  const out = await runAI({
    organizationId: actor.tenant.organizationId,
    feature: "project_summary",
    instructions: 'Write a short status report for this project: progress, what moved recently, and the main risks. Answer as {"summary": string (3-5 sentences), "highlights": string[] (up to 5 short points)}. Only use facts given.',
    context: [data("today", today), data("project", { name: project.name, completedLast7Days: completedLast7 }), data("risks", risks.map((r) => ({ title: r.title, detail: r.detail }))), data("tasks", tasks.slice(0, 150).map(compact))].join("\n"),
    schema: summaryOut,
    accept: (o) => o,
    fallback: () => projectSummaryRules(project.name, tasks, completedLast7, today),
  });
  return wrap(out);
};

// ─── Prioritisation ──────────────────────────────────────────────────────────

const prioritizeOut = z.object({ suggestions: z.array(z.object({ taskId: z.number().int(), priority: PRIORITY, reason: z.string().trim().min(1).max(240) })).max(30) });

export const prioritize = async (actor: Actor, projectId: string, tz?: string) => {
  assertCanUseAI(actor);
  const caps = await resolveProjectAccess(actor, projectId);
  if (caps.editTasks === "none") throw forbidden("You can't change priorities in this project");
  const today = todayIn(tz ?? "UTC");
  const { tasks } = await projectFacts(actor, projectId, today);
  const live = tasks.filter((t) => t.status !== "DONE");
  // A member who may only edit their own tasks only gets suggestions for those
  const editable = caps.editTasks === "any" ? live : live.filter((t) => t.assignee?.id === actor.userId);
  const byId = new Map(editable.map((t) => [t.id, t]));
  const shape = (list: { taskId: number; suggested: string; reason: string }[]) => ({
    suggestions: list.map((s) => {
      const t = byId.get(s.taskId)!;
      return { taskId: t.id, key: t.key, title: t.title, current: t.priority, suggested: s.suggested, reason: s.reason };
    }),
  });
  const out = await runAI({
    organizationId: actor.tenant.organizationId,
    feature: "prioritize",
    instructions: 'Suggest priority changes for the open tasks below, considering due dates, what blocks what, and staleness. Only include tasks whose priority should change. Answer as {"suggestions": [{"taskId": number, "priority": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "reason": string (one short sentence)}]}. At most 20.',
    context: [data("today", today), data("tasks", editable.slice(0, 120).map(compact))].join("\n"),
    schema: prioritizeOut,
    accept: (o) => {
      const seen = new Set<number>();
      const ok = o.suggestions.filter((s) => {
        const t = byId.get(s.taskId);
        if (!t || seen.has(s.taskId) || t.priority === s.priority) return false;
        seen.add(s.taskId);
        return true;
      });
      return shape(ok.slice(0, 20).map((s) => ({ taskId: s.taskId, suggested: s.priority, reason: s.reason })));
    },
    fallback: () => shape(prioritizeRules(editable, today)),
  });
  return wrap(out);
};

// ─── Risks and workload ──────────────────────────────────────────────────────

const narrativeOut = z.object({ narrative: z.string().trim().min(1).max(1200) });

export const risks = async (actor: Actor, projectId: string, tz?: string) => {
  assertCanUseAI(actor);
  const today = todayIn(tz ?? "UTC");
  const { project, tasks } = await projectFacts(actor, projectId, today);
  // Detection is always the rules: explainable, testable, and the same with AI on or off
  const found = riskRules(tasks, today);
  const workload = workloadRules(tasks, today);
  const openCount = tasks.filter((t) => t.status !== "DONE").length;
  const out = await runAI({
    organizationId: actor.tenant.organizationId,
    feature: "risks",
    instructions: 'Explain these detected risks to a project lead in 2-4 sentences: what matters most and a concrete next step. Use only the facts given. Answer as {"narrative": string}.',
    context: [data("today", today), data("project", project.name), data("risks", found.map((r) => ({ severity: r.severity, title: r.title, detail: r.detail }))), data("workload", workload.slice(0, 15))].join("\n"),
    schema: narrativeOut,
    accept: (o) => o,
    fallback: () => ({ narrative: riskNarrativeRules(found, openCount) }),
  });
  const keyOf = new Map(tasks.map((t) => [t.id, { id: t.id, key: t.key, title: t.title }]));
  return {
    risks: found.map((r) => ({ ...r, tasks: r.taskIds.map((id) => keyOf.get(id)!).filter(Boolean) })),
    workload,
    openTasks: openCount,
    narrative: out.result.narrative,
    source: out.source,
    fallbackReason: out.fallbackReason ?? null,
  };
};

// ─── Assistant ───────────────────────────────────────────────────────────────

const assistantOut = z.object({ answer: z.string().trim().min(1).max(3000), taskIds: z.array(z.number().int()).max(30).default([]) });

export const assistant = async (actor: Actor, input: { message: string; history: { role: "user" | "assistant"; content: string }[]; tz?: string }) => {
  assertCanUseAI(actor);
  const today = todayIn(input.tz ?? "UTC");
  const rows = await loadRows({ ...visibleTasks(actor), archivedAt: null, status: { not: "DONE" } }, 400);
  const tasks = rows.map((r) => toFacts(r, today));
  // The model sees the most relevant slice: mine first, then the most urgent
  const due = (t: TaskFacts) => (t.dueDate ? daysBetween(today, t.dueDate) : 9999);
  const relevant = [...tasks].sort((a, b) => Number(b.assignee?.id === actor.userId) - Number(a.assignee?.id === actor.userId) || due(a) - due(b)).slice(0, 150);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, email: true } });
  const allowed = new Map(tasks.map((t) => [t.id, t]));

  const out = await runAI({
    organizationId: actor.tenant.organizationId,
    feature: "assistant",
    instructions: [
      `You help ${name(me)} understand their work. Answer the latest question using only the tasks given; say so if they don't contain the answer.`,
      "You cannot create, change or delete anything; if asked to, explain how to do it in the app instead.",
      'Answer as {"answer": string (plain text, short), "taskIds": number[] (the tasks you mention)}.',
    ].join(" "),
    context: [
      data("today", today),
      data("me", { id: actor.userId, name: name(me) }),
      data("tasks", relevant.map(compact)),
      data("conversation", input.history.slice(-8).map((h) => ({ role: h.role, content: clip(h.content, 1000) }))),
      data("question", input.message),
    ].join("\n"),
    schema: assistantOut,
    maxTokens: 900,
    accept: (o) => ({ answer: o.answer, taskIds: [...new Set(o.taskIds)].filter((id) => allowed.has(id)).slice(0, 20) }),
    fallback: () => assistantRules(input.message, tasks, actor.userId, today),
  });
  return {
    answer: out.result.answer,
    // Only tasks the caller can see are ever linked, whatever the model said
    references: out.result.taskIds.map((id) => allowed.get(id)!).map((t) => ({ id: t.id, key: t.key, title: t.title })),
    source: out.source,
    fallbackReason: out.fallbackReason ?? null,
  };
};
