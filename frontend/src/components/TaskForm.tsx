import { useState, useEffect } from "react";
import api from "../services/api";
import toast from "react-hot-toast";
import type { Task } from "../types/Task";

interface TaskFormProps {
  onTaskCreated: () => void;
  onCancelEdit?: () => void;
  editingTask: Task | null;
}

const todayLocal = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const TaskForm = ({ onTaskCreated, onCancelEdit, editingTask }: TaskFormProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Task["status"]>("TODO");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setStatus("TODO");
    setDueDate("");
  };

  useEffect(() => {
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description || "");
      setStatus(editingTask.status);
      // Always overwrite, so a previous task's date never leaks into this one
      setDueDate(editingTask.dueDate ? editingTask.dueDate.split("T")[0] : "");
    } else {
      resetForm();
    }
  }, [editingTask]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      title,
      description,
      status,
      dueDate: dueDate || null,
    };

    try {
      setSaving(true);

      if (editingTask) {
        await api.put(`/tasks/${editingTask.id}`, payload);
        toast.success("Task Updated Successfully!");
      } else {
        await api.post("/tasks", payload);
        toast.success("Task Created Successfully!");
      }

      resetForm();
      onTaskCreated();
    } catch (error: any) {
      console.error(error);
      toast.error(error.response?.data?.message || "Failed to save task.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl p-8 mb-8">
      <h2 className="text-3xl font-bold text-gray-800 mb-2">
        {editingTask ? "✏ Edit Task" : "➕ Create New Task"}
      </h2>

      <p className="text-gray-500 mb-8">
        Organize your work efficiently.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="task-title" className="block text-gray-700 font-semibold mb-2">
            Title
          </label>

          <input
            id="task-title"
            type="text"
            placeholder="Enter task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div>
          <label htmlFor="task-description" className="block text-gray-700 font-semibold mb-2">
            Description
          </label>

          <textarea
            id="task-description"
            rows={4}
            placeholder="Enter task description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="task-status" className="block text-gray-700 font-semibold mb-2">
              Status
            </label>

            <select
              id="task-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Task["status"])}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="TODO">📝 TODO</option>
              <option value="IN_PROGRESS">🚀 IN PROGRESS</option>
              <option value="DONE">✅ DONE</option>
            </select>
          </div>

          <div>
            <label htmlFor="task-due-date" className="block text-gray-700 font-semibold mb-2">
              Due Date
            </label>

            <input
              id="task-due-date"
              type="date"
              value={dueDate}
              // New tasks can't be due in the past; existing overdue tasks stay editable
              min={editingTask ? undefined : todayLocal()}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition duration-300"
          >
            {saving ? "Saving..." : editingTask ? "Update Task" : "Create Task"}
          </button>

          {editingTask && onCancelEdit && (
            <button
              type="button"
              onClick={() => {
                resetForm();
                onCancelEdit();
              }}
              className="px-6 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 rounded-xl transition duration-300"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default TaskForm;
