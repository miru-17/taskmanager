/**
 * Rule-based reading of a one-line task description, e.g.
 *   "Fix checkout bug for @sam by friday #urgent high priority"
 * Used when AI is off, and as the safety net when the model's answer is unusable.
 * Pure functions: no database, so every case is unit-testable.
 */

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export interface Person {
  id: number;
  name: string | null;
  email: string;
}
export interface LabelRef {
  id: string;
  name: string;
}
export interface ProjectRef {
  id: string;
  key: string;
  name: string;
}
export interface Draft {
  title: string;
  priority?: Priority;
  /** YYYY-MM-DD */
  dueDate?: string;
  assigneeId?: number;
  labelIds: string[];
  projectId?: string;
}
export interface ParseContext {
  /** Today in the viewer's time zone, YYYY-MM-DD */
  today: string;
  people: Person[];
  labels: LabelRef[];
  projects: ProjectRef[];
}

const DAY = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const keyMs = (key: string) => Date.parse(`${key}T00:00:00Z`);
export const addDays = (key: string, n: number) => toKey(keyMs(key) + n * DAY);
const weekday = (key: string) => new Date(keyMs(key)).getUTCDay();
const isRealDate = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d;
};

/** Today in an IANA zone (Node's Intl knows legacy names like Asia/Calcutta). */
export const todayIn = (tz: string, now = new Date()) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
};

type Hit<T> = { value: T; match: string } | null;

const PRIORITY_PATTERNS: [RegExp, Priority][] = [
  [/(?:^|\s)!(critical|urgent|p0)\b/i, "CRITICAL"],
  [/(?:^|\s)!(high|p1)\b/i, "HIGH"],
  [/(?:^|\s)!(medium|normal|p2)\b/i, "MEDIUM"],
  [/(?:^|\s)!(low|p3)\b/i, "LOW"],
  [/\b(?:critical|urgent|asap|blocker)(?:\s+priority)?\b/i, "CRITICAL"],
  [/\bp0\b/i, "CRITICAL"],
  [/\b(?:high[- ]priority|important|high prio|p1)\b/i, "HIGH"],
  [/\b(?:medium[- ]priority|normal priority|p2)\b/i, "MEDIUM"],
  [/\b(?:low[- ]priority|low prio|whenever|someday|nice to have|p3)\b/i, "LOW"],
];

export const findPriority = (text: string): Hit<Priority> => {
  // "#urgent" is a label, not a priority
  const plain = text.replace(/#[\p{L}\p{N}_-]+/gu, (m) => " ".repeat(m.length));
  for (const [re, p] of PRIORITY_PATTERNS) {
    const m = plain.match(re);
    if (m && m.index !== undefined) return { value: p, match: text.slice(m.index, m.index + m[0].length) };
  }
  return null;
};

/** Due dates people actually type. Returns the matched phrase so it can be removed from the title. */
export const findDueDate = (text: string, today: string): Hit<string> => {
  const lead = String.raw`(?:(?:due|by|on|before|until|for)\s+)?`;
  const tries: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [new RegExp(String.raw`\b${lead}(\d{4})-(\d{2})-(\d{2})\b`, "i"), (m) => (isRealDate(+m[1], +m[2] - 1, +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null)],
    [new RegExp(String.raw`\b${lead}(today|tonight|eod|end of day)\b`, "i"), () => today],
    [new RegExp(String.raw`\b${lead}tomorrow\b`, "i"), () => addDays(today, 1)],
    [new RegExp(String.raw`\b${lead}(?:the\s+)?day after tomorrow\b`, "i"), () => addDays(today, 2)],
    [new RegExp(String.raw`\b${lead}in\s+(\d{1,3})\s+(day|days|week|weeks)\b`, "i"), (m) => addDays(today, +m[1] * (m[2].toLowerCase().startsWith("week") ? 7 : 1))],
    [new RegExp(String.raw`\b${lead}(?:the\s+)?end of (?:the\s+)?week\b|\b${lead}eow\b`, "i"), () => addDays(today, (5 - weekday(today) + 7) % 7)],
    [new RegExp(String.raw`\b${lead}next week\b`, "i"), () => addDays(today, ((1 - weekday(today) + 7) % 7) || 7)],
    [new RegExp(String.raw`\b${lead}(?:the\s+)?end of (?:the\s+)?month\b|\b${lead}eom\b`, "i"), () => {
      const d = new Date(keyMs(today));
      return toKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    }],
    // Full weekday names on their own ("friday"); short forms only after a cue ("by fri"), so "Sun logo" stays a title
    [new RegExp(String.raw`\b(?:(?:due|by|on|before|until|for)\s+)?(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b`, "i"), (m) => weekdayFrom(today, m[2], Boolean(m[1]))],
    [new RegExp(String.raw`\b(?:(?:due|by|on|before|until)\s+(next\s+)?|(next)\s+)(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b`, "i"), (m) => weekdayFrom(today, m[3], Boolean(m[1] || m[2]))],
    // "12 nov", "nov 12", "november 12th" — this year, or next year if already past
    [new RegExp(String.raw`\b${lead}(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTHS.join("|")})[a-z]*\b`, "i"), (m) => monthDay(+m[1], m[2], today)],
    [new RegExp(String.raw`\b${lead}(${MONTHS.join("|")})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b`, "i"), (m) => monthDay(+m[2], m[1], today)],
  ];
  for (const [re, fn] of tries) {
    const m = text.match(re);
    if (m) {
      const v = fn(m);
      if (v) return { value: v, match: m[0] };
    }
  }
  return null;
};

/** The next such weekday: "friday" on a Friday is today, "next friday" on a Friday is a week out. */
const weekdayFrom = (today: string, name: string, next: boolean) => {
  const idx = WEEKDAYS.findIndex((w) => w.startsWith(name.toLowerCase().slice(0, 3)));
  const diff = (idx - weekday(today) + 7) % 7;
  return addDays(today, next && diff === 0 ? 7 : diff);
};

const monthDay = (day: number, mon: string, today: string) => {
  const month = MONTHS.indexOf(mon.toLowerCase().slice(0, 3));
  const year = +today.slice(0, 4);
  if (month < 0 || !isRealDate(year, month, day) && !isRealDate(year + 1, month, day)) return null;
  const thisYear = isRealDate(year, month, day) ? toKey(Date.UTC(year, month, day)) : null;
  if (thisYear && thisYear >= today) return thisYear;
  return isRealDate(year + 1, month, day) ? toKey(Date.UTC(year + 1, month, day)) : null;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const handles = (p: Person) => {
  const out = new Set<string>();
  const local = norm(p.email.split("@")[0]);
  out.add(local);
  if (p.name) {
    const n = norm(p.name);
    out.add(n);
    out.add(n.replace(/\s+/g, ""));
    out.add(n.split(/\s+/)[0]);
  }
  return out;
};

/** "@sam", "for Sam", "assign to Sam Lee" — only when exactly one person fits. */
export const findAssignee = (text: string, people: Person[]): Hit<number> => {
  const at = text.match(/(?:^|\s)(?:(?:assign(?:ed)?\s+to|for)\s+)?@([\p{L}\p{N}._-]+)/iu);
  const candidates: { token: string; match: string }[] = [];
  if (at) candidates.push({ token: norm(at[1]), match: at[0] });
  const phrase = text.match(/\b(?:assign(?:ed)?\s+to|for|owner:?)\s+([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)?)/iu);
  if (phrase) {
    const words = phrase[1].split(/\s+/);
    // Prefer the full name, then the first word ("for Sam Lee" vs "for Sam to review")
    candidates.push({ token: norm(words.join(" ")), match: phrase[0] });
    if (words.length > 1) candidates.push({ token: norm(words[0]), match: phrase[0].replace(new RegExp(`\\s+${words.slice(1).join("\\s+")}$`), "") });
  }
  for (const c of candidates) {
    const hits = people.filter((p) => handles(p).has(c.token));
    if (hits.length === 1) return { value: hits[0].id, match: c.match };
  }
  return null;
};

export const findLabels = (text: string, labels: LabelRef[]): { ids: string[]; matches: string[] } => {
  const ids: string[] = [];
  const matches: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)) {
    const l = labels.find((x) => norm(x.name).replace(/\s+/g, "-") === norm(m[1]) || norm(x.name) === norm(m[1]));
    if (l && !ids.includes(l.id)) {
      ids.push(l.id);
      matches.push(m[0]);
    }
  }
  return { ids, matches };
};

