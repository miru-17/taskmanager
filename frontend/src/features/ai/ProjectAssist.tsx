import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, ArrowRight, Gauge, ScrollText, ShieldAlert } from "lucide-react";
import api from "../../services/api";
import { useProjectAction } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { PRIORITY_LABELS, type Priority, type Project } from "../../types/Task";
import { Button, Dialog, PriorityIcon } from "../../ui";
import { cx } from "../../ui/cx";
import { useTaskParam } from "../tasks/composer";
import { aiPost, type PrioritySuggestions, type RiskReport, type Summary } from "./ai";
import { SourceBadge } from "./SourceBadge";

const SEVERITY: Record<RiskReport["risks"][number]["severity"], { label: string; tone: string }> = {
  high: { label: "High", tone: "bg-danger/12 text-danger" },
  medium: { label: "Medium", tone: "bg-warning/12 text-warning" },
  low: { label: "Low", tone: "bg-elev text-muted" },
};

/** Tick the changes you want; they're applied with the normal bulk update, one call per priority. */
const PriorityDialog = ({ result, onClose }: { result: PrioritySuggestions; onClose: () => void }) => {
  const [picked, setPicked] = useState<Set<number>>(new Set(result.suggestions.map((s) => s.taskId)));
  const apply = useProjectAction(async () => {
    const groups = new Map<Priority, number[]>();
    for (const s of result.suggestions.filter((x) => picked.has(x.taskId))) groups.set(s.suggested, [...(groups.get(s.suggested) ?? []), s.taskId]);
    for (const [priority, ids] of groups) await api.post("/tasks/bulk", { ids, action: "update", data: { priority } });
  }, "Could not change the priorities");
  return (
    <Dialog
      open
      onClose={onClose}
      title="Suggested priorities"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {result.suggestions.length ? "Cancel" : "Close"}
          </Button>
          {result.suggestions.length > 0 && (
            <Button
              variant="primary"
              disabled={!picked.size}
              loading={apply.isPending}
              onClick={() => apply.mutate(undefined, { onSuccess: () => (toast.success(`Updated ${picked.size} task${picked.size === 1 ? "" : "s"}`), onClose()) })}
            >
              Apply {picked.size} change{picked.size === 1 ? "" : "s"}
            </Button>
          )}
        </>
      }
    >
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <SourceBadge r={result} />
        {result.suggestions.length ? "Nothing changes until you apply. Untick anything you disagree with." : "No changes suggested: priorities already fit the due dates and dependencies."}
      </p>
      {result.suggestions.length > 0 && (
        <ul className="divide-y divide-line" aria-label="Priority suggestions">
          {result.suggestions.map((s) => (
            <li key={s.taskId} className="flex items-start gap-3 py-2">
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Apply to ${s.key}`}
                checked={picked.has(s.taskId)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(s.taskId);
                  else next.delete(s.taskId);
                  setPicked(next);
                }}
              />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate">
                  <span className="text-xs text-muted">{s.key}</span> {s.title}
                </p>
                <p className="text-xs text-muted">{s.reason}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-xs">
                <PriorityIcon priority={s.current} /> {PRIORITY_LABELS[s.current]}
                <ArrowRight className="size-3 text-muted" aria-label="to" />
                <PriorityIcon priority={s.suggested} /> <strong>{PRIORITY_LABELS[s.suggested]}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
};

/** Risks, workload, status report and priority suggestions for one project, on request. */
export const ProjectAssist = ({ project }: { project: Project }) => {
  const { openTask } = useTaskParam();
  const [risks, setRisks] = useState<RiskReport | null>(null);
  const [report, setReport] = useState<Summary | null>(null);
  const [priorities, setPriorities] = useState<PrioritySuggestions | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = project.capabilities?.editTasks !== "none" && project.status !== "ARCHIVED";
  const go = async <T,>(kind: string, path: string, set: (v: T) => void) => {
    setBusy(kind);
    try {
      set(await aiPost<T>(path));
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't work"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label="Project assistant">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-medium">Risks and workload</h2>
        <Button size="sm" icon={<ShieldAlert className="size-3.5" />} loading={busy === "risks"} onClick={() => go("risks", `/projects/${project.id}/risks`, setRisks)}>
          {risks ? "Check again" : "Check risks"}
        </Button>
        <Button size="sm" icon={<ScrollText className="size-3.5" />} loading={busy === "report"} onClick={() => go("report", `/projects/${project.id}/summary`, setReport)}>
          Status report
        </Button>
        {canEdit && (
          <Button size="sm" icon={<Gauge className="size-3.5" />} loading={busy === "prio"} onClick={() => go("prio", `/projects/${project.id}/prioritize`, setPriorities)}>
            Suggest priorities
          </Button>
        )}
      </div>

      {!risks && !report && <p className="mt-3 text-sm text-muted">Find overdue chains, unowned critical work and overloaded people, or get a short status report.</p>}

      {report && (
        <div className="mt-4 space-y-1.5 rounded-lg bg-elev/60 p-3 text-sm" aria-label="Status report">
          <SourceBadge r={report} />
          <p>{report.summary}</p>
          {report.highlights.length > 0 && (
            <ul className="list-disc pl-5 text-fg-soft">
              {report.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {risks && (
        <div className="mt-4 space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <SourceBadge r={risks} />
            <span className="text-fg-soft">{risks.narrative}</span>
          </p>
          {risks.risks.length > 0 && (
            <ul className="space-y-2" aria-label="Risks">
              {risks.risks.map((r) => (
                <li key={r.kind + r.title} className="rounded-lg border border-line p-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]", SEVERITY[r.severity].tone)}>
                      <AlertTriangle className="size-3" aria-hidden /> {SEVERITY[r.severity].label}
                    </span>
                    {r.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{r.detail}</p>
                  {r.tasks.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.tasks.slice(0, 6).map((t) => (
                        <button key={t.id} type="button" title={t.title} onClick={() => openTask(t.id)} className="rounded border border-line px-1.5 py-0.5 text-xs hover:border-accent hover:text-accent">
                          {t.key}
                        </button>
                      ))}
                      {r.tasks.length > 6 && <span className="px-1 text-xs text-muted">+{r.tasks.length - 6} more</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {risks.workload.some((w) => w.user) && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Workload, next 7 days">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 font-medium">Person</th>
                    <th className="py-1 text-right font-medium">Open</th>
                    <th className="py-1 text-right font-medium">Due in 7 days</th>
                    <th className="py-1 text-right font-medium">Estimated hours</th>
                    <th className="py-1 text-right font-medium">Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  {risks.workload.map((w) => (
                    <tr key={w.user?.id ?? "none"}>
                      <td className="py-1">{w.user?.name ?? "Unassigned"}</td>
                      <td className="py-1 text-right">{w.open}</td>
                      <td className="py-1 text-right">{w.dueNext7}</td>
                      <td className="py-1 text-right">
                        {Math.round(w.hoursNext7 * 10) / 10}
                        {w.unestimatedNext7 > 0 && <span className="text-xs text-muted"> (+{w.unestimatedNext7} unestimated)</span>}
                      </td>
                      <td className={cx("py-1 text-right", w.overdue > 0 && "text-danger")}>{w.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {priorities && <PriorityDialog result={priorities} onClose={() => setPriorities(null)} />}
    </section>
  );
};
