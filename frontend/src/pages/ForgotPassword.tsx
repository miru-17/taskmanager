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

      const response = await api.post("/auth/forgot-password", {
        email,
      });

      // The server deliberately gives the same answer for unknown emails
      toast.success(
        response.data?.message ||
          "If an account exists for that email, a reset link has been sent."
      );
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

        <div className="w-full max-w-md bg-surface backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-line">

          <h1 className="text-3xl font-bold text-fg text-center mb-2">
            Forgot Password
          </h1>

          <p className="text-fg-soft text-center mb-8">
            Enter your email to receive a password reset link.
          </p>

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
          >

            <input
              aria-label="Email"
              type="email"
              placeholder="Email"
              className="w-full p-3 rounded-xl bg-elev text-fg border border-line focus:outline-none focus:ring-2 focus:ring-accent"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover transition duration-300 text-accent-fg py-3 rounded-xl font-semibold"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>

          </form>

          <p className="text-fg-soft text-center mt-6">
            Remember your password?{" "}
            <Link
              to="/login"
              className="text-accent hover:underline"
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