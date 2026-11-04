import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import api from "../../services/api";
import { getErrorMessage } from "../../data/errors";
import { Card } from "../../components/PageShell";
import { cx } from "../../ui/cx";
import { useAiStatus, type AiStatus } from "./ai";

/** Organization setting: whether task content may be sent to the configured model. */
export const AiSettingsCard = ({ canEdit }: { canEdit: boolean }) => {
  const { data: s } = useAiStatus();
  const qc = useQueryClient();
  if (!s) return null;
  const toggle = async () => {
    try {
      const next = (await api.patch<AiStatus>("/ai/settings", { enabled: !s.orgEnabled })).data;
      qc.setQueriesData({ predicate: (q) => q.queryKey.includes("ai-status") }, next);
      toast.success(next.orgEnabled ? "AI turned on" : "AI turned off");
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't change the AI setting"));
    }
  };
  const line = !s.configured
    ? "AI isn't set up on this server. Smart task entry, summaries, breakdowns, risks and the assistant use built-in rules instead, and nothing is sent anywhere."
    : s.orgEnabled
      ? `Using ${s.model}. Task titles, descriptions and comments that a person can see are sent to it when they use an AI feature. Every suggestion is shown for review before anything changes.`
      : "Turned off. AI features use built-in rules instead, and nothing is sent to the model.";
  return (
    <Card title="AI features">
      <div className="flex items-start gap-4">
        <p className="flex-1 text-sm text-fg-soft">{line}</p>
        {s.configured && canEdit && (
          <button
            type="button"
            role="switch"
            aria-checked={s.orgEnabled}
            aria-label="Use AI for this organization"
            onClick={toggle}
            className={cx("mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors", s.orgEnabled ? "bg-accent" : "bg-line-strong")}
          >
            <span className={cx("size-4 rounded-full bg-white shadow transition-transform", s.orgEnabled && "translate-x-4")} />
          </button>
        )}
      </div>
      {s.configured && s.orgEnabled && s.mode === "rules" && s.reason === "cooling_down" && <p className="mt-2 text-xs text-warning">The AI service failed recently; built-in rules are being used for a minute.</p>}
    </Card>
  );
};
