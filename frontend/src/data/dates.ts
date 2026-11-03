/**
 * Due/start dates are calendar dates stored as UTC midnight. Read them back
 * in UTC so a task due "2026-11-05" shows the 5th in every time zone.
 */
export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

const DAY = 86_400_000;
export const todayKey = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};
export const keyToUtc = (key: string) => new Date(`${key}T00:00:00Z`).getTime();
export const addDays = (key: string, n: number) => new Date(keyToUtc(key) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((keyToUtc(b) - keyToUtc(a)) / DAY);

const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const fmtYear = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const formatDay = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.getUTCFullYear() === new Date().getFullYear() ? fmt.format(d) : fmtYear.format(d);
};

/** Relative wording for due dates: Overdue / Today / Tomorrow / Nov 5 */
export const dueLabel = (iso: string | null, done: boolean) => {
  if (!iso) return null;
  const diff = daysBetween(todayKey(), toDateInput(iso));
  if (!done && diff < 0) return { text: `${formatDay(iso)} · overdue`, tone: "danger" as const };
  if (diff === 0) return { text: "Today", tone: done ? ("muted" as const) : ("warning" as const) };
  if (diff === 1) return { text: "Tomorrow", tone: "muted" as const };
  return { text: formatDay(iso), tone: "muted" as const };
};

export const isOverdue = (iso: string | null, done: boolean) => !done && !!iso && daysBetween(todayKey(), toDateInput(iso)) < 0;

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export const timeAgo = (iso: string) => {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return formatDay(iso);
};
