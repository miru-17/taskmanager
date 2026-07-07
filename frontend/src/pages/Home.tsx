import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../services/api";
import type { Task } from "../types/Task";

import TaskForm from "../components/TaskForm";
import TaskCard from "../components/TaskCard";
import DashboardStats from "../components/DashboardStats";
import TaskSearch from "../components/TaskSearch";
import ConfirmModal from "../components/ConfirmModal";

const Home = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [search, setSearch] = useState("");

  // Delete Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<number | null>(null);

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
      console.log("Deleting task:", id);

      const response = await api.delete(`/tasks/${id}`);

      console.log("Delete response:", response);

      toast.success("Task deleted successfully!");

      await fetchTasks();
    } catch (err: any) {
      console.error("Delete Error:", err);

      if (err.response) {
        console.log("Status:", err.response.status);
        console.log("Data:", err.response.data);
      }

      toast.error("Failed to delete task.");
    }
  };

  // Load tasks on page load
  useEffect(() => {
    fetchTasks();
  }, []);

  // Search Filter
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) =>
      task.title.toLowerCase().includes(search.toLowerCase())
    );
  }, [tasks, search]);

  // Dashboard Statistics
  const completed = tasks.filter((t) => t.status === "DONE").length;
  const pending = tasks.filter((t) => t.status !== "DONE").length;

  // Loading Screen
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex flex-col items-center justify-center">
        <div
          className="
            w-20
            h-20
            rounded-full
            border-4
            border-cyan-500
            border-t-transparent
            animate-spin
            shadow-[0_0_40px_rgba(6,182,212,.6)]
          "
        />

        <h2 className="mt-8 text-white text-2xl font-bold">
          Loading Task Manager...
        </h2>

        <p className="text-slate-400 mt-2">
          Please wait while we fetch your tasks.
        </p>
      </div>
    );
  }

  // Error Screen
  if (error) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-3xl p-10 text-center max-w-md shadow-2xl">
          <h2 className="text-red-400 text-3xl font-bold">
            ⚠ Something went wrong
          </h2>

          <p className="text-slate-300 mt-4">{error}</p>

          <button
            onClick={fetchTasks}
            className="
              mt-8
              px-6
              py-3
              rounded-xl
              bg-red-500
              hover:bg-red-600
              transition
              text-white
              font-semibold
            "
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="max-w-7xl mx-auto p-8">

          {/* Header */}

          <div className="text-center mb-10">
            <h1 className="text-5xl font-black text-white">
              📋 Task Manager
            </h1>

            <p className="text-slate-400 mt-3 text-lg">
              Organize your work efficiently
            </p>
          </div>

          {/* Dashboard */}

          <DashboardStats
            total={tasks.length}
            completed={completed}
            pending={pending}
          />

          {/* Search */}

          <TaskSearch
            value={search}
            onChange={setSearch}
          />

          {/* Task Form */}

          <TaskForm
            editingTask={editingTask}
            onTaskCreated={async () => {
              await fetchTasks();
              setEditingTask(null);
            }}
          />

          {/* Task List */}

          <div className="grid md:grid-cols-2 gap-8 mt-10">

            {filteredTasks.length === 0 ? (

              <div className="col-span-2 rounded-3xl bg-slate-900/60 border border-slate-700 p-12 text-center">

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
                />
              ))

            )}

          </div>

        </div>
      </div>

      {/* Delete Confirmation Modal */}

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