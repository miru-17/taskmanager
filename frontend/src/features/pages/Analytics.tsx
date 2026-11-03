import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, Printer } from "lucide-react";
import api from "../../services/api";
import { useAnalytics, useOrgMembers, useProjects, type AnalyticsScope } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { useAuth } from "../../context/AuthContext";
import {
  HEALTH_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  displayName,
  type AnalyticsSummary,
  type AnalyticsTrend,
  type ProjectAnalytics,
  type WorkloadRow,
} from "../../types/Task";
import { Avatar, Button, ErrorState, HealthBadge, Progress, Spinner, fieldBase } from "../../ui";
import { cx } from "../../ui/cx";
import { BarList, ChartCard, DataTable, Legend, LineChart } from "../analytics/charts";
import { formatNumber } from "../analytics/scale";
import { presetRange, PRESETS, shortDay, longDay } from "../analytics/range";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const Tile = ({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) => (
  <div className="print-avoid-break rounded-xl border border-line bg-surface p-4 shadow-card">
    <p className="text-xs text-muted">{label}</p>
    <p className={cx("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
  </div>
);

const days = (v: number | null) => (v === null ? "—" : `${formatNumber(v)} d`);
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** Filters live in the URL, so a report view can be shared and reloaded. */
const useScope = () => {
  const [params, setParams] = useSearchParams();
  const preset = params.get("range") ?? "30d";
  const custom = preset === "custom";
  const base = custom ? null : presetRange(preset, TZ);
  const scope: AnalyticsScope = {
    from: (custom ? params.get("from") : base?.from) ?? presetRange("30d", TZ).from,
    to: (custom ? params.get("to") : base?.to) ?? presetRange("30d", TZ).to,
    tz: TZ,
    projectId: params.get("project") ?? undefined,
    assigneeId: params.get("assignee") ?? undefined,
  };
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v) n.set(k, v);
          else n.delete(k);
        }
        return n;
      },
      { replace: true }
    );
  return { scope, preset, set };
};

