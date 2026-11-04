import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, FlaskConical, History, Pencil, Plus, Trash2, Workflow, XCircle } from "lucide-react";
import api from "../../services/api";
import { useOrgKey, useProjectAction, useTasks } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { timeAgo } from "../../data/dates";
import { displayName, type AutomationDryRun, type AutomationRule, type AutomationRun, type AutomationRunStatus } from "../../types/Task";
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, Spinner, fieldBase } from "../../ui";
import { cx } from "../../ui/cx";
import { useProjectOutlet } from "../projects/ProjectLayout";
import { useTaskParam } from "../tasks/composer";
import { RuleBuilder, type Draft } from "../automations/RuleBuilder";
import { RECIPES } from "../automations/recipes";
import { RUN_STATUS, describeCondition, describeRule, describeRun } from "../automations/wording";
import { useNames } from "../automations/useNames";

const useRules = (projectId: string) => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "automations", projectId],
    queryFn: async () => (await api.get<{ canManage: boolean; rules: AutomationRule[] }>(`/projects/${projectId}/automations`)).data,
  });
};

const useRuns = (ruleId: string, status: AutomationRunStatus | "") => {
  const org = useOrgKey();
  return useQuery({
    queryKey: ["org", org, "automation-runs", ruleId, status],
    queryFn: async () => (await api.get<{ counts: Partial<Record<AutomationRunStatus, number>>; runs: AutomationRun[] }>(`/automations/${ruleId}/runs`, { params: { limit: 50, ...(status ? { status } : {}) } })).data,
  });
};

const RunBadge = ({ status }: { status: AutomationRunStatus }) => {
  const Icon = status === "SUCCEEDED" ? CheckCircle2 : status === "FAILED" ? XCircle : status === "LOOP_BLOCKED" ? AlertTriangle : History;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", RUN_STATUS[status].tone)}>
      <Icon className="size-3" aria-hidden />
      {RUN_STATUS[status].label}
    </span>
  );
};

