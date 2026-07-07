import { useState, useEffect } from "react";
import api from "../services/api";
import toast from "react-hot-toast";
import type { Task } from "../types/Task";


interface TaskFormProps {
  onTaskCreated: () => void;
  editingTask: Task | null;
}

const TaskForm = ({ onTaskCreated, editingTask }: TaskFormProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("TODO");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description || "");
      setStatus(editingTask.status);

      if (editingTask.dueDate) {
        setDueDate(editingTask.dueDate.split("T")[0]);
      }
    } else {
      setTitle("");
      setDescription("");
      setStatus("TODO");
      setDueDate("");
    }
  }, [editingTask]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingTask) {
        await api.put(`/tasks/${editingTask.id}`, {
          title,
          description,
          status,
          dueDate,
        });
        toast.success("Task Updated Successfully!");
        
      } else {
        await api.post("/tasks", {
          title,
          description,
          status,
          dueDate,
        });

        toast.success("Task Created Successfully!");
      }

      setTitle("");
      setDescription("");
      setStatus("TODO");
      setDueDate("");

      onTaskCreated();
    } catch (error) {
      console.error(error);
      toast.error("Failed to save task.");
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
          <label className="block text-gray-700 font-semibold mb-2">
            Title
          </label>

          <input
            type="text"
            placeholder="Enter task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-gray-700 font-semibold mb-2">
            Description
          </label>

          <textarea
            rows={4}
            placeholder="Enter task description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className="block text-gray-700 font-semibold mb-2">
              Status
            </label>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="TODO">📝 TODO</option>
              <option value="IN_PROGRESS">🚀 IN PROGRESS</option>
              <option value="DONE">✅ DONE</option>
            </select>
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">
              Due Date
            </label>

            <input
              type="date"
              value={dueDate}
              min={new Date().toISOString().split("T")[0]}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition duration-300"
        >
          {editingTask ? "Update Task" : "Create Task"}
        </button>
      </form>
    </div>
  );
};

export default TaskForm;