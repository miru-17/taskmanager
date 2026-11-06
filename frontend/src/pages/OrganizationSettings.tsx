import { useCallback, useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import ConfirmModal from "../components/ConfirmModal";
import PageShell, { Card, dangerButton, inputClass, primaryButton, secondaryButton } from "../components/PageShell";
import { AiSettingsCard } from "../features/ai/AiSettingsCard";
import { BrandingCard } from "../features/commercial/BrandingCard";
import { ROLE_LABELS, ROLE_ORDER, assignableRoles, type AuthPayload, type OrgRole } from "../types/auth";

interface Member {
  userId: number;
  email: string;
  name: string | null;
  role: OrgRole;
  joinedAt: string;
}
interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  invitedBy: { email: string; name: string | null } | null;
}
interface AuditItem {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  ipAddress: string | null;
  actor: { email: string; name: string | null } | null;
}

const errMsg = (e: any, fallback: string) => e?.response?.data?.message ?? fallback;
const fmt = (d: string) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

type Pending = { kind: "remove"; member: Member } | { kind: "leave" } | null;

const OrganizationSettings = () => {
  const { organization, user, can, applySession, reload } = useAuth();
  const role = organization?.role ?? "VIEWER";

  const [orgName, setOrgName] = useState(organization?.name ?? "");
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [audit, setAudit] = useState<{ items: AuditItem[]; nextCursor: string | null }>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const defaultInviteRole = (r: OrgRole): OrgRole => {
    const options = assignableRoles(r);
    return options.includes("MEMBER") ? "MEMBER" : (options[options.length - 1] ?? "VIEWER");
  };
  const [inviteRole, setInviteRole] = useState<OrgRole>(defaultInviteRole(role));
  // The caller's role can arrive or change after mount (session restore, org switch)
  useEffect(() => {
    setInviteRole(defaultInviteRole(role));
  }, [role]);
  const [newOrgName, setNewOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    setError("");
    try {
      const [m, i, a] = await Promise.all([
        can("members:read") ? api.get<Member[]>("/orgs/current/members") : Promise.resolve({ data: [] as Member[] }),
        can("invitations:manage") ? api.get<Invitation[]>("/orgs/current/invitations") : Promise.resolve({ data: [] as Invitation[] }),
        can("audit:read")
          ? api.get<{ items: AuditItem[]; nextCursor: string | null }>("/orgs/current/audit-logs?limit=20")
          : Promise.resolve({ data: { items: [], nextCursor: null } }),
      ]);
      setMembers(m.data);
      setInvitations(i.data);
      setAudit(a.data);
    } catch (e) {
      setError(errMsg(e, "Couldn't load organization details"));
    } finally {
      setLoading(false);
    }
  }, [organization, can]);

  useEffect(() => {
    setOrgName(organization?.name ?? "");
    void load();
  }, [organization?.id, organization?.name, load]);

  const run = async (fn: () => Promise<unknown>, success: string, fallback: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(errMsg(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.patch("/orgs/current", { name: orgName });
      await reload();
    }, "Organization renamed", "Couldn't rename");
  };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.post("/orgs/current/invitations", { email: inviteEmail, role: inviteRole }), `Invitation sent to ${inviteEmail}`, "Couldn't send the invitation");
    if (ok) {
      setInviteEmail("");
      void load();
    }
  };

  const changeRole = (m: Member, next: OrgRole) =>
    run(async () => {
      await api.patch(`/orgs/current/members/${m.userId}`, { role: next });
      if (m.userId === user?.id) await reload();
      await load();
    }, `${m.email} is now ${ROLE_LABELS[next]}`, "Couldn't change the role");

  const revoke = (inv: Invitation) =>
    run(async () => {
      await api.delete(`/orgs/current/invitations/${inv.id}`);
      await load();
    }, "Invitation revoked", "Couldn't revoke the invitation");

  const confirmPending = async () => {
    const p = pending;
    setPending(null);
    if (p?.kind === "remove") {
      await run(async () => {
        await api.delete(`/orgs/current/members/${p.member.userId}`);
        await load();
      }, `${p.member.email} removed`, "Couldn't remove the member");
    }
    if (p?.kind === "leave") {
      await run(async () => {
        const res = await api.post<AuthPayload>("/orgs/current/leave");
        applySession(res.data);
      }, "You left the organization", "Couldn't leave the organization");
    }
  };

  const createOrg = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      const res = await api.post<AuthPayload>("/orgs", { name: newOrgName });
      applySession(res.data);
    }, `Created ${newOrgName}`, "Couldn't create the organization");
    if (ok) setNewOrgName("");
  };

  const loadMoreAudit = async () => {
    if (!audit.nextCursor) return;
    try {
      const res = await api.get<{ items: AuditItem[]; nextCursor: string | null }>(
        `/orgs/current/audit-logs?limit=20&cursor=${audit.nextCursor}`
      );
      setAudit((prev) => ({ items: [...prev.items, ...res.data.items], nextCursor: res.data.nextCursor }));
    } catch (e) {
      toast.error(errMsg(e, "Couldn't load more"));
    }
  };

  const createOrgCard = (
    <Card title="Create another organization">
      <form onSubmit={createOrg} className="flex flex-col sm:flex-row gap-3">
        <input
          className={inputClass}
          placeholder="Organization name"
          aria-label="New organization name"
          value={newOrgName}
          onChange={(e) => setNewOrgName(e.target.value)}
          minLength={2}
          maxLength={100}
          required
        />
        <button className={primaryButton} disabled={busy}>
          Create
        </button>
      </form>
      <p className="text-muted text-sm mt-2">You'll be its admin, and it becomes your active organization.</p>
    </Card>
  );

  if (!organization) {
    return (
      <PageShell title="Organization" subtitle="You're not a member of any organization yet.">
        {createOrgCard}
      </PageShell>
    );
  }

  return (
    <PageShell title={organization.name} subtitle={`Your role: ${ROLE_LABELS[role]}`}>
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-danger flex justify-between items-center">
          <span>{error}</span>
          <button className={secondaryButton} onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {can("org:update") && (
        <Card title="General">
          <form onSubmit={rename} className="flex flex-col sm:flex-row gap-3">
            <input
              className={inputClass}
              aria-label="Organization name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              minLength={2}
              maxLength={100}
              required
            />
            <button className={primaryButton} disabled={busy || orgName.trim() === organization.name}>
              Save
            </button>
          </form>
        </Card>
      )}

      {role !== "CLIENT" && <AiSettingsCard canEdit={can("org:update")} />}
      {role !== "CLIENT" && <BrandingCard canEdit={can("org:update")} />}

      {can("members:invite") && (
        <Card title="Invite people">
          {!user?.emailVerified ? (
            <p className="text-warning">Verify your email address (see Security settings) before inviting people.</p>
          ) : (
            <form onSubmit={invite} className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                className={inputClass}
                placeholder="colleague@company.com"
                aria-label="Email to invite"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <select
                className={`${inputClass} sm:w-56`}
                aria-label="Role for the invitee"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgRole)}
              >
                {assignableRoles(role).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button className={primaryButton} disabled={busy}>
                Send invite
              </button>
            </form>
          )}
        </Card>
      )}

      {can("members:read") && (
        <Card title={`Members (${members.length})`}>
          {loading ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-elev animate-pulse" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.userId} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {m.name || m.email}
                      {m.userId === user?.id && <span className="text-muted"> (you)</span>}
                    </p>
                    {m.name && <p className="text-sm text-muted truncate">{m.email}</p>}
                  </div>
                  <div className="flex gap-2 items-center">
                    {can("members:manage") ? (
                      <select
                        className={`${inputClass} py-2 sm:w-52`}
                        aria-label={`Role for ${m.email}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => void changeRole(m, e.target.value as OrgRole)}
                      >
                        {ROLE_ORDER.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-accent">{ROLE_LABELS[m.role]}</span>
                    )}
                    {can("members:manage") && m.userId !== user?.id && (
                      <button className={dangerButton} onClick={() => setPending({ kind: "remove", member: m })}>
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {can("invitations:manage") && (
        <Card title="Pending invitations">
          {invitations.length === 0 ? (
            <p className="text-muted">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-line">
              {invitations.map((inv) => (
                <li key={inv.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{inv.email}</p>
                    <p className="text-sm text-muted">
                      {ROLE_LABELS[inv.role]} · expires {fmt(inv.expiresAt)}
                    </p>
                  </div>
                  <button className={secondaryButton} disabled={busy} onClick={() => void revoke(inv)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {can("audit:read") && (
        <Card title="Audit log">
          {audit.items.length === 0 ? (
            <p className="text-muted">No events yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-line text-sm">
                {audit.items.map((a) => (
                  <li key={a.id} className="py-2 flex flex-col sm:flex-row sm:justify-between gap-1">
                    <span>
                      <code className="text-accent">{a.action}</code>{" "}
                      <span className="text-muted">by {a.actor?.name || a.actor?.email || "system"}</span>
                    </span>
                    <span className="text-muted">{fmt(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
              {audit.nextCursor && (
                <button className={`${secondaryButton} mt-4`} onClick={() => void loadMoreAudit()}>
                  Load more
                </button>
              )}
            </>
          )}
        </Card>
      )}

      {createOrgCard}

      <Card title="Leave organization">
        <p className="text-muted mb-4">You'll lose access to everything in {organization.name}.</p>
        <button className={dangerButton} onClick={() => setPending({ kind: "leave" })} disabled={busy}>
          Leave {organization.name}
        </button>
      </Card>

      <ConfirmModal
        isOpen={pending !== null}
        title={pending?.kind === "leave" ? "Leave organization" : "Remove member"}
        message={
          pending?.kind === "leave"
            ? `Leave ${organization.name}? You'll need a new invitation to come back.`
            : `Remove ${pending?.kind === "remove" ? pending.member.email : ""} from ${organization.name}? They lose access immediately.`
        }
        confirmLabel={pending?.kind === "leave" ? "Leave" : "Remove"}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmPending()}
      />
    </PageShell>
  );
};

export default OrganizationSettings;
