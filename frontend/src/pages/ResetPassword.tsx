import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import toast from "react-hot-toast";

import background from "../assets/background.jpg";

import api from "../services/api";

const ResetPassword = () => {
  const navigate = useNavigate();
  const { token } = useParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);

  // Get email from reset token
  useEffect(() => {
    const getUserEmail = async () => {
      try {
        const response = await api.get(
          `/auth/reset-user/${token}`
        );

        setEmail(response.data.email);
      } catch {
        toast.error("Invalid or expired reset link");
        navigate("/login");
      }
    };

    if (token) {
      getUserEmail();
    }
  }, [token, navigate]);

  const handleSubmit = async (e: FormEvent) => {
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

      await api.post(`/auth/reset-password/${token}`, {
        password,
      });

      toast.success("Password reset successful");

      navigate("/login");
    } catch (error: any) {
      toast.error(
        error.response?.data?.message ||
          "Password reset failed"
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
            Reset Password
          </h1>

          <p className="text-fg-soft text-center mb-8">
            Create your new password
          </p>

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
          >

            {/* Email */}
            <input
              type="email"
              value={email}
              readOnly
              className="w-full p-3 rounded-xl bg-elev text-muted border border-line cursor-not-allowed"
            />

            {/* New Password */}
            <input
              aria-label="New Password"
              type="password"
              placeholder="New Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 rounded-xl bg-elev text-fg border border-line focus:outline-none focus:ring-2 focus:ring-accent"
              required
            />

            {/* Confirm Password */}
            <input
              aria-label="Confirm Password"
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full p-3 rounded-xl bg-elev text-fg border border-line focus:outline-none focus:ring-2 focus:ring-accent"
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover transition duration-300 text-accent-fg py-3 rounded-xl font-semibold"
            >
              {loading ? "Resetting..." : "Reset Password"}
            </button>

          </form>

          <p className="text-fg-soft text-center mt-6">
            Remember your password?{" "}
            <Link
              to="/login"
              className="text-accent hover:underline"
            >
              Login
            </Link>
          </p>

        </div>

      </div>
    </div>
  );
};

export default ResetPassword;