import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../services/api";

const ChangePassword = () => {
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
  toast.error("Password must be at least 8 characters");
  return;
}

    try {
      setLoading(true);

      const res = await api.put("/user/change-password", {
        currentPassword,
        newPassword,
      });

      toast.success(res.data?.message ?? "Password changed successfully");

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      navigate("/");
    } catch (error: any) {
      toast.error(
        error.response?.data?.message || "Failed to change password"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-app flex justify-center items-center">
      <div className="bg-surface p-8 rounded-3xl w-full max-w-md shadow-xl">

        <h1 className="text-3xl font-bold text-fg mb-8 text-center">
          Change Password
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">

          <input
            aria-label="Current Password"
            type="password"
            placeholder="Current Password"
            className="w-full p-3 rounded-xl bg-elev text-fg border border-line"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />

          <input
            aria-label="New Password"
            type="password"
            placeholder="New Password"
            className="w-full p-3 rounded-xl bg-elev text-fg border border-line"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />

          <input
            aria-label="Confirm New Password"
            type="password"
            placeholder="Confirm New Password"
            className="w-full p-3 rounded-xl bg-elev text-fg border border-line"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          <button
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover py-3 rounded-xl text-accent-fg font-semibold"
          >
            {loading ? "Updating..." : "Update Password"}
          </button>

        </form>
        <button
  type="button"
  onClick={() => navigate("/")}
  className="w-full mt-3 border border-line py-3 rounded-xl text-fg-soft hover:bg-elev"
>
  Back
</button>
      </div>
    </div>
  );
};

export default ChangePassword;