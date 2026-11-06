import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

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
import AppShell from "./features/shell/AppShell";
import MyTasks from "./features/pages/MyTasks";
import Projects from "./features/pages/Projects";
import Teams from "./features/pages/Teams";
import Approvals from "./features/pages/Approvals";
import Analytics from "./features/pages/Analytics";
import NotificationSettings from "./features/notifications/NotificationSettings";
import ProjectLayout, { ProjectIndex } from "./features/projects/ProjectLayout";
import OverviewView from "./features/views/OverviewView";
import BoardView from "./features/views/BoardView";
import ListView from "./features/views/ListView";
import CalendarView from "./features/views/CalendarView";
import TimelineView from "./features/views/TimelineView";
import SettingsView from "./features/views/SettingsView";
import AutomationsView from "./features/views/AutomationsView";
import Billing from "./pages/Billing";
import Portal from "./pages/Portal";
import { useAuth } from "./context/AuthContext";
import type { ReactNode } from "react";

/** Login/register pages: bounce signed-in users to the app (after the session check finishes). */
const GuestOnly = ({ children }: { children: ReactNode }) => {
  const { status } = useAuth();
  if (status === "loading") return <FullPageSpinner />;
  return status === "authenticated" ? <Navigate to="/" replace /> : <>{children}</>;
};

const protectedPage = (page: ReactNode) => <ProtectedRoute>{page}</ProtectedRoute>;

/** Clients land on their portal; everyone else on My tasks. */
const HomeRedirect = () => {
  const { organization } = useAuth();
  return <Navigate to={organization?.role === "CLIENT" ? "/portal" : "/my-tasks"} replace />;
};

export function AppRoutes() {
  return (
    <Routes>
      <Route element={protectedPage(<AppShell />)}>
        <Route index element={<HomeRedirect />} />
        <Route path="portal" element={<Portal />} />
        <Route path="my-tasks" element={<MyTasks />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<ProjectIndex />} />
          <Route path="overview" element={<OverviewView />} />
          <Route path="board" element={<BoardView />} />
          <Route path="list" element={<ListView />} />
          <Route path="calendar" element={<CalendarView />} />
          <Route path="timeline" element={<TimelineView />} />
          <Route path="automations" element={<AutomationsView />} />
          <Route path="settings" element={<SettingsView />} />
        </Route>
        <Route path="teams" element={<Teams />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="change-password" element={<ChangePassword />} />
        <Route path="settings/organization" element={<OrganizationSettings />} />
        <Route path="settings/billing" element={<Billing />} />
        <Route path="settings/security" element={<SecuritySettings />} />
        <Route path="settings/notifications" element={<NotificationSettings />} />
      </Route>

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
