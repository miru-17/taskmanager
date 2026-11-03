import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUp, Circle, CircleCheck, CircleDashed, CircleDot, Equal, Loader2, X } from "lucide-react";
import type { Priority, ProjectHealth, TaskStatus } from "../types/Task";
import { cx } from "./cx";
import { HEALTH_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "../types/Task";


// ─── Buttons & fields ────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-card",
  secondary: "bg-surface text-fg border border-line hover:bg-elev shadow-card",
  ghost: "text-fg-soft hover:bg-elev hover:text-fg",
  danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/15",
};

export const Button = ({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) => (
  <button
    type="button"
    {...rest}
    disabled={disabled || loading}
    className={cx(
      "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
      size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
      VARIANTS[variant],
      className
    )}
  >
    {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
    {children}
  </button>
);

export const IconButton = ({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...rest}
    className={cx("inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-elev hover:text-fg transition-colors disabled:opacity-40", className)}
  >
    {children}
  </button>
);

/** Base field styles without a width, for inline controls that size themselves (w-auto, w-40 …). */
export const fieldBase =
  "h-9 rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent disabled:opacity-60";
export const field = `${fieldBase} w-full`;
export const textarea =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent";

export const Field = ({ label, hint, children, error }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) => {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-fg-soft">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
};

// ─── Status, priority, health ────────────────────────────────────────────────

const STATUS_STYLE: Record<TaskStatus, { icon: typeof Circle; className: string }> = {
  TODO: { icon: Circle, className: "text-muted" },
  IN_PROGRESS: { icon: CircleDot, className: "text-info" },
  IN_REVIEW: { icon: CircleDashed, className: "text-warning" },
  DONE: { icon: CircleCheck, className: "text-success" },
};

export const StatusIcon = ({ status, className }: { status: TaskStatus; className?: string }) => {
  const { icon: Icon, className: tone } = STATUS_STYLE[status];
  return <Icon className={cx("size-4 shrink-0", tone, className)} aria-label={STATUS_LABELS[status]} />;
};

export const StatusPill = ({ status }: { status: TaskStatus }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md bg-elev px-2 py-0.5 text-xs font-medium text-fg-soft">
    <StatusIcon status={status} className="size-3.5" />
    {STATUS_LABELS[status]}
  </span>
);

const PRIORITY_STYLE: Record<Priority, { icon: typeof Circle; className: string }> = {
  CRITICAL: { icon: AlertTriangle, className: "text-danger" },
  HIGH: { icon: ChevronsUp, className: "text-warning" },
  MEDIUM: { icon: Equal, className: "text-info" },
  LOW: { icon: ArrowDown, className: "text-muted" },
};

export const PriorityIcon = ({ priority, className }: { priority: Priority; className?: string }) => {
  const { icon: Icon, className: tone } = PRIORITY_STYLE[priority];
  return (
    <span title={`${PRIORITY_LABELS[priority]} priority`} className="inline-flex">
      <Icon className={cx("size-4 shrink-0", tone, className)} aria-label={`${PRIORITY_LABELS[priority]} priority`} />
    </span>
  );
};

const HEALTH_STYLE: Record<ProjectHealth, string> = {
  on_track: "bg-success/12 text-success",
  at_risk: "bg-warning/12 text-warning",
  off_track: "bg-danger/12 text-danger",
  completed: "bg-accent/12 text-accent",
  on_hold: "bg-elev text-muted",
};

export const HealthBadge = ({ health }: { health: ProjectHealth }) => (
  <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", HEALTH_STYLE[health])}>
    <span className="size-1.5 rounded-full bg-current" aria-hidden />
    {HEALTH_LABELS[health]}
  </span>
);

export const SortArrow = ({ dir }: { dir: "asc" | "desc" }) =>
  dir === "asc" ? <ArrowUp className="size-3" aria-label="ascending" /> : <ArrowDown className="size-3" aria-label="descending" />;

// ─── Misc ────────────────────────────────────────────────────────────────────

export const LabelChip = ({ name, color }: { name: string; color: string }) => (
  <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-px text-[11px] font-medium text-fg-soft">
    <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
    {name}
  </span>
);

const AVATAR_TONES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export const Avatar = ({ user, size = 22 }: { user: { id?: number; name: string | null; email: string } | null; size?: number }) => {
  if (!user) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-muted"
        style={{ width: size, height: size }}
        title="Unassigned"
        aria-label="Unassigned"
      />
    );
  }
  const label = user.name || user.email;
  const initials = label
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const tone = AVATAR_TONES[(user.id ?? label.length) % AVATAR_TONES.length];
  return (
    <span
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: tone, fontSize: size * 0.42 }}
      title={label}
      aria-label={label}
    >
      {initials || "?"}
    </span>
  );
};

export const Progress = ({ value, className, tone = "bg-accent" }: { value: number; className?: string; tone?: string }) => (
  <div
    className={cx("h-1.5 w-full overflow-hidden rounded-full bg-elev-2", className)}
    role="progressbar"
    aria-valuenow={Math.round(value * 100)}
    aria-valuemin={0}
    aria-valuemax={100}
  >
    <div className={cx("h-full rounded-full transition-[width]", tone)} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
  </div>
);

export const Spinner = ({ label = "Loading…" }: { label?: string }) => (
  <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
    <Loader2 className="size-4 animate-spin" aria-hidden />
    {label}
  </div>
);

export const EmptyState = ({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
    {icon && <div className="mb-3 text-muted">{icon}</div>}
    <p className="font-medium text-fg">{title}</p>
    {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-6 text-center text-sm text-danger">
    <p>{message}</p>
    {onRetry && (
      <Button className="mt-3" size="sm" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

// ─── Dialog & drawer ─────────────────────────────────────────────────────────

/** Esc closes; focus moves into the panel and returns to the trigger afterwards. */
const useDismiss = (open: boolean, onClose: () => void) => {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the top-most dialog reacts (a confirm inside the task drawer, for example)
      const dialogs = document.querySelectorAll("[role=dialog]");
      if (dialogs[dialogs.length - 1] !== panel.current) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    const first =
      panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>("input, textarea, select, button");
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  return panel;
};

export const Dialog = ({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) => {
  const panel = useDismiss(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={cx("w-full rounded-xl border border-line bg-surface shadow-pop", width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

export const Drawer = ({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) => {
  const panel = useDismiss(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className="flex h-full w-full max-w-2xl flex-col border-l border-line bg-surface shadow-pop">
        {children}
      </div>
    </div>,
    document.body
  );
};

export const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
  loading,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    title={title}
    width="max-w-md"
    footer={
      <>
        <Button variant="ghost" onClick={onClose} data-autofocus>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </>
    }
  >
    <p className="text-sm text-fg-soft">{message}</p>
  </Dialog>
);
