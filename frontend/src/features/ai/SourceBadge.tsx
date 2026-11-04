import { Sparkles, Cog } from "lucide-react";
import { cx } from "../../ui/cx";
import { REASON_TEXT, type Sourced } from "./ai";

/** Says plainly whether a model wrote this or the built-in rules did, and why. */
export const SourceBadge = ({ r, className }: { r: Sourced; className?: string }) => {
  const why = r.fallbackReason ? REASON_TEXT[r.fallbackReason] : "Written by AI. Check it before you act on it.";
  return (
    <span title={why} className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", r.source === "ai" ? "bg-accent/12 text-accent" : "bg-elev text-muted", className)}>
      {r.source === "ai" ? <Sparkles className="size-3" aria-hidden /> : <Cog className="size-3" aria-hidden />}
      <span>{r.source === "ai" ? "AI suggestion" : "Rule-based"}</span>
      <span className="sr-only">{why}</span>
    </span>
  );
};
