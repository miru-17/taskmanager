import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ChangePassword from "./pages/ChangePassword";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import AcceptInvite from "./pages/AcceptInvite";
import OrganizationSettings from "./pages/OrganizationSettings";
import SecuritySettings from "./pages/SecuritySettings";

import ProtectedRoute, { FullPageSpinner } from "./routes/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import type { ReactNode } from "react";

/** Login/register pages: bounce signed-in users to the app (after the session check finishes). */
const GuestOnly = ({ children }: { children: ReactNode }) => {
  const { status } = useAuth();
  if (status === "loading") return <FullPageSpinner />;
  return status === "authenticated" ? <Navigate to="/" replace /> : <>{children}</>;
};

const protectedPage = (page: ReactNode) => <ProtectedRoute>{page}</ProtectedRoute>;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={protectedPage(<Home />)} />
      <Route path="/change-password" element={protectedPage(<ChangePassword />)} />
      <Route path="/settings/organization" element={protectedPage(<OrganizationSettings />)} />
      <Route path="/settings/security" element={protectedPage(<SecuritySettings />)} />

      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/verify-email/:token" element={<VerifyEmail />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
