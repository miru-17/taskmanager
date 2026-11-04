import { useState } from "react";
import toast from "react-hot-toast";
import { ListTree, ScrollText } from "lucide-react";
import api from "../../services/api";
import { useProjectAction } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import type { TaskDetail } from "../../types/Task";
import { Button, Dialog, fieldBase } from "../../ui";
import { Section } from "../tasks/DrawerExtras";
import { aiPost, type Breakdown, type Summary } from "./ai";
import { SourceBadge } from "./SourceBadge";

type Row = { title: string; estimateHours: number | null; pick: boolean };

/** Review proposed subtasks; only the ticked ones are created, through the normal task API. */
const BreakdownDialog = ({ task, proposal, onClose }: { task: TaskDetail; proposal: Breakdown; onClose: () => void }) => {
  const [rows, setRows] = useState<Row[]>(proposal.subtasks.map((s) => ({ ...s, pick: true })));
  const picked = rows.filter((r) => r.pick && r.title.trim());
  const create = useProjectAction(async () => {
    let made = 0;
    try {
      for (const r of picked) {
        await api.post("/tasks", { title: r.title.trim(), projectId: task.projectId, parentId: task.id, estimateHours: r.estimateHours });
        made++;
      }
    } finally {
      if (made) toast.success(`Added ${made} subtask${made === 1 ? "" : "s"}`);
    }
  }, "Could not add the subtasks");
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Break down ${task.key}`}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked.length} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: onClose })}>
            Add {picked.length} subtask{picked.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <SourceBadge r={proposal} />
        {proposal.basis === "description" ? "Taken from the steps in the description." : proposal.basis === "template" ? "A general plan for this kind of task." : "Edit or untick anything before adding."}
      </p>
      <ul className="space-y-2" aria-label="Proposed subtasks">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <input type="checkbox" aria-label={`Include subtask ${i + 1}`} checked={r.pick} onChange={(e) => set(i, { pick: e.target.checked })} />
            <input aria-label={`Subtask ${i + 1} title`} className={`${fieldBase} min-w-0 flex-1`} maxLength={200} value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
            <input
              aria-label={`Subtask ${i + 1} estimate in hours`}
              type="number"
              min={0}
              step={0.5}
              placeholder="h"
              className={`${fieldBase} w-16`}
              value={r.estimateHours ?? ""}
              onChange={(e) => set(i, { estimateHours: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
            />
          </li>
        ))}
      </ul>
    </Dialog>
  );
};

/** "Summarize" and "Break down" in the task panel. Both only propose. */
export const TaskAssist = ({ task }: { task: TaskDetail }) => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [proposal, setProposal] = useState<Breakdown | null>(null);
  const [busy, setBusy] = useState<"summary" | "breakdown" | null>(null);
  const canBreakDown = task.permissions.createSubtasks && !task.parentId && !task.archivedAt;
  const run = async (kind: "summary" | "breakdown") => {
    setBusy(kind);
    try {
      if (kind === "summary") setSummary(await aiPost<Summary>(`/tasks/${task.id}/summary`));
      else {
        const p = await aiPost<Breakdown>(`/tasks/${task.id}/breakdown`);
        if (!p.subtasks.length) toast("No new subtasks to suggest");
        else setProposal(p);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, kind === "summary" ? "Couldn't summarize" : "Couldn't break it down"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section
      title="Assist"
      action={
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" icon={<ScrollText className="size-3.5" />} loading={busy === "summary"} onClick={() => run("summary")}>
            Summarize
          </Button>
          {canBreakDown && (
            <Button size="sm" variant="ghost" icon={<ListTree className="size-3.5" />} loading={busy === "breakdown"} onClick={() => run("breakdown")}>
              Break down
            </Button>
          )}
        </span>
      }
    >
      {summary ? (
        <div className="space-y-2 text-sm" aria-live="polite">
          <SourceBadge r={summary} />
          <p className="text-fg">{summary.summary}</p>
          {summary.highlights.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-fg-soft">
              {summary.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="px-1 text-sm text-muted">Get a summary of where this stands{canBreakDown ? ", or a proposed list of subtasks" : ""}.</p>
      )}
      {proposal && <BreakdownDialog task={task} proposal={proposal} onClose={() => setProposal(null)} />}
    </Section>
  );
};
