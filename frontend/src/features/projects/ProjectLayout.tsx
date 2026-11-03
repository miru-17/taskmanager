import { NavLink, Navigate, Outlet, useLocation, useOutletContext, useParams } from "react-router-dom";
import { CalendarDays, GanttChart, KanbanSquare, LayoutDashboard, List, Lock, Plus, Settings } from "lucide-react";
import { useProject } from "../../data/queries";
import { errorStatus, getErrorMessage } from "../../data/errors";
import type { Project } from "../../types/Task";
import { PROJECT_STATUS_LABELS } from "../../types/Task";
import { Button, EmptyState, ErrorState, HealthBadge, Spinner } from "../../ui";
import { cx } from "../../ui/cx";
import { FilterBar } from "../tasks/TaskBits";
import { useFilters } from "../tasks/useFilters";
import { useComposer } from "../tasks/composer";
import type { TaskFilters } from "../../data/queries";

export interface ProjectOutlet {
  project: Project;
  filters: TaskFilters;
  readOnly: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useProjectOutlet = () => useOutletContext<ProjectOutlet>();

const TABS = [
  { to: "overview", label: "Overview", icon: LayoutDashboard },
  { to: "board", label: "Board", icon: KanbanSquare },
  { to: "list", label: "List", icon: List },
  { to: "calendar", label: "Calendar", icon: CalendarDays },
  { to: "timeline", label: "Timeline", icon: GanttChart },
] as const;

const ProjectLayout = () => {
  const { projectId } = useParams();
  const location = useLocation();
  const { data: project, isPending, isError, error, refetch } = useProject(projectId);
  const { filters } = useFilters();
  const { open } = useComposer();

  if (isPending) return <Spinner label="Loading project…" />;
  if (isError) {
    return (
      <div className="mx-auto max-w-xl p-8">
        {errorStatus(error) === 404 ? (
          <EmptyState title="Project not found">It doesn't exist, or you don't have access to it.</EmptyState>
        ) : (
          <ErrorState message={getErrorMessage(error, "Couldn't load the project")} onRetry={() => refetch()} />
        )}
      </div>
    );
  }

  const caps = project.capabilities;
  const archived = project.status === "ARCHIVED";
  const readOnly = archived || !caps?.createTasks;
  const view = location.pathname.split("/")[3] ?? "";
  const showFilters = ["board", "list", "calendar", "timeline"].includes(view);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-surface px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: project.color }} aria-hidden>
            {project.key.slice(0, 2)}
          </span>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              {project.name}
              {project.visibility === "PRIVATE" && <Lock className="size-3.5 text-muted" aria-label="Private project" />}
            </h1>
            <p className="text-xs text-muted">
              {project.key} · {PROJECT_STATUS_LABELS[project.status]}
              {caps?.projectRole && ` · You're a project ${caps.projectRole.toLowerCase()}`}
              {!caps?.createTasks && !archived && " · Read-only for you"}
            </p>
          </div>
          <HealthBadge health={project.health} />
          {!readOnly && (
            <Button variant="primary" className="ml-auto" icon={<Plus className="size-4" />} onClick={() => open({ projectId: project.id })}>
              New task
            </Button>
          )}
        </div>
        <nav aria-label="Project views" className="scroll-thin mt-3 -mb-px flex gap-1 overflow-x-auto">
          {[...TABS, ...(caps?.manage ? [{ to: "settings", label: "Settings", icon: Settings }] : [])].map((t) => (
            <NavLink
              key={t.to}
              to={{ pathname: t.to, search: t.to === "overview" || t.to === "settings" ? "" : location.search }}
              className={({ isActive }) =>
                cx("flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap", isActive ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg")
              }
            >
              <t.icon className="size-4" aria-hidden />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {archived && <p className="bg-warning/10 px-6 py-2 text-xs text-warning">This project is archived. Tasks are read-only until it's restored in Settings.</p>}
      {showFilters && (
        <div className="border-b border-line px-4 py-2.5 sm:px-6">
          <FilterBar projectId={project.id} viewType={view === "timeline" ? "gantt" : (view as "board" | "list" | "calendar")} hideStatus={view === "board"} />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <Outlet context={{ project, filters: { ...filters, projectId: project.id }, readOnly } satisfies ProjectOutlet} />
      </div>
    </div>
  );
};

export const ProjectIndex = () => <Navigate to="board" replace />;

export default ProjectLayout;
