import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../services/api";
import type { Task } from "../types/Task";
import { useAuth } from "../context/AuthContext";

import TaskForm from "../components/TaskForm";
import TaskCard from "../components/TaskCard";
import DashboardStats from "../components/DashboardStats";
import TaskSearch from "../components/TaskSearch";
import ConfirmModal from "../components/ConfirmModal";

import background from "../assets/background.jpg";

const Home = () => {
  const { user, logout } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [search, setSearch] = useState("");

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<number | null>(null);

  // Logout
  const handleLogout = () => {
    logout();
    toast.success("Logged out successfully!");
  };

  // Fetch Tasks
  const fetchTasks = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/tasks");
      setTasks(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to load tasks. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Delete Task
  const deleteTask = async (id: number) => {
    try {
      await api.delete(`/tasks/${id}`);

      toast.success("Task deleted successfully!");

      await fetchTasks();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete task.");
    }
  };

  // Change Status — send only the field that changed (partial update)
const handleStatusChange = async (
  id: number,
  status: "TODO" | "IN_PROGRESS" | "DONE"
) => {
  try {
    await api.patch(`/tasks/${id}`, { status });

    // Update UI immediately
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status,
            }
          : t
      )
    );

    toast.success("Task status updated!");
  } catch (err) {
    console.error(err);
    toast.error("Failed to update status.");
  }
};
  useEffect(() => {
    fetchTasks();
  }, []);

  // Search
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) =>
      task.title.toLowerCase().includes(search.toLowerCase())
    );
  }, [tasks, search]);

  const completed = tasks.filter((task) => task.status === "DONE").length;
  const pending = tasks.filter((task) => task.status !== "DONE").length;

  // Loading Screen
  if (loading) {
    return (
      <div
        className="min-h-screen bg-cover bg-center bg-no-repeat flex flex-col items-center justify-center"
        style={{
          backgroundImage: `url(${background})`,
        }}
      >
        <div className="absolute inset-0 bg-black/70"></div>

        <div className="relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 rounded-full border-4 border-cyan-500 border-t-transparent animate-spin shadow-[0_0_40px_rgba(6,182,212,.6)]" />

          <h2 className="mt-8 text-white text-2xl font-bold">
            Loading Task Manager...
          </h2>

          <p className="text-slate-300 mt-2">
            Please wait while we fetch your tasks.
          </p>
        </div>
      </div>
    );
  }

  // Error Screen
  if (error) {
    return (
      <div
        className="min-h-screen bg-cover bg-center bg-no-repeat flex items-center justify-center"
        style={{
          backgroundImage: `url(${background})`,
        }}
      >
        <div className="absolute inset-0 bg-black/70"></div>

        <div className="relative z-10 bg-red-500/10 backdrop-blur-md border border-red-500/30 rounded-3xl p-10 text-center max-w-md shadow-2xl">
          <h2 className="text-red-400 text-3xl font-bold">
            ⚠ Something went wrong
          </h2>

          <p className="text-slate-300 mt-4">{error}</p>

          <button
            onClick={fetchTasks}
            className="mt-8 px-6 py-3 rounded-xl bg-red-500 hover:bg-red-600 transition text-white font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="min-h-screen bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${background})`,
        }}
      >
        <div className="min-h-screen bg-black/70">
          <div className="max-w-7xl mx-auto p-8">

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-10">

              <div>
                <h1 className="text-5xl font-black text-white">
                  📋 Task Manager
                </h1>

                <p className="text-slate-300 mt-2 text-lg">
                  Organize your work efficiently
                </p>

                <div className="mt-5 inline-flex items-center gap-3 bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-xl px-5 py-3">
                  <span className="text-2xl">👋</span>

                  <div>
                    <p className="text-slate-400 text-sm">
                      Logged in as
                    </p>

                    <p className="text-cyan-400 font-semibold text-lg">
                      {user?.email ?? "Unknown User"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">

                <Link
                  to="/change-password"
                  className="bg-cyan-500 hover:bg-cyan-600 text-white px-6 py-3 rounded-xl font-semibold transition shadow-lg"
                >
                  🔒 Change Password
                </Link>

                <button
                  onClick={handleLogout}
                  className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-xl font-semibold transition shadow-lg"
                >
                  🚪 Logout
                </button>

              </div>
            </div>

            <DashboardStats
              total={tasks.length}
              completed={completed}
              pending={pending}
            />

            <TaskSearch
              value={search}
              onChange={setSearch}
            />

            <TaskForm
              editingTask={editingTask}
              onCancelEdit={() => setEditingTask(null)}
              onTaskCreated={async () => {
                await fetchTasks();
                setEditingTask(null);
              }}
            />

            <div className="grid md:grid-cols-2 gap-8 mt-10">
              {filteredTasks.length === 0 ? (
                <div className="col-span-2 rounded-3xl bg-slate-900/80 backdrop-blur-md border border-slate-700 p-12 text-center">
                  <h2 className="text-3xl text-white font-bold">
                    📂 No Tasks Found
                  </h2>

                  <p className="text-slate-400 mt-3">
                    Try creating a new task or change your search.
                  </p>
                </div>
              ) : (
                filteredTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
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