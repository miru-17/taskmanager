import { useState } from "react";
import { Plus, Tag } from "lucide-react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useLabels, useOrgAction } from "../../data/queries";
import { displayName } from "../../types/Task";
import { field } from "../../ui";
import { cx } from "../../ui/cx";
import { useAssignable } from "./useAssignable";


export const AssigneeSelect = ({
  id,
  projectId,
  value,
  onChange,
  disabled,
  className,
}: {
  id?: string;
  projectId?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  className?: string;
}) => {
  const people = useAssignable(projectId);
  return (
    <select
      id={id}
      aria-label={id ? undefined : "Assignee"}
      className={cx(field, className)}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Unassigned</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {displayName(p)}
        </option>
      ))}
    </select>
  );
};

const LABEL_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#64748b"];

export const LabelPicker = ({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) => {
  const { can } = useAuth();
  const { data: labels } = useLabels();
  const [name, setName] = useState("");
  const create = useOrgAction(
    async (n: string) => {
      const res = await api.post("/labels", { name: n, color: LABEL_COLORS[(labels?.length ?? 0) % LABEL_COLORS.length] });
      onChange([...value, res.data.id]);
    },
    "Could not create the label"
  );

  if (!labels?.length && !can("labels:manage")) return null;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-soft">
        <Tag className="size-3.5" aria-hidden /> Labels
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {labels?.map((l) => {
          const on = value.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(l.id)}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-60",
                on ? "border-accent bg-accent/10 text-fg" : "border-line text-muted hover:text-fg"
              )}
            >
              <span className="size-2 rounded-full" style={{ background: l.color }} aria-hidden />
              {l.name}
            </button>
          );
        })}
        {can("labels:manage") && !disabled && (
          <div className="flex items-center">
            <input
              aria-label="New label name"
              placeholder="New label"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Nested inside the task form: Enter must create the label, not submit the task
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (name.trim()) create.mutate(name.trim(), { onSuccess: () => setName("") });
                }
              }}
              className="h-6 w-24 rounded-md border border-dashed border-line bg-transparent px-2 text-xs text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />
            {name.trim() && (
              <button type="button" aria-label="Add label" className="ml-1 text-muted hover:text-fg" onClick={() => create.mutate(name.trim(), { onSuccess: () => setName("") })}>
                <Plus className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
