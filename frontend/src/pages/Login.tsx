import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import toast from "react-hot-toast";

import background from "../assets/background.jpg";

import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { AuthPayload } from "../types/auth";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { applySession } = useAuth();
  // Return to where the user was headed (e.g. an invitation link)
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);

      const response = await api.post<AuthPayload>("/auth/login", {
        email,
        password,
      });

      applySession(response.data);

      toast.success("Login successful!");

      navigate(from, { replace: true });
    } catch (error: any) {
      toast.error(
        error.response?.data?.message || "Invalid email or password"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `url(${background})`,
      }}
    >
      <div className="min-h-screen flex items-center justify-center bg-black/60">

        <div className="w-full max-w-md bg-surface backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-line">

          <h1 className="text-3xl font-bold text-fg text-center mb-8">
            Login
          </h1>

          <form onSubmit={handleLogin} className="space-y-5">

            <input
              aria-label="Email"
              type="email"
              placeholder="Email"
              className="w-full p-3 rounded-xl bg-elev text-fg border border-line focus:outline-none focus:ring-2 focus:ring-accent"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              aria-label="Password"
              type="password"
              placeholder="Password"
              className="w-full p-3 rounded-xl bg-elev text-fg border border-line focus:outline-none focus:ring-2 focus:ring-accent"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-sm text-accent hover:underline"
              >
                Forgot Password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover text-accent-fg py-3 rounded-xl font-semibold transition duration-300"
            >
              {loading ? "Logging in..." : "Login"}
            </button>

          </form>

          <p className="text-fg-soft mt-6 text-center">
            Don't have an account?{" "}
            <Link
              to="/register"
              state={{ from }}
              className="text-accent hover:underline"
            >
              Register
            </Link>
          </p>

        </div>

      </div>
    </div>
  );
};

export default Login;