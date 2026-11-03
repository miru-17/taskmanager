import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../services/api";
import type { Task } from "../types/Task";
import { ROLE_LABELS, type AuthPayload } from "../types/auth";
import { useAuth } from "../context/AuthContext";
import { canModifyTask } from "../utils/permissions";

import TaskForm from "../components/TaskForm";
import TaskCard from "../components/TaskCard";
import DashboardStats from "../components/DashboardStats";
import TaskSearch from "../components/TaskSearch";
import ConfirmModal from "../components/ConfirmModal";

import background from "../assets/background.jpg";

const headerLink =
  "bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-white px-4 py-2.5 rounded-xl font-semibold transition";

/** Shown when the user belongs to no organization (e.g. they were removed from their last one). */
const NoOrganization = () => {
  const { applySession, logout } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<AuthPayload>("/orgs", { name });
      applySession(res.data);
      toast.success(`Created ${name}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? "Couldn't create the organization");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-8">
        <h1 className="text-2xl font-bold text-white">You're not in an organization</h1>
        <p className="text-slate-300 mt-3">Create one to start organizing work, or ask a teammate for an invitation.</p>
        <form onSubmit={create} className="mt-6 space-y-4">
          <input
            className="w-full p-3 rounded-xl bg-slate-800 text-white border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder="Organization name"
            aria-label="Organization name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={100}
            required
          />
          <button disabled={busy} className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white font-semibold disabled:opacity-60">
            Create organization
          </button>
        </form>
        <button onClick={() => void logout()} className="mt-4 w-full text-slate-400 hover:text-white text-sm">
          Sign out
        </button>
      </div>
    </div>
  );
};

const Home = () => {
  const { user, organization, organizations, permissions, can, logout, switchOrganization } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [search, setSearch] = useState("");

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<number | null>(null);

  const canRead = can("tasks:read");

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully!");
  };

  const fetchTasks = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const response = await api.get<Task[]>("/tasks");
      setTasks(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to load tasks. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  // Reload whenever the active organization changes
  useEffect(() => {
    setEditingTask(null);
    void fetchTasks();
  }, [fetchTasks, organization?.id]);

  const deleteTask = async (id: number) => {
    try {
      await api.delete(`/tasks/${id}`);
      toast.success("Task deleted successfully!");
      await fetchTasks();
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.message ?? "Failed to delete task.");
    }
  };

  // Partial update: send only the field that changed
  const handleStatusChange = async (id: number, status: "TODO" | "IN_PROGRESS" | "DONE") => {
    try {
      await api.patch(`/tasks/${id}`, { status });
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
      toast.success("Task status updated!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.message ?? "Failed to update status.");
    }
  };

  const onSwitch = async (id: string) => {
    try {
      await switchOrganization(id);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? "Couldn't switch organization");
    }
  };

  const filteredTasks = useMemo(
    () => tasks.filter((task) => task.title.toLowerCase().includes(search.toLowerCase())),
    [tasks, search]
  );

  const completed = tasks.filter((task) => task.status === "DONE").length;
  const pending = tasks.filter((task) => task.status !== "DONE").length;

  if (!organization) return <NoOrganization />;

  if (loading) {
    return (
      <div className="min-h-screen bg-cover bg-center bg-no-repeat flex flex-col items-center justify-center" style={{ backgroundImage: `url(${background})` }}>
        <div className="absolute inset-0 bg-black/70"></div>
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 rounded-full border-4 border-cyan-500 border-t-transparent animate-spin shadow-[0_0_40px_rgba(6,182,212,.6)]" />
          <h2 className="mt-8 text-white text-2xl font-bold">Loading Task Manager...</h2>
          <p className="text-slate-300 mt-2">Please wait while we fetch your tasks.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-cover bg-center bg-no-repeat flex items-center justify-center" style={{ backgroundImage: `url(${background})` }}>
        <div className="absolute inset-0 bg-black/70"></div>
        <div className="relative z-10 bg-red-500/10 backdrop-blur-md border border-red-500/30 rounded-3xl p-10 text-center max-w-md shadow-2xl">
          <h2 className="text-red-400 text-3xl font-bold">⚠ Something went wrong</h2>
          <p className="text-slate-300 mt-4">{error}</p>
          <button onClick={() => void fetchTasks()} className="mt-8 px-6 py-3 rounded-xl bg-red-500 hover:bg-red-600 transition text-white font-semibold">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${background})` }}>
        <div className="min-h-screen bg-black/70">
          <div className="max-w-7xl mx-auto p-4 sm:p-8">
            {!user?.emailVerified && (
              <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span>Please verify your email address — check your inbox for the link.</span>
                <Link to="/settings/security" className="text-amber-100 underline">
                  Resend email
                </Link>
              </div>
            )}

            {/* Header */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-10">
              <div>
                <h1 className="text-4xl sm:text-5xl font-black text-white">📋 TaskForge</h1>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {organizations.length > 1 ? (
                    <select
                      aria-label="Active organization"
                      value={organization.id}
                      onChange={(e) => void onSwitch(e.target.value)}
                      className="bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 text-white font-semibold focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 text-white font-semibold">
                      {organization.name}
                    </span>
                  )}
                  <span className="text-sm px-3 py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    {ROLE_LABELS[organization.role]}
                  </span>
                </div>

                <p className="text-slate-400 mt-3 text-sm">
                  Signed in as <span className="text-cyan-400">{user?.name || user?.email}</span>
                </p>
              </div>

              <nav className="flex flex-wrap gap-3" aria-label="Account">
                <Link to="/settings/organization" className={headerLink}>
                  👥 Organization
                </Link>
                <Link to="/settings/security" className={headerLink}>
                  🔒 Security
                </Link>
                <button onClick={() => void handleLogout()} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-xl font-semibold transition">
                  🚪 Logout
                </button>
              </nav>
            </div>

            {!canRead ? (
              <div className="rounded-3xl bg-slate-900/80 backdrop-blur-md border border-slate-700 p-12 text-center">
                <h2 className="text-2xl text-white font-bold">No task access yet</h2>
                <p className="text-slate-400 mt-3">
                  Your role ({ROLE_LABELS[organization.role]}) doesn't include internal tasks. Shared project views for
                  clients arrive with projects.
                </p>
              </div>
            ) : (
              <>
                <DashboardStats total={tasks.length} completed={completed} pending={pending} />

                <TaskSearch value={search} onChange={setSearch} />

                {(can("tasks:create") || editingTask) && (
                  <TaskForm
                    editingTask={editingTask}
                    onCancelEdit={() => setEditingTask(null)}
                    onTaskCreated={async () => {
                      await fetchTasks();
                      setEditingTask(null);
                    }}
                  />
                )}

                <div className="grid md:grid-cols-2 gap-8 mt-10">
                  {filteredTasks.length === 0 ? (
                    <div className="col-span-2 rounded-3xl bg-slate-900/80 backdrop-blur-md border border-slate-700 p-12 text-center">
                      <h2 className="text-3xl text-white font-bold">📂 No Tasks Found</h2>
                      <p className="text-slate-400 mt-3">
                        {can("tasks:create") ? "Try creating a new task or change your search." : "Nothing here yet."}
                      </p>
                    </div>
                  ) : (
                    filteredTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        canEdit={canModifyTask(permissions, user?.id, task, "update")}
                        canDelete={canModifyTask(permissions, user?.id, task, "delete")}
                        onEdit={setEditingTask}
                        onDelete={(id) => {
                          setTaskToDelete(id);
                          setShowDeleteModal(true);
                        }}
                        onStatusChange={handleStatusChange}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={showDeleteModal}
        title="Delete Task"
        message="Are you sure you want to delete this task? This action cannot be undone."
        onCancel={() => {
          setShowDeleteModal(false);
          setTaskToDelete(null);
        }}
        onConfirm={async () => {
          if (taskToDelete !== null) {
            await deleteTask(taskToDelete);
          }
          setShowDeleteModal(false);
          setTaskToDelete(null);
        }}
      />
    </>
  );
};

export default Home;
