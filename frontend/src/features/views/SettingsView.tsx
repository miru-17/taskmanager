import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useMilestones, useOrgMembers, useProjectAction, useProjectMembers } from "../../data/queries";
import { formatDay, toDateInput } from "../../data/dates";
import { displayName, type ProjectRole } from "../../types/Task";
import { Avatar, Button, ConfirmDialog, IconButton, fieldBase } from "../../ui";
import { cx } from "../../ui/cx";
import ProjectDialog from "../projects/ProjectDialog";
import { useProjectOutlet } from "../projects/ProjectLayout";
import { ApprovalPolicyCard, CustomFieldsCard, TemplatesCard } from "./SettingsExtras";

const ROLES: { value: ProjectRole; label: string; hint: string }[] = [
  { value: "MANAGER", label: "Manager", hint: "Manages settings and every task" },
  { value: "MEMBER", label: "Member", hint: "Works on tasks per their org role" },
  { value: "VIEWER", label: "Viewer", hint: "Read-only" },
];

const Card = ({ title, children, description }: { title: string; description?: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
    <h2 className="font-medium">{title}</h2>
    {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

const Members = () => {
  const { project } = useProjectOutlet();
  const { data: members } = useProjectMembers(project.id);
  const { data: orgMembers } = useOrgMembers();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("MEMBER");
  const upsert = useProjectAction((v: { userId: number; role: ProjectRole }) => api.post(`/projects/${project.id}/members`, v), "Could not save the member");
  const remove = useProjectAction((uid: number) => api.delete(`/projects/${project.id}/members/${uid}`), "Could not remove the member");

  const candidates = (orgMembers ?? []).filter((m) => !members?.some((pm) => pm.userId === m.userId));
  const chosen = orgMembers?.find((m) => String(m.userId) === userId);

  return (
    <Card title="Members" description={project.visibility === "PRIVATE" ? "Only these people (and the project's team) can see this private project." : "Explicit roles here override org roles inside this project. Clients only see projects they're added to."}>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {members?.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
            <Avatar user={{ id: m.userId, name: m.name, email: m.email }} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{displayName(m)}</span>
              <span className="block truncate text-xs text-muted">{m.email}</span>
            </span>
            <select
              aria-label={`Role for ${m.email}`}
              className={cx(fieldBase, "h-8 w-32 text-xs")}
              value={m.role}
              onChange={(e) => upsert.mutate({ userId: m.userId, role: e.target.value as ProjectRole })}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <IconButton label={`Remove ${m.email}`} onClick={() => remove.mutate(m.userId)}>
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
        {!members?.length && <li className="px-3 py-3 text-sm text-muted">No explicit members.</li>}
      </ul>
      {orgMembers && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!userId) return;
            upsert.mutate({ userId: Number(userId), role }, { onSuccess: () => setUserId("") });
          }}
        >
          <select aria-label="Person to add" className={cx(fieldBase, "w-auto min-w-48 flex-1")} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Add a person…</option>
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {displayName(m)} · {m.email}
              </option>
            ))}
          </select>
          <select aria-label="Project role" className={cx(fieldBase, "w-36")} value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
            {ROLES.filter((r) => !(chosen?.role === "CLIENT" && r.value === "MANAGER")).map((r) => (
              <option key={r.value} value={r.value} title={r.hint}>
                {r.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" disabled={!userId} loading={upsert.isPending}>
            Add
          </Button>
        </form>
      )}
    </Card>
  );
};

const Milestones = () => {
  const { project } = useProjectOutlet();
  const { data: milestones } = useMilestones(project.id);
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const base = `/projects/${project.id}/milestones`;
  const create = useProjectAction(() => api.post(base, { name: name.trim(), dueDate: due || null }), "Could not add the milestone");
  const patch = useProjectAction((v: { id: string; body: Record<string, unknown> }) => api.patch(`${base}/${v.id}`, v.body), "Could not update the milestone");
  const remove = useProjectAction((id: string) => api.delete(`${base}/${id}`), "Could not delete the milestone");

  return (
    <Card title="Milestones" description="Group tasks toward a goal; progress is the share of their tasks that are done.">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {milestones?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <input type="checkbox" aria-label={`Mark ${m.name} complete`} checked={!!m.completedAt} onChange={(e) => patch.mutate({ id: m.id, body: { completed: e.target.checked } })} />
            <span className={cx("min-w-0 flex-1 text-sm", m.completedAt && "text-muted line-through")}>{m.name}</span>
            <span className="text-xs text-muted">
              {m.stats.done}/{m.stats.total} tasks
            </span>
            <input
              type="date"
              aria-label={`Due date for ${m.name}`}
              className={cx(fieldBase, "h-8 w-40 text-xs")}
              defaultValue={toDateInput(m.dueDate)}
              key={m.dueDate}
              onBlur={(e) => e.target.value !== toDateInput(m.dueDate) && patch.mutate({ id: m.id, body: { dueDate: e.target.value || null } })}
            />
            <IconButton label={`Delete ${m.name}`} onClick={() => remove.mutate(m.id)}>
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
        {!milestones?.length && <li className="px-3 py-3 text-sm text-muted">No milestones.</li>}
      </ul>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim())
            create.mutate(undefined, {
              onSuccess: () => {
                setName("");
                setDue("");
              },
            });
        }}
      >
        <input aria-label="Milestone name" className={cx(fieldBase, "min-w-48 flex-1")} placeholder="Milestone name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="Milestone due date" type="date" className={cx(fieldBase, "w-40")} value={due} onChange={(e) => setDue(e.target.value)} />
        <Button type="submit" variant="primary" disabled={!name.trim()} loading={create.isPending}>
          Add milestone
        </Button>
      </form>
    </Card>
  );
};