const RunLog = ({ rule, projectId }: { rule: AutomationRule; projectId: string }) => {
  const [status, setStatus] = useState<AutomationRunStatus | "">("");
  const { data, isPending, isError, error, refetch } = useRuns(rule.id, status);
  const names = useNames(projectId);
  const { openTask } = useTaskParam();
  if (isPending) return <Spinner label="Loading runs…" />;
  if (isError) return <ErrorState message={getErrorMessage(error, "Couldn't load the run log")} onRetry={() => refetch()} />;
  const total = Object.values(data.counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Filter runs">
        {(["", "SUCCEEDED", "SKIPPED", "FAILED", "LOOP_BLOCKED"] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cx("rounded-md px-2 py-1 text-xs", status === s ? "bg-elev font-medium text-fg" : "text-muted hover:text-fg")}
          >
            {s ? RUN_STATUS[s].label : "All"} <span className="tabular-nums text-muted">{s ? (data.counts[s] ?? 0) : total}</span>
          </button>
        ))}
      </div>
      {data.runs.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{total ? "No runs with this outcome." : "This rule hasn't been triggered yet."}</p>
      ) : (
        <ol className="divide-y divide-line text-sm" aria-label={`Runs of ${rule.name}`}>
          {data.runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <RunBadge status={r.status} />
              {r.task ? (
                <button type="button" className="text-left hover:text-accent" onClick={() => openTask(r.task!.id)}>
                  <span className="text-xs text-muted">{r.task.key}</span> {r.task.title}
                </button>
              ) : (
                <span className="text-muted">Deleted task</span>
              )}
              <span className="min-w-0 flex-1 basis-60 text-fg-soft">{describeRun(r.status, r.detail, names)}</span>
              {r.depth > 0 && <span className="text-xs text-muted" title="Triggered by another automation's change">chained</span>}
              <time className="text-xs text-muted" dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>
                {timeAgo(r.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

const TestDialog = ({ rule, projectId, onClose }: { rule: AutomationRule; projectId: string; onClose: () => void }) => {
  const { data: tasks } = useTasks({ projectId, sort: "updatedAt", order: "desc" });
  const [taskId, setTaskId] = useState<number | null>(null);
  const [result, setResult] = useState<AutomationDryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const names = useNames(projectId);
  const run = async () => {
    if (!taskId) return;
    setBusy(true);
    try {
      setResult((await api.post<AutomationDryRun>(`/automations/${rule.id}/test`, { taskId })).data);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't test the rule"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Test “${rule.name}”`} width="max-w-lg">
      <p className="text-sm text-muted">See whether this rule would act on a task, and what it would do. Nothing is changed.</p>
      <div className="mt-3 flex gap-2">
        <select aria-label="Task to test against" className={`${fieldBase} min-w-0 flex-1`} value={taskId ?? ""} onChange={(e) => (setTaskId(e.target.value ? Number(e.target.value) : null), setResult(null))}>
          <option value="">Pick a task…</option>
          {tasks?.items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.key} {t.title}
            </option>
          ))}
        </select>
        <Button variant="primary" disabled={!taskId} loading={busy} onClick={run}>
          Test
        </Button>
      </div>
      {result && (
        <div className="mt-4 space-y-3 text-sm" aria-live="polite">
          <p className={cx("flex items-center gap-2 font-medium", result.wouldRun ? "text-success" : "text-fg")}>
            {result.wouldRun ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4 text-muted" aria-hidden />}
            {result.wouldRun ? "It would run on this task" : result.enabled ? "It would not run on this task" : "It would not run: the rule is off"}
          </p>
          <p className="text-muted">{result.triggerNote}, then:</p>
          {result.conditions.length > 0 && (
            <ul className="space-y-1">
              {result.conditions.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  {c.holds ? <CheckCircle2 className="size-3.5 text-success" aria-label="true" /> : <XCircle className="size-3.5 text-danger" aria-label="false" />}
                  {describeCondition(c.condition, names)}
                </li>
              ))}
            </ul>
          )}
          <ol className="list-decimal space-y-0.5 pl-5 text-fg-soft">
            {result.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
          {result.problems.map((p) => (
            <p key={p} className="flex items-center gap-2 text-danger">
              <AlertTriangle className="size-3.5" aria-hidden />
              {p}
            </p>
          ))}
        </div>
      )}
    </Dialog>
  );
};

const RuleCard = ({ rule, projectId, canManage, onEdit }: { rule: AutomationRule; projectId: string; canManage: boolean; onEdit: () => void }) => {
  const names = useNames(projectId);
  const [showLog, setShowLog] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const toggle = useProjectAction(() => api.patch(`/automations/${rule.id}`, { enabled: !rule.enabled }), "Could not change the rule");
  const remove = useProjectAction(() => api.delete(`/automations/${rule.id}`), "Could not delete the rule");

  return (
    <li className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        {canManage ? (
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            aria-label={`${rule.enabled ? "Turn off" : "Turn on"} ${rule.name}`}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(undefined, { onSuccess: () => toast.success(rule.enabled ? "Automation turned off" : "Automation turned on") })}
            className={cx("mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50", rule.enabled ? "bg-accent" : "bg-line-strong")}
          >
            <span className={cx("size-4 rounded-full bg-white shadow transition-transform", rule.enabled && "translate-x-4")} />
          </button>
        ) : (
          <span className={cx("mt-1 rounded-md px-1.5 py-0.5 text-xs", rule.enabled ? "bg-success/12 text-success" : "bg-elev text-muted")}>{rule.enabled ? "On" : "Off"}</span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{rule.name}</h3>
          <p className="mt-0.5 text-sm text-fg-soft">{describeRule(rule, names)}</p>
          <p className="mt-1 text-xs text-muted">
            {rule.runCount ? `Ran ${rule.runCount} time${rule.runCount === 1 ? "" : "s"}` : "Hasn't run yet"}
            {rule.lastRunAt && ` · last ${timeAgo(rule.lastRunAt)}`}
            {rule.createdBy && ` · by ${displayName(rule.createdBy)}`}
          </p>
          {rule.disabledReason && !rule.enabled && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning" role="status">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              Switched off automatically because {rule.disabledReason}. Fix the rule, then turn it back on.
            </p>
          )}
          {rule.enabled && rule.failureStreak > 0 && <p className="mt-2 text-xs text-danger">Failed the last {rule.failureStreak} time{rule.failureStreak === 1 ? "" : "s"}; see the run log.</p>}
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label={showLog ? "Hide run log" : "Show run log"} aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
            <History className="size-4" />
          </IconButton>
          {canManage && (
            <>
              <IconButton label="Test on a task" onClick={() => setTesting(true)}>
                <FlaskConical className="size-4" />
              </IconButton>
              <IconButton label={`Edit ${rule.name}`} onClick={onEdit}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton label={`Delete ${rule.name}`} onClick={() => setConfirm(true)}>
                <Trash2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {showLog && <RunLog rule={rule} projectId={projectId} />}
      {testing && <TestDialog rule={rule} projectId={projectId} onClose={() => setTesting(false)} />}
      <ConfirmDialog
        open={confirm}
        title="Delete this automation?"
        message={`“${rule.name}” and its run log will be deleted. Changes it already made stay.`}
        loading={remove.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => (toast.success("Automation deleted"), setConfirm(false)) })}
      />
    </li>
  );
};

const AutomationsView = () => {
  const { project } = useProjectOutlet();
  const { data, isPending, isError, error, refetch } = useRules(project.id);
  const [builder, setBuilder] = useState<{ editing: AutomationRule | null; initial?: Draft; key: number } | null>(null);
  const archived = project.status === "ARCHIVED";

  if (isPending) return <Spinner label="Loading automations…" />;
  if (isError) return <div className="p-6"><ErrorState message={getErrorMessage(error, "Couldn't load automations")} onRetry={() => refetch()} /></div>;
  const canManage = data.canManage && !archived;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Automations</h2>
            <p className="text-sm text-muted">Rules that act on this project's tasks when something happens.{!data.canManage && " Only project managers can change them."}</p>
          </div>
          {canManage && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setBuilder({ editing: null, key: Date.now() })}>
              New automation
            </Button>
          )}
        </div>
        {archived && <p className="text-sm text-warning">This project is archived, so its automations don't run.</p>}

        {data.rules.length === 0 ? (
          <>
            <EmptyState icon={<Workflow className="size-8" />} title="No automations yet">
              {canManage ? "Start from a recipe below, or build your own." : "Project managers can add rules here."}
            </EmptyState>
            {canManage && (
              <ul className="grid gap-3 sm:grid-cols-2" aria-label="Recipes">
                {RECIPES.map((r) => (
                  <li key={r.title}>
                    <button
                      type="button"
                      className="h-full w-full rounded-xl border border-line bg-surface p-4 text-left shadow-card transition-colors hover:border-accent/60"
                      onClick={() => setBuilder({ editing: null, initial: structuredClone(r.draft), key: Date.now() })}
                    >
                      <span className="block font-medium">{r.title}</span>
                      <span className="mt-1 block text-sm text-muted">{r.blurb}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <ul className="space-y-3">
            {data.rules.map((r) => (
              <RuleCard key={r.id} rule={r} projectId={project.id} canManage={canManage} onEdit={() => setBuilder({ editing: r, key: Date.now() })} />
            ))}
          </ul>
        )}
      </div>
      {builder && <RuleBuilder key={builder.key} projectId={project.id} open onClose={() => setBuilder(null)} editing={builder.editing} initial={builder.initial} />}
    </div>
  );
};

export default AutomationsView;
