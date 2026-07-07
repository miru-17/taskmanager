interface TaskSearchProps {
  value: string;
  onChange: (value: string) => void;
}

const TaskSearch = ({
  value,
  onChange,
}: TaskSearchProps) => {
  return (
    <div className="mb-8">
      <input
        type="text"
        placeholder="🔍 Search your tasks..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          w-full
          rounded-2xl
          bg-slate-900/70
          backdrop-blur-xl
          border
          border-cyan-500/30
          px-6
          py-4
          text-white
          placeholder:text-white/70
          text-lg
          shadow-[0_0_25px_rgba(6,182,212,0.25)]
          transition-all
          duration-300
          focus:outline-none
          focus:border-cyan-400
          focus:ring-4
          focus:ring-cyan-500/20
          focus:shadow-[0_0_40px_rgba(6,182,212,0.5)]
        "
      />
    </div>
  );
};

export default TaskSearch;