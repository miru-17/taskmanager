import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { BadgeCheck, BarChart3, BellRing, Building2, ChevronsUpDown, CreditCard, FolderKanban, Home, ListChecks, LogOut, Menu, Moon, Plus, Shield, Sun, Users, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useApprovalCount, useProjects } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { ROLE_LABELS } from "../../types/auth";
import { displayName } from "../../types/Task";
import { Avatar, IconButton } from "../../ui";
import { cx } from "../../ui/cx";
import TaskDrawer from "../tasks/TaskDrawer";
import NotificationBell from "../notifications/NotificationBell";
import { useLiveUpdates, type LiveState } from "../../data/live";
import TaskComposer from "../tasks/TaskComposer";
import { ComposerProvider, useComposer } from "../tasks/composer";
import { AssistantButton } from "../ai/Assistant";
import { BrandingApplier, useLogoUrl } from "../commercial/branding";

const navItem = ({ isActive }: { isActive: boolean }) =>
  cx(
    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
    isActive ? "bg-elev-2 text-fg font-medium" : "text-fg-soft hover:bg-elev hover:text-fg"
  );

const OrgSwitcher = () => {
  const { organization, organizations, switchOrganization } = useAuth();
  const navigate = useNavigate();
  const logo = useLogoUrl();
  if (!organization) return null;
  return (
    <label className="relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-elev">
      {logo ? (
        <img src={logo} alt="" className="size-7 shrink-0 rounded-md object-contain" />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg" aria-hidden>
          {organization.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{organization.name}</span>
        <span className="block truncate text-[11px] text-muted">{ROLE_LABELS[organization.role]}</span>
      </span>
      <ChevronsUpDown className="size-3.5 text-muted" aria-hidden />
      {/* Native select over the whole row: keyboard and screen-reader friendly */}
      <select
        aria-label="Switch organization"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={organization.id}
        onChange={async (e) => {
          try {
            await switchOrganization(e.target.value);
            navigate("/my-tasks");
          } catch (err) {
            toast.error(getErrorMessage(err, "Could not switch organization"));
          }
        }}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
};

const LIVE_LABEL: Record<LiveState, string> = { live: "Live updates on", connecting: "Connecting for live updates…", offline: "Live updates paused; reconnecting" };

const Sidebar = ({ onNavigate, live }: { onNavigate?: () => void; live: LiveState }) => {
  const { user, organization, logout, can } = useAuth();
  const { theme, toggle } = useTheme();
  const { data: projects } = useProjects();
  const { open: openComposer } = useComposer();
  const isClient = organization?.role === "CLIENT";
  const { data: pendingApprovals } = useApprovalCount();

  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <OrgSwitcher />
        </div>
        <NotificationBell />
      </div>

      {can("tasks:create") && (
        <button
          type="button"
          onClick={() => openComposer({})}
          className="mt-2 mb-1 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-medium text-fg shadow-card hover:bg-elev"
        >
          <Plus className="size-4" aria-hidden /> New task
          <kbd className="ml-auto rounded border border-line px-1 text-[10px] text-muted">C</kbd>
        </button>
      )}

      {isClient && (
        <NavLink to="/portal" className={navItem}>
          <Home className="size-4" aria-hidden /> Overview
        </NavLink>
      )}
      <NavLink to="/my-tasks" className={navItem}>
        <ListChecks className="size-4" aria-hidden /> My tasks
      </NavLink>
      <NavLink to="/approvals" className={navItem}>
        <BadgeCheck className="size-4" aria-hidden /> Approvals
        {!!pendingApprovals && (
          <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg" aria-label={`${pendingApprovals} waiting on you`}>
            {pendingApprovals}
          </span>
        )}
      </NavLink>
      <NavLink to="/projects" end className={navItem}>
        <FolderKanban className="size-4" aria-hidden /> Projects
      </NavLink>
      {can("analytics:read") && (
        <NavLink to="/analytics" className={navItem}>
          <BarChart3 className="size-4" aria-hidden /> Analytics
        </NavLink>
      )}
      {!isClient && (
        <NavLink to="/teams" className={navItem}>
          <Users className="size-4" aria-hidden /> Teams
        </NavLink>
      )}
      {!isClient && <AssistantButton className={cx(navItem({ isActive: false }), "w-full text-left")} />}

      <p className="mt-4 mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Projects</p>
      <div className="scroll-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {projects?.length ? (
          projects.map((p) => (
            <NavLink key={p.id} to={`/projects/${p.id}/board`} className={navItem}>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden />
              <span className="truncate">{p.name}</span>
              <span className="ml-auto text-[11px] text-muted">{p.key}</span>
            </NavLink>
          ))
        ) : (
          <p className="px-2.5 py-1 text-xs text-muted">{isClient ? "You haven't been added to a project yet." : "No projects yet."}</p>
        )}
      </div>

      <div className="mt-2 space-y-0.5 border-t border-line pt-2">
        <NavLink to="/settings/organization" className={navItem}>
          <Building2 className="size-4" aria-hidden /> Organization
        </NavLink>
        {!isClient && (
          <NavLink to="/settings/billing" className={navItem}>
            <CreditCard className="size-4" aria-hidden /> Plan and billing
          </NavLink>
        )}
        <NavLink to="/settings/security" className={navItem}>
          <Shield className="size-4" aria-hidden /> Security
        </NavLink>
        <NavLink to="/settings/notifications" className={navItem}>
          <BellRing className="size-4" aria-hidden /> Notifications
        </NavLink>
        <p className="flex items-center gap-2 px-2.5 pt-1 text-[11px] text-muted" role="status" aria-live="polite">
          <span className={cx("size-1.5 rounded-full", live === "live" ? "bg-success" : live === "connecting" ? "bg-warning" : "bg-muted")} aria-hidden />
          {LIVE_LABEL[live]}
        </p>
        <div className="flex items-center gap-2 px-2.5 pt-2">
          <Avatar user={user} size={26} />
          <span className="min-w-0 flex-1 truncate text-sm text-fg-soft">{user ? displayName(user) : ""}</span>
          <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggle}>
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
          <IconButton label="Sign out" onClick={() => logout()}>
            <LogOut className="size-4" />
          </IconButton>
        </div>
      </div>
    </nav>
  );
};

/** "C" opens the composer from anywhere, unless the user is typing. */
const useShortcuts = () => {
  const { open } = useComposer();
  const { can } = useAuth();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key.toLowerCase() === "c" && can("tasks:create")) {
        e.preventDefault();
        open({});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, can]);
};

const ShellInner = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const live = useLiveUpdates();
  useShortcuts();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex h-dvh overflow-hidden bg-app text-fg">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:block">
        <Sidebar live={live} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onMouseDown={(e) => e.target === e.currentTarget && setMobileOpen(false)} style={{ background: "rgb(0 0 0 / 0.35)" }}>
          <aside className="h-full w-64 border-r border-line bg-surface shadow-pop">
            <div className="flex justify-end p-2">
              <IconButton label="Close menu" onClick={() => setMobileOpen(false)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <Sidebar live={live} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
          <IconButton label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </IconButton>
          <span className="font-semibold">TaskForge</span>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <TaskDrawer />
      <TaskComposer />
    </div>
  );
};

const AppShell = () => (
  <ComposerProvider>
    <BrandingApplier />
    <ShellInner />
  </ComposerProvider>
);

export default AppShell;
