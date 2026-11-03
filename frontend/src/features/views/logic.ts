import { addDays, daysBetween, formatDay, todayKey, toDateInput } from "../../data/dates";
import type { Project, Task } from "../../types/Task";

/** Pure view logic, kept apart from components so it can be unit-tested directly. */

const GAP = 1024;

/** Midpoint between the neighbours: one write per move, no renumbering of the column. */
export const positionAt = (list: Pick<Task, "position">[], index: number) => {
  const prev = list[index - 1]?.position;
  const next = list[index + 1]?.position;
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return prev + GAP;
  if (next !== undefined) return next - GAP;
  return GAP;
};

/** Six Monday-first weeks covering the month, as YYYY-MM-DD keys. */
export const monthGrid = (y: number, m: number) => {
  const first = new Date(Date.UTC(y, m, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = addDays(first.toISOString().slice(0, 10), -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
};

export interface Span {
  task: Task;
  start: string;
  end: string;
}

/** A task needs at least one date to sit on the timeline; one date makes a one-day bar. */
export const toSpans = (tasks: Task[]): { spans: Span[]; undated: number } => {
  const spans: Span[] = [];
  let undated = 0;
  for (const t of tasks) {
    const s = toDateInput(t.startDate) || toDateInput(t.dueDate);
    const e = toDateInput(t.dueDate) || toDateInput(t.startDate);
    if (!s || !e) undated++;
    else spans.push({ task: t, start: s <= e ? s : e, end: e >= s ? e : s });
  }
  spans.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.task.id - b.task.id);
  return { spans, undated };
};

/** Plain-language reason for the health badge; mirrors computeHealth on the server. */
export const healthReason = (p: Project, now = todayKey()): string => {
  const s = p.stats;
  if (p.health === "completed") return "The project is marked completed.";
  if (p.health === "on_hold") return "The project is on hold.";
  const reasons: string[] = [];
  if (p.dueDate && toDateInput(p.dueDate) < now && s.open > 0) reasons.push(`its target date (${formatDay(p.dueDate)}) has passed with ${s.open} open task${s.open === 1 ? "" : "s"}`);
  if (s.overdue > 0) reasons.push(`${s.overdue} of ${s.open} open task${s.open === 1 ? " is" : "s are"} overdue`);
  if (p.startDate && p.dueDate && toDateInput(p.dueDate) > toDateInput(p.startDate)) {
    const span = daysBetween(toDateInput(p.startDate), toDateInput(p.dueDate));
    const elapsed = Math.min(1, Math.max(0, daysBetween(toDateInput(p.startDate), now) / span));
    if (elapsed - s.progress > 0.2) reasons.push(`${Math.round(elapsed * 100)}% of the schedule has elapsed but only ${Math.round(s.progress * 100)}% of tasks are done`);
  }
  if (!reasons.length) return s.total ? "No overdue work and progress is in line with the schedule." : "No tasks yet.";
  return `Because ${reasons.join("; ")}.`;
};
