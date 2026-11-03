import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useApprovals } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { formatDay, timeAgo } from "../../data/dates";
import { displayName, type ApprovalListItem } from "../../types/Task";
import { Avatar, EmptyState, ErrorState, Spinner, StatusIcon } from "../../ui";
import { cx } from "../../ui/cx";
import { useTaskParam } from "../tasks/composer";

const STATE: Record<ApprovalListItem["status"], { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-warning/12 text-warning" },
  APPROVED: { label: "Approved", className: "bg-success/12 text-success" },
  REJECTED: { label: "Changes requested", className: "bg-danger/12 text-danger" },
  CANCELLED: { label: "Cancelled", className: "bg-elev text-muted" },
};

/** Approvals waiting on me, and the ones I asked for. Deciding happens in the task drawer. */
const Approvals = () => {
  const [scope, setScope] = useState<"to-me" | "by-me">("to-me");
  const { data, isPending, isError, error, refetch } = useApprovals(scope);
  const { openTask } = useTaskParam();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
      <p className="mt-1 text-sm text-muted">Sign off on work, or follow up on what you've sent for review.</p>

      <div className="mt-6 flex gap-1 border-b border-line">
        {(
          [
            ["to-me", "Waiting on me"],
            ["by-me", "Requested by me"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={scope === id}
            onClick={() => setScope(id)}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm", scope === id ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {isPending ? (
          <Spinner />
        ) : isError ? (
          <ErrorState message={getErrorMessage(error, "Couldn't load approvals")} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-8" />} title={scope === "to-me" ? "You're all caught up" : "Nothing requested"}>
            {scope === "to-me" ? "No approvals are waiting on you." : "Approvals you request from a task show up here."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            {data.map((r) => {
              const done = r.steps.filter((s) => s.decision !== "PENDING").length;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => openTask(r.task.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-elev">
                    <StatusIcon status={r.task.status} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted">{r.task.key}</span>
                        <span className="truncate text-sm font-medium">{r.task.title}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span className="inline-flex items-center gap-1">
                          <span className="size-2 rounded-sm" style={{ background: r.task.project.color }} aria-hidden />
                          {r.task.project.name}
                        </span>
                        <span>
                          {scope === "to-me" ? `from ${displayName(r.requestedBy)}` : `${done}/${r.steps.length} responded`} · {timeAgo(r.createdAt)}
                        </span>
                        {r.task.dueDate && <span>· due {formatDay(r.task.dueDate)}</span>}
                      </span>
                      {r.note && <span className="mt-1 block truncate text-xs text-fg-soft">“{r.note}”</span>}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", STATE[r.status].className)}>{STATE[r.status].label}</span>
                      <span className="flex -space-x-1">
                        {r.steps.map((s) => (
                          <Avatar key={s.approver.id} user={s.approver} size={18} />
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Approvals;
