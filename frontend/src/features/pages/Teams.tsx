import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, Trash2, Users } from "lucide-react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useOrgAction, useOrgMembers, useTeam, useTeams } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { displayName } from "../../types/Task";
import { Avatar, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, Spinner, field, textarea, fieldBase } from "../../ui";
import { cx } from "../../ui/cx";

const TeamPanel = ({ teamId, onDeleted }: { teamId: string; onDeleted: () => void }) => {
  const { can, user } = useAuth();
  const { data: team, isPending } = useTeam(teamId);
  const { data: orgMembers } = useOrgMembers();
  const [userId, setUserId] = useState("");
  const [confirm, setConfirm] = useState(false);
  const base = `/teams/${teamId}`;
  const add = useOrgAction((v: { userId: number; role: "LEAD" | "MEMBER" }) => api.post(`${base}/members`, v), "Could not update the team");
  const remove = useOrgAction((uid: number) => api.delete(`${base}/members/${uid}`), "Could not remove the member");
  const destroy = useOrgAction(() => api.delete(base), "Could not delete the team");

  if (isPending || !team) return <Spinner />;
  const manager = can("teams:manage");
  const isLead = team.members.some((m) => m.user.id === user?.id && m.role === "LEAD");
  const canEdit = manager || isLead;
  const candidates = (orgMembers ?? []).filter((m) => m.role !== "CLIENT" && !team.members.some((t) => t.user.id === m.userId));

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{team.name}</h2>
          {team.description && <p className="mt-0.5 text-sm text-muted">{team.description}</p>}
        </div>
        {manager && (
          <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm(true)}>
            Delete team
          </Button>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Members · {team.members.length}</h3>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {team.members.map((m) => (
            <li key={m.user.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar user={m.user} size={24} />
              <span className="min-w-0 flex-1 truncate text-sm">{displayName(m.user)}</span>
              {manager ? (
                <select
                  aria-label={`Team role for ${m.user.email}`}
                  className={cx(fieldBase, "h-8 w-28 text-xs")}
                  value={m.role}
                  onChange={(e) => add.mutate({ userId: m.user.id, role: e.target.value as "LEAD" | "MEMBER" })}
                >
                  <option value="LEAD">Lead</option>
                  <option value="MEMBER">Member</option>
                </select>
              ) : (
                <span className="text-xs text-muted">{m.role === "LEAD" ? "Lead" : "Member"}</span>
              )}
              {canEdit && (
                <IconButton label={`Remove ${m.user.email}`} onClick={() => remove.mutate(m.user.id)}>
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
          {!team.members.length && <li className="px-3 py-3 text-sm text-muted">No members yet.</li>}
        </ul>
        {canEdit && orgMembers && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (userId) add.mutate({ userId: Number(userId), role: "MEMBER" }, { onSuccess: () => setUserId("") });
            }}
          >
            <select aria-label="Person to add to team" className={cx(fieldBase, "flex-1")} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Add a person…</option>
              {candidates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {displayName(m)} · {m.email}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={!userId} loading={add.isPending}>
              Add
            </Button>
          </form>
        )}
        {isLead && !manager && <p className="mt-2 text-xs text-muted">As team lead you can add and remove members. Managers appoint leads.</p>}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Projects · {team.projects.length}</h3>
        {team.projects.length ? (
          <ul className="space-y-1">
            {team.projects.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}/board`} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-elev">
                  <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
                  {p.name}
                  <span className="text-xs text-muted">{p.key}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No projects use this team. Assign it in a project's settings.</p>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        title={`Delete ${team.name}?`}
        message="Members keep their accounts and projects stay, but private projects that relied on this team for access become visible only to their explicit members."
        confirmLabel="Delete team"
        loading={destroy.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          destroy.mutate(undefined, {
            onSuccess: () => {
              toast.success("Team deleted");
              setConfirm(false);
              onDeleted();
            },
          })
        }
      />
    </div>
  );
};

const Teams = () => {
  const { can } = useAuth();
  const { data, isPending, isError, error, refetch } = useTeams();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const create = useOrgAction(async () => (await api.post("/teams", { name: form.name.trim(), description: form.description.trim() || null })).data as { id: string }, "Could not create the team");

  const current = selected ?? data?.[0]?.id ?? null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="mt-1 text-sm text-muted">Teams give their members access to the team's private projects; leads can edit any task in them.</p>
        </div>
        {can("teams:manage") && (
          <Button className="ml-auto" variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New team
          </Button>
        )}
      </div>

      <div className="mt-6">
        {isPending ? (
          <Spinner />
        ) : isError ? (
          <ErrorState message={getErrorMessage(error, "Couldn't load teams")} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState icon={<Users className="size-8" />} title="No teams yet">
            {can("teams:manage") ? "Create a team to group people and share private projects with them." : "Managers can create teams."}
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
            <ul className="space-y-1">
              {data.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    aria-current={current === t.id}
                    className={cx("w-full rounded-lg px-3 py-2 text-left", current === t.id ? "bg-elev-2" : "hover:bg-elev")}
                  >
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="block text-xs text-muted">
                      {t.memberCount} member{t.memberCount === 1 ? "" : "s"} · {t.projectCount} project{t.projectCount === 1 ? "" : "s"}
                      {t.myRole && ` · you're ${t.myRole === "LEAD" ? "lead" : "a member"}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">{current && <TeamPanel key={current} teamId={current} onDeleted={() => setSelected(null)} />}</div>
          </div>
        )}
      </div>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New team"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!form.name.trim()}
              loading={create.isPending}
              onClick={() =>
                create.mutate(undefined, {
                  onSuccess: (team) => {
                    setCreating(false);
                    setForm({ name: "", description: "" });
                    setSelected(team.id);
                  },
                })
              }
            >
              Create team
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">{(id) => <input id={id} data-autofocus className={field} maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
          <Field label="Description">{(id) => <textarea id={id} rows={2} className={textarea} maxLength={1000} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />}</Field>
        </div>
      </Dialog>
    </div>
  );
};

export default Teams;
