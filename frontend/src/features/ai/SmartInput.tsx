import { useState } from "react";
import toast from "react-hot-toast";
import { Wand2 } from "lucide-react";
import { getErrorMessage } from "../../data/errors";
import { Button, fieldBase } from "../../ui";
import { aiPost, type ParsedDraft } from "./ai";
import { SourceBadge } from "./SourceBadge";

/**
 * "Describe the task" → fills the composer's fields. Nothing is created here:
 * the person reviews the filled-in form and presses Create.
 */
export const SmartInput = ({ projectId, onFill }: { projectId?: string; onFill: (d: ParsedDraft["draft"]) => void }) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ParsedDraft | null>(null);
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await aiPost<ParsedDraft>("/parse", { text: text.trim(), ...(projectId ? { projectId } : {}) });
      onFill(r.draft);
      setLast(r);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't read that"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-2">
      <div className="flex gap-2">
        <input
          aria-label="Describe the task"
          className={`${fieldBase} min-w-0 flex-1`}
          maxLength={500}
          placeholder="Describe it: “Fix checkout bug for @sam by friday #urgent high priority”"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
        />
        <Button icon={<Wand2 className="size-4" />} loading={busy} disabled={!text.trim()} onClick={run}>
          Fill in
        </Button>
      </div>
      {last && (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted" aria-live="polite">
          <SourceBadge r={last} />
          {last.understood.length ? `Filled in the title and ${last.understood.join(", ")}.` : "Filled in the title."} Review before creating.
          {last.dropped.length > 0 && <span className="text-warning">Ignored a suggested {last.dropped.join(", ")} that isn't valid here.</span>}
        </p>
      )}
    </div>
  );
};
