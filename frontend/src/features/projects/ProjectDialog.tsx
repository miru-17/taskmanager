import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../../services/api";
import { useProjectAction, useTeams } from "../../data/queries";
import { useAuth } from "../../context/AuthContext";
import { toDateInput } from "../../data/dates";
import { PROJECT_STATUS_LABELS, type Project, type ProjectStatus, type ProjectVisibility } from "../../types/Task";
import { Button, Dialog, Field, field, textarea } from "../../ui";
import { cx } from "../../ui/cx";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#64748b"];

/** Create (no project) or edit (with project) — same fields, same server validation. */
const ProjectDialog = ({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project }) => {
  const navigate = useNavigate();
  const { organization } = useAuth();
  const { data: teams } = useTeams(open && organization?.role !== "CLIENT");
  const [form, setForm] = useState({
    name: "",
    key: "",
    description: "",
    visibility: "ORGANIZATION" as ProjectVisibility,
    color: COLORS[0],
    startDate: "",
    dueDate: "",
    teamId: "",
    status: "ACTIVE" as ProjectStatus,
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: project?.name ?? "",
      key: project?.key ?? "",
      description: project?.description ?? "",
      visibility: project?.visibility ?? "ORGANIZATION",
      color: project?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
      startDate: toDateInput(project?.startDate),
      dueDate: toDateInput(project?.dueDate),
      teamId: project?.team?.id ?? "",
      status: project?.status ?? "ACTIVE",
    });
  }, [open, project]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useProjectAction(async () => {
    const body = {
      name: form.name.trim(),
      ...(form.key.trim() ? { key: form.key.trim().toUpperCase() } : {}),
      description: form.description.trim() || null,
      visibility: form.visibility,
      color: form.color,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      teamId: form.teamId || null,
      ...(project ? { status: form.status } : {}),
    };
    return project ? (await api.patch<Project>(`/projects/${project.id}`, body)).data : (await api.post<Project>("/projects", body)).data;
  }, "Could not save the project");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, {
      onSuccess: (p) => {
        toast.success(project ? "Project updated" : `Created ${(p as Project).key}`);
        onClose();
        if (!project) navigate(`/projects/${(p as Project).id}/board`);
      },
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? "Project settings" : "New project"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="project-form" loading={save.isPending} disabled={!form.name.trim()}>
            {project ? "Save" : "Create project"}
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Name">{(id) => <input id={id} data-autofocus className={field} maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} />}</Field>
          <Field label="Key" hint={project ? undefined : "Auto if empty"}>
            {(id) => <input id={id} className={cx(field, "uppercase")} maxLength={6} placeholder="WEB" value={form.key} onChange={(e) => set("key", e.target.value)} />}
          </Field>
        </div>
        <Field label="Description">{(id) => <textarea id={id} rows={2} className={textarea} maxLength={5000} value={form.description} onChange={(e) => set("description", e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">{(id) => <input id={id} type="date" className={field} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />}</Field>
          <Field label="Target date">{(id) => <input id={id} type="date" className={field} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />}</Field>
          <Field label="Visibility" hint={form.visibility === "PRIVATE" ? "Only members (and the team) can see it" : "Everyone in the organization except clients"}>
            {(id) => (
              <select id={id} className={field} value={form.visibility} onChange={(e) => set("visibility", e.target.value as ProjectVisibility)}>
                <option value="ORGANIZATION">Organization</option>
                <option value="PRIVATE">Private</option>
              </select>
            )}
          </Field>
          <Field label="Team">
            {(id) => (
              <select id={id} className={field} value={form.teamId} onChange={(e) => set("teamId", e.target.value)}>
                <option value="">No team</option>
                {teams?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {project && (
            <Field label="Status" hint={form.status === "ARCHIVED" ? "Archived projects are read-only" : undefined}>
              {(id) => (
                <select id={id} className={field} value={form.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
                  {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-fg-soft">Color</legend>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={form.color === c}
                onClick={() => set("color", c)}
                className={cx("size-6 rounded-md ring-offset-2 ring-offset-surface", form.color === c && "ring-2 ring-fg")}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
};

export default ProjectDialog;
