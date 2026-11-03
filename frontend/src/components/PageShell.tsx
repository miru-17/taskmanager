import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Shared frame for settings-style pages. */
const PageShell = ({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) => (
  <div className="min-h-screen bg-slate-950 text-white">
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <Link to="/" className="text-sm text-cyan-400 hover:underline">
        ← Back to tasks
      </Link>
      <h1 className="text-3xl font-bold mt-4">{title}</h1>
      {subtitle && <p className="text-slate-400 mt-1">{subtitle}</p>}
      <div className="mt-8 space-y-8">{children}</div>
    </div>
  </div>
);

export const Card = ({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) => (
  <section className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
    <div className="flex items-center justify-between gap-4 mb-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {actions}
    </div>
    {children}
  </section>
);

export const inputClass =
  "w-full p-3 rounded-xl bg-slate-800 text-white border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60";
export const primaryButton =
  "px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white font-semibold transition disabled:opacity-60";
export const secondaryButton =
  "px-4 py-2 rounded-xl border border-slate-700 text-slate-200 hover:bg-slate-800 transition disabled:opacity-60";
export const dangerButton =
  "px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 hover:bg-red-500/20 transition disabled:opacity-60";

export default PageShell;
