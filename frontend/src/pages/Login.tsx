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

        <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-slate-700">

          <h1 className="text-3xl font-bold text-white text-center mb-8">
            Login
          </h1>

          <form onSubmit={handleLogin} className="space-y-5">

            <input
              type="email"
              placeholder="Email"
              className="w-full p-3 rounded-xl bg-slate-800 text-white border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password"
              className="w-full p-3 rounded-xl bg-slate-800 text-white border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-sm text-cyan-400 hover:underline"
              >
                Forgot Password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-white py-3 rounded-xl font-semibold transition duration-300"
            >
              {loading ? "Logging in..." : "Login"}
            </button>

          </form>

          <p className="text-slate-300 mt-6 text-center">
            Don't have an account?{" "}
            <Link
              to="/register"
              state={{ from }}
              className="text-cyan-400 hover:underline"
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