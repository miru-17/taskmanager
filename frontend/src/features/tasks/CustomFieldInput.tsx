import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { CustomField } from "../../types/Task";
import { displayName } from "../../types/Task";
import { fieldBase, field as fieldClass } from "../../ui";
import { cx } from "../../ui/cx";
import { useAssignable } from "./useAssignable";

/**
 * One editor per custom field type. Text-like inputs commit on blur (one request per edit,
 * not per keystroke); choices commit immediately. The server validates every value again.
 */
const CustomFieldInput = ({
  field,
  value,
  onCommit,
  disabled,
  projectId,
  id,
}: {
  field: CustomField;
  value: unknown;
  onCommit: (v: unknown) => void;
  disabled?: boolean;
  projectId: string;
  id?: string;
}) => {
  const people = useAssignable(projectId);
  const [draft, setDraft] = useState<string>(value === null || value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === null || value === undefined ? "" : String(value)), [value]);
  const label = field.name + (field.required ? " (required)" : "");
  const commitText = (parse: (s: string) => unknown = (s) => s) => {
    const next = draft.trim() === "" ? null : parse(draft.trim());
    if ((next ?? "") !== (value ?? "")) onCommit(next);
  };

  switch (field.type) {
    case "TEXT":
      return <input id={id} aria-label={label} className={fieldClass} maxLength={2000} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commitText()} />;
    case "NUMBER":
      return (
        <input
          id={id}
          aria-label={label}
          type="number"
          step="any"
          className={fieldClass}
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitText((s) => Number(s))}
        />
      );
    case "DATE":
      return <input id={id} aria-label={label} type="date" className={fieldClass} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commitText()} />;
    case "URL":
      return (
        <div className="flex items-center gap-1.5">
          <input
            id={id}
            aria-label={label}
            type="url"
            placeholder="https://"
            className={cx(fieldBase, "min-w-0 flex-1")}
            disabled={disabled}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitText()}
          />
          {/* Only http(s) links are ever stored, so this can't become a javascript: link */}
          {typeof value === "string" && /^https?:\/\//.test(value) && (
            <a href={value} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open ${field.name}`} className="text-muted hover:text-fg">
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      );
    case "CHECKBOX":
      return (
        <input
          id={id}
          aria-label={label}
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          disabled={disabled}
          checked={value === true}
          onChange={(e) => onCommit(e.target.checked ? true : null)}
        />
      );
    case "SELECT":
      return (
        <select id={id} aria-label={label} className={fieldClass} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(e) => onCommit(e.target.value || null)}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "MULTI_SELECT": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
          {field.options?.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => {
                  const next = on ? selected.filter((x) => x !== o.id) : [...selected, o.id];
                  onCommit(next.length ? next : null);
                }}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs disabled:opacity-60",
                  on ? "border-accent bg-accent/10 text-fg" : "border-line text-muted hover:text-fg"
                )}
              >
                <span className="size-2 rounded-full" style={{ background: o.color }} aria-hidden />
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "USER":
      return (
        <select id={id} aria-label={label} className={fieldClass} disabled={disabled} value={typeof value === "number" ? String(value) : ""} onChange={(e) => onCommit(e.target.value ? Number(e.target.value) : null)}>
          <option value="">—</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {displayName(p)}
            </option>
          ))}
        </select>
      );
  }
};

export default CustomFieldInput;
