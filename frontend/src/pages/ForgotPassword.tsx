import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import background from "../assets/background.jpg";

import api from "../services/api";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);

      await api.post("/auth/forgot-password", {
        email,
      });

      toast.success("Reset link sent to your email");
    } catch (error: any) {
      toast.error(
        error.response?.data?.message ||
          "Failed to send reset link"
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

          <h1 className="text-3xl font-bold text-white text-center mb-2">
            Forgot Password
          </h1>

          <p className="text-slate-300 text-center mb-8">
            Enter your email to receive a password reset link.
          </p>

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
          >

            <input
              type="email"
              placeholder="Email"
              className="w-full p-3 rounded-xl bg-slate-800 text-white border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 transition duration-300 text-white py-3 rounded-xl font-semibold"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>

          </form>

          <p className="text-slate-300 text-center mt-6">
            Remember your password?{" "}
            <Link
              to="/login"
              className="text-cyan-400 hover:underline"
            >
              Back to Login
            </Link>
          </p>

        </div>

      </div>
    </div>
  );
};

export default ForgotPassword;