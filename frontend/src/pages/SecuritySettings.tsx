import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { tokenStore } from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import { describeDevice } from "../utils/device";
import PageShell, { Card, dangerButton, primaryButton, secondaryButton } from "../components/PageShell";

interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

const fmt = (d: string) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const SecuritySettings = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions((await api.get<SessionRow[]>("/auth/sessions")).data);
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? "Couldn't load your sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await api.delete(`/auth/sessions/${id}`);
      toast.success("Device signed out");
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? "Couldn't sign that device out");
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async () => {
    setConfirmAll(false);
    try {
      await api.post("/auth/logout-all");
      tokenStore.set(null);
      toast.success("Signed out of all devices");
      navigate("/login", { replace: true });
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? "Couldn't sign out everywhere");
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await api.post("/auth/resend-verification");
      toast.success(`Verification email sent to ${user?.email}`);
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? "Couldn't send the email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="Security" subtitle={user?.email}>
      <Card title="Email address">
        {user?.emailVerified ? (
          <p className="text-success">✓ {user.email} is verified.</p>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-warning">{user?.email} isn't verified yet.</p>
            <button className={primaryButton} onClick={() => void resend()} disabled={busy}>
              Resend verification email
            </button>
          </div>
        )}
      </Card>

      <Card
        title="Password"
        actions={
          <Link to="/change-password" className={secondaryButton}>
            Change password
          </Link>
        }
      >
        <p className="text-muted">Changing your password signs out every other device.</p>
      </Card>

      <Card
        title="Where you're signed in"
        actions={
          <button className={dangerButton} onClick={() => setConfirmAll(true)}>
            Sign out everywhere
          </button>
        }
      >
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-elev animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {describeDevice(s.userAgent)}
                    {s.current && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-accent/15 text-accent">This device</span>}
                  </p>
                  <p className="text-sm text-muted">
                    Last active {fmt(s.lastUsedAt)}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                  </p>
                </div>
                {!s.current && (
                  <button className={secondaryButton} onClick={() => void revoke(s.id)} disabled={busy}>
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmModal
        isOpen={confirmAll}
        title="Sign out everywhere"
        message="This signs you out on every device, including this one."
        confirmLabel="Sign out everywhere"
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => void logoutAll()}
      />
    </PageShell>
  );
};

export default SecuritySettings;
