import type { ReactNode } from "react";

/** Shared frame for settings-style pages (rendered inside the app shell). */
const PageShell = ({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) => (
  <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8">
    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    {subtitle && <p className="text-muted mt-1 text-sm">{subtitle}</p>}
    <div className="mt-8 space-y-6">{children}</div>
  </div>
);

export const Card = ({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) => (
  <section className="rounded-xl bg-surface border border-line p-6 shadow-card">
    <div className="flex items-center justify-between gap-4 mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {actions}
    </div>
    {children}
  </section>
);

export const inputClass =
  "w-full h-10 px-3 rounded-lg bg-surface text-fg border border-line focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60";
export const primaryButton =
  "px-5 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg font-semibold transition disabled:opacity-60";
export const secondaryButton =
  "px-4 py-2 rounded-lg border border-line text-fg-soft hover:bg-elev transition disabled:opacity-60";
export const dangerButton =
  "px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/40 text-danger hover:bg-red-500/20 transition disabled:opacity-60";

export default PageShell;
