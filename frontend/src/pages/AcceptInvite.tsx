import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS, type AuthPayload, type OrgRole } from "../types/auth";
import { FullPageSpinner } from "../routes/ProtectedRoute";

interface Preview {
  organizationName: string;
  email: string;
  role: OrgRole;
  invitedBy: string | null;
  expiresAt: string;
  accountExists: boolean;
}

const AcceptInvite = () => {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { status, user, applySession, logout } = useAuth();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api
      .get<Preview>(`/invitations/${token}`)
      .then((r) => setPreview(r.data))
      .catch((e) => setError(e.response?.data?.message ?? "This invitation is invalid or has expired"));
  }, [token]);

  const accept = async () => {
    try {
      setAccepting(true);
      const res = await api.post<AuthPayload>(`/invitations/${token}/accept`);
      applySession(res.data);
      toast.success(`You joined ${preview?.organizationName}`);
      navigate("/", { replace: true });
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? "Could not accept the invitation");
    } finally {
      setAccepting(false);
    }
  };

  if (status === "loading" || (!preview && !error)) return <FullPageSpinner label="Loading invitation…" />;

  const here = `/invite/${token}`;
  const wrongAccount = status === "authenticated" && preview && user?.email !== preview.email;

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-surface border border-line p-8 text-center">
        {error ? (
          <>
            <h1 className="text-2xl font-bold text-fg">Invitation unavailable</h1>
            <p className="text-fg-soft mt-3">{error}</p>
            <p className="text-muted mt-2 text-sm">Ask the person who invited you to send a new one.</p>
            <Link to="/" className="inline-block mt-8 text-accent hover:underline">
              Go to TaskForge
            </Link>
          </>
        ) : (
          preview && (
            <>
              <p className="text-muted text-sm uppercase tracking-widest">You're invited</p>
              <h1 className="text-2xl font-bold text-fg mt-2">{preview.organizationName}</h1>
              <p className="text-fg-soft mt-3">
                {preview.invitedBy ? `${preview.invitedBy} invited ` : "You've been invited "}
                <span className="text-fg font-medium">{preview.email}</span> to join as{" "}
                <span className="text-accent font-medium">{ROLE_LABELS[preview.role]}</span>.
              </p>

              {status === "authenticated" && !wrongAccount && (
                <button
                  onClick={accept}
                  disabled={accepting}
                  className="mt-8 w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-accent-fg font-semibold disabled:opacity-60"
                >
                  {accepting ? "Joining…" : `Join ${preview.organizationName}`}
                </button>
              )}

              {wrongAccount && (
                <div className="mt-8 space-y-3">
                  <p className="text-warning text-sm">
                    You're signed in as {user?.email}. This invitation is for {preview.email}.
                  </p>
                  <button
                    onClick={() => logout()}
                    className="w-full py-3 rounded-xl border border-line text-fg-soft hover:bg-elev"
                  >
                    Sign out and switch account
                  </button>
                </div>
              )}

              {status === "anonymous" && (
                <div className="mt-8 space-y-3">
                  {preview.accountExists ? (
                    <Link
                      to="/login"
                      state={{ from: here }}
                      className="block w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-accent-fg font-semibold"
                    >
                      Sign in to accept
                    </Link>
                  ) : (
                    <Link
                      to={`/register?invite=${token}&email=${encodeURIComponent(preview.email)}`}
                      className="block w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-accent-fg font-semibold"
                    >
                      Create account and join
                    </Link>
                  )}
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
};

export default AcceptInvite;
