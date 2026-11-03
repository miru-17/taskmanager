import { Flag } from "lucide-react";
import { useMilestones, useProjectMembers, useTasks } from "../../data/queries";
import { addDays, formatDay, todayKey, toDateInput } from "../../data/dates";
import { STATUSES, STATUS_LABELS, displayName, type TaskStatus } from "../../types/Task";
import { Avatar, HealthBadge, Progress, StatusIcon } from "../../ui";
import { cx } from "../../ui/cx";
import { TaskLine } from "../tasks/TaskBits";
import { useTaskParam } from "../tasks/composer";
import { useProjectOutlet } from "../projects/ProjectLayout";
import { healthReason } from "./logic";


const Tile = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
  <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
    <p className="text-xs text-muted">{label}</p>
    <p className={cx("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</p>
  </div>
);

const StatusCount = ({ projectId, status }: { projectId: string; status: TaskStatus }) => {
  const { data } = useTasks({ projectId, status: [status], limit: 1 });
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusIcon status={status} />
      <span className="flex-1 text-fg-soft">{STATUS_LABELS[status]}</span>
      <span className="tabular-nums">{data?.total ?? "…"}</span>
    </div>
  );
};

const OverviewView = () => {
  const { project } = useProjectOutlet();
  const { openTask } = useTaskParam();
  const { data: milestones } = useMilestones(project.id);
  const { data: members } = useProjectMembers(project.id);
  const today = todayKey();
  const overdue = useTasks({ projectId: project.id, overdue: true, sort: "dueDate", limit: 8 });
  const upcoming = useTasks({ projectId: project.id, status: ["TODO", "IN_PROGRESS", "IN_REVIEW"], dueFrom: today, dueTo: addDays(today, 7), sort: "dueDate", limit: 8 });
  const s = project.stats;

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {project.description && <p className="max-w-3xl text-sm text-fg-soft">{project.description}</p>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Total tasks" value={s.total} />
          <Tile label="Completed" value={s.done} />
          <Tile label="Open" value={s.open} />
          <Tile label="Overdue" value={s.overdue} tone={s.overdue ? "text-danger" : undefined} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-line bg-surface p-5 shadow-card lg:col-span-2">
            <div className="flex items-center gap-3">
              <h2 className="font-medium">Progress</h2>
              <HealthBadge health={project.health} />
              <span className="ml-auto text-sm tabular-nums">{Math.round(s.progress * 100)}%</span>
            </div>
            <Progress value={s.progress} className="mt-3 h-2" />
            <p className="mt-3 text-sm text-muted">{healthReason(project)}</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
              {project.startDate && <span>Start {formatDay(project.startDate)}</span>}
              {project.dueDate && <span>Target {formatDay(project.dueDate)}</span>}
              {project.owner && <span>Owner {displayName(project.owner)}</span>}
              {project.team && <span>Team {project.team.name}</span>}
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-1 font-medium">By status</h2>
            {STATUSES.map((st) => (
              <StatusCount key={st} projectId={project.id} status={st} />
            ))}
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-line bg-surface shadow-card">
            <h2 className="border-b border-line px-4 py-3 font-medium">
              Overdue <span className="text-sm font-normal text-muted">{overdue.data?.total ?? ""}</span>
            </h2>
            {overdue.data?.items.length ? (
              <div className="divide-y divide-line">
                {overdue.data.items.map((t) => (
                  <TaskLine key={t.id} task={t} onOpen={() => openTask(t.id)} />
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-sm text-muted">Nothing overdue.</p>
            )}
          </section>
          <section className="rounded-xl border border-line bg-surface shadow-card">
            <h2 className="border-b border-line px-4 py-3 font-medium">
              Due in the next 7 days <span className="text-sm font-normal text-muted">{upcoming.data?.total ?? ""}</span>
            </h2>
            {upcoming.data?.items.length ? (
              <div className="divide-y divide-line">
                {upcoming.data.items.map((t) => (
                  <TaskLine key={t.id} task={t} onOpen={() => openTask(t.id)} />
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-sm text-muted">Nothing due this week.</p>
            )}
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-line bg-surface p-5 shadow-card lg:col-span-2">
            <h2 className="mb-3 font-medium">Milestones</h2>
            {milestones?.length ? (
              <ul className="space-y-4">
                {milestones.map((m) => {
                  const late = !m.completedAt && m.dueDate && toDateInput(m.dueDate) < today;
                  return (
                    <li key={m.id}>
                      <div className="flex items-center gap-2 text-sm">
                        <Flag className={cx("size-4", m.completedAt ? "text-success" : late ? "text-danger" : "text-muted")} aria-hidden />
                        <span className="font-medium">{m.name}</span>
                        {m.completedAt && <span className="text-xs text-success">Completed</span>}
                        <span className={cx("ml-auto text-xs", late ? "text-danger" : "text-muted")}>{m.dueDate ? `${late ? "Was due" : "Due"} ${formatDay(m.dueDate)}` : "No date"}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <Progress value={m.stats.progress} tone={m.completedAt ? "bg-success" : "bg-accent"} />
                        <span className="shrink-0 text-xs text-muted tabular-nums">
                          {m.stats.done}/{m.stats.total}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No milestones yet.{project.capabilities?.manage && " Add them in Settings."}</p>
            )}
          </section>
          <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-3 font-medium">Project members</h2>
            {members?.length ? (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 text-sm">
                    <Avatar user={{ id: m.userId, name: m.name, email: m.email }} size={22} />
                    <span className="min-w-0 flex-1 truncate">{displayName(m)}</span>
                    <span className="text-xs text-muted capitalize">{m.role.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No explicit members.</p>
            )}
            {project.visibility === "ORGANIZATION" && <p className="mt-3 text-xs text-muted">Everyone in the organization (except clients) can also see this project.</p>}
          </section>
        </div>
      </div>
    </div>
  );
};

export default OverviewView;
