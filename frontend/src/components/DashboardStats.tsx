interface DashboardStatsProps {
  total: number;
  completed: number;
  pending: number;
}

const DashboardStats = ({
  total,
  completed,
  pending,
}: DashboardStatsProps) => {
  const cards = [
    {
      title: "Total Tasks",
      value: total,
      color: "from-cyan-500 to-blue-600",
      glow: "shadow-cyan-500/30",
      icon: "📋",
    },
    {
      title: "Completed",
      value: completed,
      color: "from-green-500 to-emerald-600",
      glow: "shadow-green-500/30",
      icon: "✅",
    },
    {
      title: "Pending",
      value: pending,
      color: "from-orange-500 to-red-500",
      glow: "shadow-orange-500/30",
      icon: "⏳",
    },
  ];

  return (
    <div className="grid gap-8 md:grid-cols-3 mb-10">
      {cards.map((card) => (
        <div
          key={card.title}
          className={`
          relative
          overflow-hidden
          rounded-3xl
          bg-white/5
          backdrop-blur-xl
          border
          border-white/10
          p-8
          shadow-2xl
          ${card.glow}
          hover:scale-105
          hover:-translate-y-2
          transition-all
          duration-500
        `}
        >
          {/* Glow */}
          <div
            className={`absolute inset-0 opacity-20 bg-gradient-to-br ${card.color}`}
          />

          {/* Top Border */}
          <div
            className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${card.color}`}
          />

          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm uppercase tracking-widest">
                {card.title}
              </p>

              <h1 className="text-5xl font-black text-white mt-4">
                {card.value}
              </h1>
            </div>

            <div className="text-5xl">{card.icon}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DashboardStats;