const Analytics = () => {
  const { organization } = useAuth();
  const { scope, preset, set } = useScope();
  const { data: projects } = useProjects();
  const { data: members } = useOrgMembers();
  const summary = useAnalytics<AnalyticsSummary>("summary", scope);
  const trend = useAnalytics<AnalyticsTrend>("trend", scope);
  const workload = useAnalytics<{ people: WorkloadRow[] }>("workload", scope);
  const perProject = useAnalytics<{ projects: ProjectAnalytics[] }>("projects", scope);

  const points = useMemo(() => trend.data?.points ?? [], [trend.data]);
  const bucketWord = trend.data?.bucket === "week" ? "week" : "day";
  const projectName = scope.projectId ? projects?.find((p) => p.id === scope.projectId)?.name : null;

  const exportCsv = async (dataset: "tasks" | "workload") => {
    try {
      const res = await api.get<Blob>("/analytics/export.csv", { params: { ...Object.fromEntries(Object.entries(scope).filter(([, v]) => v)), dataset }, responseType: "blob" });
      const name = /filename="([^"]+)"/.exec(String(res.headers["content-disposition"] ?? ""))?.[1] ?? `taskforge-${dataset}.csv`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const cut = res.headers["x-export-truncated"];
      if (cut) toast(`Exported the first ${cut} rows. Narrow the filters to export the rest.`, { icon: "⚠️" });
      else toast.success(`Downloaded ${name}`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Export failed"));
    }
  };

  const error = summary.error ?? trend.error ?? workload.error ?? perProject.error;
  const s = summary.data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted">
            {projectName ?? `All projects you can see in ${organization?.name}`} · {longDay(scope.from)} – {longDay(scope.to)} · days in {summary.data?.range.tz ?? TZ}
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button icon={<Download className="size-4" />} onClick={() => exportCsv("tasks")}>
            Tasks CSV
          </Button>
          <Button icon={<Download className="size-4" />} onClick={() => exportCsv("workload")}>
            Workload CSV
          </Button>
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Print / PDF
          </Button>
        </div>
      </div>

      {/* One row of filters above every chart */}
      <div className="no-print mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <select aria-label="Date range" className={cx(fieldBase, "w-auto")} value={preset} onChange={(e) => set({ range: e.target.value, ...(e.target.value === "custom" ? { from: scope.from, to: scope.to } : { from: null, to: null }) })}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom range</option>
        </select>
        {preset === "custom" && (
          <>
            <input aria-label="From" type="date" className={cx(fieldBase, "w-40")} value={scope.from} max={scope.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            <input aria-label="To" type="date" className={cx(fieldBase, "w-40")} value={scope.to} min={scope.from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </>
        )}
        <select aria-label="Project" className={cx(fieldBase, "w-auto")} value={scope.projectId ?? ""} onChange={(e) => set({ project: e.target.value || null })}>
          <option value="">All projects</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
        {members && (
          <select aria-label="Assignee" className={cx(fieldBase, "w-auto")} value={scope.assigneeId ?? ""} onChange={(e) => set({ assignee: e.target.value || null })}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {displayName(m)}
              </option>
            ))}
          </select>
        )}
        {(summary.isFetching || trend.isFetching) && <span className="text-xs text-muted">Updating…</span>}
      </div>

      {error ? (
        <div className="mt-6">
          <ErrorState message={getErrorMessage(error, "Couldn't load analytics")} onRetry={() => [summary, trend, workload, perProject].forEach((q) => q.refetch())} />
        </div>
      ) : !s ? (
        <Spinner label="Crunching numbers…" />
      ) : (
        <div className="mt-6 space-y-4">
          <div role="group" aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Tile label="Completed" value={formatNumber(s.completed)} hint="in this range" />
            <Tile label="Created" value={formatNumber(s.created)} hint="in this range" />
            <Tile label="Open now" value={formatNumber(s.open)} />
            <Tile label="Overdue now" value={formatNumber(s.overdue)} tone={s.overdue ? "text-danger" : undefined} />
            <Tile label="Median cycle time" value={days(s.cycleTime.medianDays)} hint={s.cycleTime.sample ? `avg ${days(s.cycleTime.averageDays)} · ${s.cycleTime.sample} tasks` : "no completions"} />
            <Tile label="On time" value={pct(s.onTime.rate)} hint={s.onTime.withDueDate ? `${s.onTime.onTime} of ${s.onTime.withDueDate} with a due date` : "none had a due date"} />
            <Tile
              label="Actual vs estimate"
              value={s.hours.sample ? `${Math.round((s.hours.actual / Math.max(0.1, s.hours.estimated)) * 100)}%` : "—"}
              hint={s.hours.sample ? `${formatNumber(s.hours.actual)} h of ${formatNumber(s.hours.estimated)} h · ${s.hours.sample} tasks` : "no tasks with both"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Throughput"
              subtitle={`Tasks created and completed per ${bucketWord}. ${s.completed >= s.created ? "Finishing at least as fast as work arrives." : `${s.created - s.completed} more created than completed.`}`}
              legend={<Legend items={[{ label: "Created", color: "var(--series-2)" }, { label: "Completed", color: "var(--series-1)" }]} />}
              table={<DataTable head={[bucketWord === "week" ? "Week of" : "Day", "Created", "Completed"]} rows={points.map((p) => [longDay(p.start), p.created, p.completed])} />}
            >
              <LineChart
                describe={`Created and completed tasks per ${bucketWord}`}
                labels={points.map((p) => p.start)}
                formatLabel={shortDay}
                series={[
                  { name: "Created", color: "var(--series-2)", values: points.map((p) => p.created) },
                  { name: "Completed", color: "var(--series-1)", values: points.map((p) => p.completed) },
                ]}
              />
            </ChartCard>
            <ChartCard
              title="Burn-up"
              subtitle={points.length ? `Total scope vs. work done so far. ${points[points.length - 1].remaining} open at the end of the range.` : "Total scope vs. work done so far."}
              legend={<Legend items={[{ label: "Scope", color: "var(--series-2)" }, { label: "Done", color: "var(--series-1)" }]} />}
              table={<DataTable head={[bucketWord === "week" ? "Week of" : "Day", "Scope", "Done", "Remaining"]} rows={points.map((p) => [longDay(p.start), p.scope, p.done, p.remaining])} />}
            >
              <LineChart
                describe="Cumulative scope and completed tasks"
                labels={points.map((p) => p.start)}
                formatLabel={shortDay}
                series={[
                  { name: "Scope", color: "var(--series-2)", values: points.map((p) => p.scope) },
                  { name: "Done", color: "var(--series-1)", values: points.map((p) => p.done), area: true },
                ]}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Tasks by status" subtitle="Everything not archived, right now." table={<DataTable head={["Status", "Tasks"]} rows={s.byStatus.map((r) => [STATUS_LABELS[r.key], r.count])} />}>
              <BarList describe="Tasks by status" rows={s.byStatus.map((r) => ({ key: STATUS_LABELS[r.key], label: STATUS_LABELS[r.key], value: r.count }))} />
            </ChartCard>
            <ChartCard title="Open tasks by priority" subtitle="Not done yet, right now." table={<DataTable head={["Priority", "Open"]} rows={s.byPriority.map((r) => [PRIORITY_LABELS[r.key], r.count])} />}>
              <BarList describe="Open tasks by priority" rows={s.byPriority.map((r) => ({ key: PRIORITY_LABELS[r.key], label: PRIORITY_LABELS[r.key], value: r.count }))} />
            </ChartCard>
          </div>

          <section className="print-avoid-break rounded-xl border border-line bg-surface shadow-card" aria-label="Workload">
            <div className="flex items-baseline gap-2 border-b border-line px-4 py-3">
              <h2 className="font-medium">Workload</h2>
              <p className="text-xs text-muted">Open work per person now; completed in the selected range.</p>
            </div>
            {workload.data?.people.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Person</th>
                      <th className="w-[30%] px-2 py-2 font-medium">Open</th>
                      <th className="px-2 py-2 text-right font-medium">Overdue</th>
                      <th className="px-2 py-2 text-right font-medium">Due in 7 days</th>
                      <th className="px-2 py-2 text-right font-medium">Open estimate</th>
                      <th className="px-4 py-2 text-right font-medium">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(() => {
                      const max = Math.max(1, ...workload.data.people.map((p) => p.open));
                      return workload.data.people.map((p) => (
                        <tr key={p.user?.id ?? "none"}>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-2">
                              <Avatar user={p.user} size={22} />
                              <span className={cx("truncate", !p.user && "text-muted")}>{p.user ? displayName(p.user) : "Unassigned"}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <span className="flex items-center gap-2" aria-label={`${p.open} open`}>
                              <span className="h-3 rounded-r-[4px]" style={{ width: `${(p.open / max) * 80}%`, minWidth: p.open ? 2 : 0, background: "var(--series-1)" }} aria-hidden />
                              <span className="tabular-nums text-xs">{p.open}</span>
                            </span>
                          </td>
                          <td className={cx("px-2 py-2 text-right tabular-nums", p.overdue > 0 && "text-danger")}>{p.overdue}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.dueSoon}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {formatNumber(p.openHours)} h{p.unestimated > 0 && <span className="ml-1 text-xs text-muted">+{p.unestimated} unestimated</span>}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{p.completed}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-6 text-sm text-muted">No open or completed work for these filters.</p>
            )}
          </section>

          {!scope.projectId && (
            <section className="print-avoid-break rounded-xl border border-line bg-surface shadow-card" aria-label="Projects">
              <h2 className="border-b border-line px-4 py-3 font-medium">Projects</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Project</th>
                      <th className="px-2 py-2 font-medium">Health</th>
                      <th className="w-[25%] px-2 py-2 font-medium">Progress</th>
                      <th className="px-2 py-2 text-right font-medium">Open</th>
                      <th className="px-2 py-2 text-right font-medium">Overdue</th>
                      <th className="px-4 py-2 text-right font-medium">Completed in range</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {perProject.data?.projects.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-2">
                            <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
                            <span className="truncate">{p.name}</span>
                            <span className="text-xs text-muted">{p.key}</span>
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <HealthBadge health={p.health} />
                          <span className="sr-only">{HEALTH_LABELS[p.health]}</span>
                        </td>
                        <td className="px-2 py-2">
                          <span className="flex items-center gap-2">
                            <Progress value={p.stats.progress} />
                            <span className="w-10 text-right text-xs tabular-nums">{Math.round(p.stats.progress * 100)}%</span>
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{p.stats.open}</td>
                        <td className={cx("px-2 py-2 text-right tabular-nums", p.stats.overdue > 0 && "text-danger")}>{p.stats.overdue}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.completedInRange}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="text-[11px] text-muted">
            Counts include subtasks and exclude deleted tasks. History is rebuilt from creation and completion times, so a task reopened later no longer counts as completed.
          </p>
        </div>
      )}
    </div>
  );
};

export default Analytics;
