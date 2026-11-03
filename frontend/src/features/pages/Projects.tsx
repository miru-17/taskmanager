import { useState } from "react";
import { Link } from "react-router-dom";
import { FolderKanban, Lock, Plus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useProjects } from "../../data/queries";
import { formatDay } from "../../data/dates";
import { getErrorMessage } from "../../data/errors";
import { PROJECT_STATUS_LABELS } from "../../types/Task";
import { Avatar, Button, EmptyState, ErrorState, HealthBadge, Progress, Spinner } from "../../ui";
import ProjectDialog from "../projects/ProjectDialog";

const Projects = () => {
  const { can, organization } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data, isPending, isError, error, refetch } = useProjects(showArchived);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted">{organization?.name}</p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
        {can("projects:create") && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </div>

      <div className="mt-6">
        {isPending ? (
          <Spinner />
        ) : isError ? (
          <ErrorState message={getErrorMessage(error, "Couldn't load projects")} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState icon={<FolderKanban className="size-8" />} title="No projects">
            {organization?.role === "CLIENT" ? "You'll see projects here once someone adds you to one." : "Create a project to start organizing work."}
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}/overview`}
                className="group flex flex-col rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: p.color }} aria-hidden>
                    {p.key.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-medium text-fg">
                      {p.name}
                      {p.visibility === "PRIVATE" && <Lock className="size-3 text-muted" aria-label="Private" />}
                    </p>
                    <p className="text-xs text-muted">
                      {p.key} · {PROJECT_STATUS_LABELS[p.status]}
                      {p.team && ` · ${p.team.name}`}
                    </p>
                  </div>
                  <HealthBadge health={p.health} />
                </div>
                {p.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{p.description}</p>}
                <div className="mt-auto pt-4">
                  <div className="mb-1.5 flex justify-between text-xs text-muted">
                    <span>
                      {p.stats.done}/{p.stats.total} done{p.stats.overdue > 0 && <span className="text-danger"> · {p.stats.overdue} overdue</span>}
                    </span>
                    <span>{Math.round(p.stats.progress * 100)}%</span>
                  </div>
                  <Progress value={p.stats.progress} />
                  <div className="mt-3 flex items-center justify-between text-xs text-muted">
                    <span className="flex items-center gap-1.5">
                      <Avatar user={p.owner} size={18} /> {p.owner ? p.owner.name || p.owner.email : "No owner"}
                    </span>
                    {p.dueDate && <span>Target {formatDay(p.dueDate)}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <ProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
};

export default Projects;