/** "in Website", "in WEB", "[WEB]" — exact project name or key only. */
export const findProject = (text: string, projects: ProjectRef[]): Hit<string> => {
  const bracket = text.match(/\[([A-Za-z][A-Za-z0-9]{1,9})\]/);
  if (bracket) {
    const p = projects.find((x) => x.key.toLowerCase() === bracket[1].toLowerCase());
    if (p) return { value: p.id, match: bracket[0] };
  }
  for (const p of [...projects].sort((a, b) => b.name.length - a.name.length)) {
    for (const label of [p.name, p.key]) {
      const re = new RegExp(String.raw`\b(?:in|to|under)\s+(?:the\s+)?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\s+project)?\b`, "i");
      const m = text.match(re);
      if (m) return { value: p.id, match: m[0] };
    }
  }
  return null;
};

const cleanTitle = (s: string) => {
  const t = s
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, "")
    .replace(/\b(?:and|with|,)\s*$/i, "")
    .trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/** Reads everything it can; whatever it doesn't understand stays in the title. */
export const parseTask = (input: string, ctx: ParseContext): { draft: Draft; understood: string[] } => {
  let text = ` ${input.replace(/\s+/g, " ").trim()} `;
  const understood: string[] = [];
  const draft: Draft = { title: "", labelIds: [] };
  const cut = (m: string) => {
    text = text.replace(m, " ");
  };

  const labels = findLabels(text, ctx.labels);
  if (labels.ids.length) {
    draft.labelIds = labels.ids;
    understood.push(labels.ids.length === 1 ? "label" : "labels");
    labels.matches.forEach(cut);
  }
  const pr = findPriority(text);
  if (pr) {
    draft.priority = pr.value;
    understood.push("priority");
    cut(pr.match);
  }
  const due = findDueDate(text, ctx.today);
  if (due) {
    draft.dueDate = due.value;
    understood.push("due date");
    cut(due.match);
  }
  const who = findAssignee(text, ctx.people);
  if (who) {
    draft.assigneeId = who.value;
    understood.push("assignee");
    cut(who.match);
  }
  const proj = findProject(text, ctx.projects);
  if (proj) {
    draft.projectId = proj.value;
    understood.push("project");
    cut(proj.match);
  }
  draft.title = cleanTitle(text).slice(0, 200) || cleanTitle(input).slice(0, 200);
  return { draft, understood };
};
