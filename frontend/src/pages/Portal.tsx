import { Link } from "react-router-dom";
import { BadgeCheck, CalendarDays, FolderKanban } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApprovals, useProjects } from "../data/queries";
import { getErrorMessage } from "../data/errors";
import { formatDay } from "../data/dates";
import { EmptyState, ErrorState, HealthBadge, Spinner } from "../ui";
import { useBranding, useLogoUrl } from "../features/commercial/branding";
import { useTaskParam } from "../features/tasks/composer";

/**
 * The client's home: only the projects they were added to, how each is going, and anything
 * waiting for their approval. Access is enforced by the server; this page just gathers it.
 */
const Portal = () => {
  const { user } = useAuth();
  const { data: brand } = useBranding();
  const logo = useLogoUrl();
  const projects = useProjects();
  const approvals = useApprovals("to-me");
  const { openTask } = useTaskParam();
  const waiting = approvals.data?.filter((a) => a.status === "PENDING") ?? [];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex items-center gap-4">
          {logo ? <img src={logo} alt="" className="size-12 rounded-lg object-contain" /> : <span className="flex size-12 items-center justify-center rounded-lg bg-accent text-lg font-bold text-accent-fg" aria-hidden>{brand?.name.slice(0, 1).toUpperCase()}</span>}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{brand?.name ?? "Your projects"}</h1>
            <p className="text-sm text-muted">Welcome{user?.name ? `, ${user.name}` : ""}. Here's where your projects stand.</p>
          </div>
        </header>

        <section aria-labelledby="waiting">
          <h2 id="waiting" className="mb-2 flex items-center gap-2 font-medium">
            <BadgeCheck className="size-4 text-accent" aria-hidden /> Waiting for your approval
          </h2>
          {approvals.isPending ? (
            <Spinner label="Loading approvals…" />
          ) : approvals.isError ? (
            <ErrorState message={getErrorMessage(approvals.error, "Couldn't load approvals")} onRetry={() => approvals.refetch()} />
          ) : waiting.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {waiting.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => openTask(a.task.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-elev">
                    <span className="text-xs text-muted">{a.task.key}</span>
                    <span className="min-w-0 flex-1 truncate">{a.task.title}</span>
                    <span className="text-xs text-muted">{a.task.project.name}</span>
                    <span className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg">Review</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">Nothing needs your approval right now.</p>
          )}
        </section>

        <section aria-labelledby="your-projects">
          <h2 id="your-projects" className="mb-2 flex items-center gap-2 font-medium">
            <FolderKanban className="size-4 text-accent" aria-hidden /> Your projects
          </h2>
          {projects.isPending ? (
            <Spinner label="Loading projects…" />
          ) : projects.isError ? (
            <ErrorState message={getErrorMessage(projects.error, "Couldn't load projects")} onRetry={() => projects.refetch()} />
          ) : !projects.data.length ? (
            <EmptyState icon={<FolderKanban className="size-8" />} title="No projects shared with you yet">
              The team will add you to a project when there's something to follow.
            </EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {projects.data.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}/overview`} className="block rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-accent/60">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        {p.dueDate && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                            <CalendarDays className="size-3" aria-hidden /> Due {formatDay(p.dueDate)}
                          </span>
                        )}
                      </span>
                      <HealthBadge health={p.health} />
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elev" role="progressbar" aria-label={`${p.name} progress`} aria-valuenow={p.stats.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${p.stats.progress}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {p.stats.done} of {p.stats.total} tasks done{p.stats.overdue ? ` · ${p.stats.overdue} overdue` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default Portal;
