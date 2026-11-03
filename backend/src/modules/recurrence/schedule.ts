import type { RecurrenceFrequency } from "@prisma/client";

/**
 * Pure date arithmetic on calendar dates ("YYYY-MM-DD", UTC). No time zones,
 * no clocks: easy to test and identical on every server.
 */

export interface Rule {
  frequency: RecurrenceFrequency;
  interval: number;
  /** 0 = Monday … 6 = Sunday */
  weekdays: number[];
  monthDay: number | null;
}

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toKey(toMs(d) + n * DAY);
/** Monday = 0 */
export const weekdayOf = (d: string) => (new Date(toMs(d)).getUTCDay() + 6) % 7;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Same anchor day in a later month, clamped: Jan 31 → Feb 28 → Mar 31. */
const addMonthsAnchored = (d: string, months: number, anchor: number) => {
  const dt = new Date(toMs(d));
  const total = dt.getUTCFullYear() * 12 + dt.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = total % 12;
  return toKey(Date.UTC(y, m, Math.min(anchor, daysInMonth(y, m))));
};

/** The first occurrence strictly after `from`. */
export const nextOccurrence = (rule: Rule, from: string): string => {
  const interval = Math.max(1, rule.interval);
  switch (rule.frequency) {
    case "DAILY":
      return addDays(from, interval);
    case "WEEKLY": {
      const days = [...new Set(rule.weekdays.length ? rule.weekdays : [weekdayOf(from)])].sort((a, b) => a - b);
      const today = weekdayOf(from);
      const laterThisWeek = days.find((d) => d > today);
      if (laterThisWeek !== undefined) return addDays(from, laterThisWeek - today);
      // Jump to the Monday `interval` weeks after this week's Monday, then to the first chosen day
      const monday = addDays(from, -today);
      return addDays(monday, interval * 7 + days[0]);
    }
    case "MONTHLY":
      return addMonthsAnchored(from, interval, rule.monthDay ?? new Date(toMs(from)).getUTCDate());
    case "YEARLY":
      return addMonthsAnchored(from, interval * 12, rule.monthDay ?? new Date(toMs(from)).getUTCDate());
  }
};

/** Human summary, used in activity history and the UI. */
export const describeRule = (rule: Rule): string => {
  const n = Math.max(1, rule.interval);
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  switch (rule.frequency) {
    case "DAILY":
      return every("day");
    case "WEEKLY":
      return `${every("week")}${rule.weekdays.length ? ` on ${[...rule.weekdays].sort().map((d) => NAMES[d]).join(", ")}` : ""}`;
    case "MONTHLY":
      return `${every("month")}${rule.monthDay ? ` on day ${rule.monthDay}` : ""}`;
    case "YEARLY":
      return every("year");
  }
};