const SettingsView = () => {
  const { project } = useProjectOutlet();
  const { organization } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const archived = project.status === "ARCHIVED";
  const setStatus = useProjectAction((status: string) => api.patch(`/projects/${project.id}`, { status }), "Could not change the project status");
  const destroy = useProjectAction(() => api.delete(`/projects/${project.id}`), "Could not delete the project");

  if (!project.capabilities?.manage) return <Navigate to="../overview" replace />;

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <Card title="Details">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-muted">Key</dt>
            <dd>{project.key}</dd>
            <dt className="text-muted">Visibility</dt>
            <dd>{project.visibility === "PRIVATE" ? "Private" : "Organization"}</dd>
            <dt className="text-muted">Dates</dt>
            <dd>
              {project.startDate ? formatDay(project.startDate) : "—"} → {project.dueDate ? formatDay(project.dueDate) : "—"}
            </dd>
            <dt className="text-muted">Team</dt>
            <dd>{project.team?.name ?? "—"}</dd>
          </dl>
          <Button className="mt-4" onClick={() => setEditing(true)}>
            Edit details
          </Button>
        </Card>
        <Members />
        <Milestones />
        <CustomFieldsCard project={project} />
        <ApprovalPolicyCard project={project} />
        <TemplatesCard project={project} />
        <Card title={archived ? "Archived" : "Archive"} description={archived ? "Restore the project to make it editable again." : "Archived projects are hidden from the sidebar and become read-only. Nothing is deleted."}>
          <div className="flex flex-wrap gap-2">
            <Button loading={setStatus.isPending} onClick={() => setStatus.mutate(archived ? "ACTIVE" : "ARCHIVED", { onSuccess: () => toast.success(archived ? "Project restored" : "Project archived") })}>
              {archived ? "Restore project" : "Archive project"}
            </Button>
            {archived && organization?.role === "ORG_ADMIN" && (
              <Button variant="danger" onClick={() => setConfirm(true)}>
                Delete permanently
              </Button>
            )}
          </div>
          {archived && organization?.role !== "ORG_ADMIN" && <p className="mt-2 text-xs text-muted">Only organization admins can delete projects.</p>}
        </Card>
      </div>
      <ProjectDialog open={editing} onClose={() => setEditing(false)} project={project} />
      <ConfirmDialog
        open={confirm}
        title={`Delete ${project.name}?`}
        message={`This permanently deletes the project and all ${project.stats.total} of its tasks. This can't be undone.`}
        confirmLabel="Delete project"
        loading={destroy.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          destroy.mutate(undefined, {
            onSuccess: () => {
              toast.success("Project deleted");
              navigate("/projects");
            },
          })
        }
      />
    </div>
  );
};

export default SettingsView;
