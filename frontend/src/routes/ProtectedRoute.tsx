import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";

export const FullPageSpinner = ({ label = "Loading…" }: { label?: string }) => (
  <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center" role="status" aria-live="polite">
    <div className="w-14 h-14 rounded-full border-4 border-cyan-500 border-t-transparent animate-spin" />
    <p className="mt-6 text-slate-300">{label}</p>
  </div>
);

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { status } = useAuth();
  const location = useLocation();

  // Wait for the silent session restore before deciding
  if (status === "loading") return <FullPageSpinner label="Restoring your session…" />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
};

export default ProtectedRoute;
