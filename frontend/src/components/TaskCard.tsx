import type { Task } from "../types/Task";

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onStatusChange: (
    id: number,
    status: "TODO" | "IN_PROGRESS" | "DONE"
  ) => void;
}

const TaskCard = ({
  task,
  onEdit,
  onDelete,
  onStatusChange,
}: TaskCardProps) => {
  const statusColor = () => {
    switch (task.status) {
      case "DONE":
        return "bg-green-500/20 text-green-400 border-green-500/30";

      case "IN_PROGRESS":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";

      default:
        return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
    }
  };

  const formattedDate = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "No Due Date";

  return (
    <div
      className="
      group
      relative
      overflow-hidden
      rounded-3xl
      bg-white/5
      backdrop-blur-xl
      border
      border-white/10
      p-7
      shadow-[0_0_30px_rgba(59,130,246,.15)]
      hover:shadow-[0_0_70px_rgba(124,58,237,.45)]
      transition-all
      duration-500
      hover:-translate-y-2
      hover:scale-[1.02]
    "
    >
      {/* Glow Line */}
      <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500" />

      {/* Header */}
      <div className="flex justify-between items-center">

        <h2 className="text-2xl font-bold text-white">
          {task.title}
        </h2>

        {/* Inline Status Dropdown */}
        <select
          value={task.status}
          onChange={(e) =>
            onStatusChange(
              task.id,
              e.target.value as "TODO" | "IN_PROGRESS" | "DONE"
            )
          }
          className={`px-4 py-2 rounded-full text-sm font-bold border ${statusColor()} bg-transparent outline-none cursor-pointer`}
        >
          <option value="TODO">TODO</option>
          <option value="IN_PROGRESS">IN PROGRESS</option>
          <option value="DONE">DONE</option>
        </select>

      </div>

      {/* Description */}
      <p className="text-slate-400 mt-5 leading-7">
        {task.description || "No Description"}
      </p>

      {/* Footer */}
      <div className="mt-8 flex justify-between items-center">

        <div>
          <p className="text-slate-500 text-sm">
            Due Date
          </p>

          <h4 className="text-cyan-300 font-semibold mt-1">
            📅 {formattedDate}
          </h4>
        </div>

        <div className="flex gap-3">

          <button
            onClick={() => onEdit(task)}
            className="
            px-5
            py-2.5
            rounded-xl
            bg-gradient-to-r
            from-blue-600
            to-cyan-500
            text-white
            font-semibold
            shadow-lg
            hover:scale-105
            transition-all
          "
          >
            ✏ Edit
          </button>

          <button
            onClick={() => onDelete(task.id)}
            className="
            px-5
            py-2.5
            rounded-xl
            bg-gradient-to-r
            from-red-500
            to-pink-600
            text-white
            font-semibold
            shadow-lg
            hover:scale-105
            transition-all
          "
          >
            🗑 Delete
          </button>

        </div>

      </div>
    </div>
  );
};

export default TaskCard;