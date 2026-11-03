import { useState, type FormEvent } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import background from "../assets/background.jpg";

import api from "../services/api";

const field =
  "w-full p-3 rounded-xl bg-elev text-fg border border-line focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60";

const Register = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Arriving from an invitation link: email is fixed and no new organization is created
  const inviteToken = params.get("invite") ?? undefined;
  const invitedEmail = params.get("email") ?? "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail);
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    try {
      setLoading(true);

      const res = await api.post("/auth/register", {
        email,
        password,
        name: name || undefined,
        organizationName: inviteToken ? undefined : organizationName || undefined,
        inviteToken,
      });

      toast.success(res.data?.message ?? "Account created", { duration: 6000 });

      navigate("/login", { state: { from: inviteToken ? "/" : undefined } });
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${background})` }}>
      <div className="min-h-screen flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-md bg-surface backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-line">
          <h1 className="text-3xl font-bold text-fg text-center mb-2">
            {inviteToken ? "Join your team" : "Create your workspace"}
          </h1>
          <p className="text-fg-soft text-center mb-8">
            {inviteToken ? "Create an account to accept the invitation." : "You'll be the admin of a new organization."}
          </p>

          <form onSubmit={handleRegister} className="space-y-5">
            <label className="block">
              <span className="sr-only">Your name</span>
              <input
                aria-label="Name"
                type="text"
                placeholder="Your name (optional)"
                className={field}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="block">
              <span className="sr-only">Email</span>
              <input
                aria-label="Email"
                type="email"
                placeholder="Email"
                className={field}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={Boolean(inviteToken && invitedEmail)}
                required
              />
            </label>

            {!inviteToken && (
              <label className="block">
                <span className="sr-only">Organization name</span>
                <input
                  aria-label="Organization name"
                  type="text"
                  placeholder="Organization name (e.g. Acme Inc.)"
                  className={field}
                  value={organizationName}
                  maxLength={100}
                  onChange={(e) => setOrganizationName(e.target.value)}
                />
              </label>
            )}

            <label className="block">
              <span className="sr-only">Password</span>
              <input
                aria-label="Password"
                type="password"
                placeholder="Password (at least 8 characters)"
                className={field}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            <label className="block">
              <span className="sr-only">Confirm password</span>
              <input
                aria-label="Confirm password"
                type="password"
                placeholder="Confirm password"
                className={field}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover text-accent-fg py-3 rounded-xl font-semibold transition duration-300 disabled:opacity-60"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-fg-soft mt-6 text-center">
            Already have an account?{" "}
            <Link to="/login" className="text-accent hover:underline">
              Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
