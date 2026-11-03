import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { TaskFilters } from "../../data/queries";

// ─── Filters in the URL ──────────────────────────────────────────────────────

const FILTER_KEYS = ["q", "status", "priority", "assignee", "label"] as const;

/** Filters live in the query string, so a filtered view can be bookmarked or shared. */
export const useFilters = () => {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const filters: TaskFilters = useMemo(() => {
    const f: TaskFilters = {};
    if (get("q")) f.q = get("q");
    if (get("status")) f.status = get("status").split(",");
    if (get("priority")) f.priority = get("priority").split(",");
    const a = get("assignee");
    if (a) f.assigneeId = a === "me" || a === "none" ? a : Number(a);
    if (get("label")) f.labelId = get("label");
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = (k: (typeof FILTER_KEYS)[number], v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true }
    );
  const clear = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        FILTER_KEYS.forEach((k) => n.delete(k));
        return n;
      },
      { replace: true }
    );
  const raw = Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)])) as Record<(typeof FILTER_KEYS)[number], string>;
  const active = FILTER_KEYS.some((k) => raw[k]);
  const apply = (values: Record<string, unknown>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        FILTER_KEYS.forEach((k) => n.delete(k));
        for (const k of FILTER_KEYS) {
          const v = values[k];
          if (typeof v === "string" && v) n.set(k, v);
        }
        return n;
      },
      { replace: true }
    );
  return { filters, raw, set, clear, active, apply };
};
