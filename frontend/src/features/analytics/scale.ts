/** Clean axis ticks from 0: 0, 5, 10, 15, 20 rather than 0, 4.3, 8.6… */
export const niceTicks = (max: number, target = 4): number[] => {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const unit = Math.max(1, step); // counts are whole numbers
  const top = Math.ceil(max / unit) * unit;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += unit) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
};

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
/** Full under 10,000; compact above (12K). */
export const formatNumber = (v: number) => (Math.abs(v) >= 10_000 ? compact.format(v) : full.format(v));
