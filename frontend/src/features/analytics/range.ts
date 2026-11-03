/** Today's calendar date in a time zone, as YYYY-MM-DD. */
export const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const PRESETS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "365d", label: "Last 12 months", days: 365 },
] as const;

export const presetRange = (id: string, tz: string) => {
  const to = todayIn(tz);
  const days = PRESETS.find((p) => p.id === id)?.days ?? 30;
  return { from: shift(to, -(days - 1)), to };
};

const short = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const long = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const shortDay = (d: string) => short.format(new Date(`${d}T00:00:00Z`));
export const longDay = (d: string) => long.format(new Date(`${d}T00:00:00Z`));
