import { useState } from "react";
import toast from "react-hot-toast";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useFields, useProjectAction, useTemplates } from "../../data/queries";
import { FIELD_TYPE_LABELS, type CustomField, type CustomFieldType, type FieldOption, type Project } from "../../types/Task";
import { Button, ConfirmDialog, Dialog, Field, IconButton, field, fieldBase } from "../../ui";
import { cx } from "../../ui/cx";

const Card = ({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="font-medium">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

const COLORS = ["#64748b", "#ef4444", "#f59e0b", "#10b981", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899"];
const isSelect = (t: CustomFieldType) => t === "SELECT" || t === "MULTI_SELECT";

const FieldDialog = ({ projectId, open, onClose, editing }: { projectId: string; open: boolean; onClose: () => void; editing: CustomField | null }) => {
  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<CustomFieldType>(editing?.type ?? "TEXT");
  const [required, setRequired] = useState(editing?.required ?? false);
  const [description, setDescription] = useState(editing?.description ?? "");
  const [options, setOptions] = useState<(Partial<FieldOption> & { label: string; color: string })[]>(editing?.options ?? []);
  const [optionText, setOptionText] = useState("");

  const save = useProjectAction(() => {
    const body = { name: name.trim(), required, description: description.trim() || null, ...(isSelect(type) ? { options } : {}) };
    return (editing ? api.patch(`/projects/${projectId}/fields/${editing.id}`, body) : api.post(`/projects/${projectId}/fields`, { ...body, type })) as Promise<unknown>;
  }, "Could not save the field");

  const addOption = () => {
    const label = optionText.trim();
    if (!label) return;
    if (options.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
      toast.error("That option already exists");
      return;
    }
    setOptions([...options, { label, color: COLORS[options.length % COLORS.length] }]);
    setOptionText("");
  };
  const removedCount = editing?.options ? editing.options.filter((o) => !options.some((x) => x.id === o.id)).length : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "New custom field"}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || (isSelect(type) && !options.length)}
            loading={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: () => (toast.success(editing ? "Field updated" : "Field added"), onClose()) })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">{(id) => <input id={id} data-autofocus className={field} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Type" hint={editing ? "The type can't change once tasks may hold values." : undefined}>
          {(id) => (
            <select id={id} className={field} value={type} disabled={!!editing} onChange={(e) => setType(e.target.value as CustomFieldType)}>
              {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {isSelect(type) && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-soft">Options</p>
            <ul className="space-y-1">
              {options.map((o, i) => (
                <li key={o.id ?? `new-${i}`} className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Color for ${o.label}`}
                    className="size-6 cursor-pointer rounded border border-line bg-transparent"
                    value={o.color}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
                  />
                  <input
                    aria-label={`Option ${i + 1}`}
                    className={cx(fieldBase, "h-8 flex-1")}
                    maxLength={60}
                    value={o.label}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                  <IconButton label={`Remove ${o.label}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                aria-label="New option"
                placeholder="Add an option"
                className={cx(fieldBase, "h-8 flex-1")}
                maxLength={60}
                value={optionText}
                onChange={(e) => setOptionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOption();
                  }
                }}
              />
              <Button size="sm" onClick={addOption} disabled={!optionText.trim()}>
                Add
              </Button>
            </div>
            {removedCount > 0 && <p className="mt-2 text-xs text-warning">Removing an option clears it from every task that uses it.</p>}
          </div>
        )}
        <Field label="Help text (optional)">{(id) => <input id={id} className={field} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <label className="flex items-center gap-2 text-sm text-fg-soft">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required on new tasks
        </label>
      </div>
    </Dialog>
  );
};

export const CustomFieldsCard = ({ project }: { project: Project }) => {
  const { data: fields } = useFields(project.id);
  const [editing, setEditing] = useState<CustomField | null | "new">(null);
  const [deleting, setDeleting] = useState<CustomField | null>(null);
  const remove = useProjectAction((id: string) => api.delete(`/projects/${project.id}/fields/${id}`), "Could not delete the field");

  return (
    <Card
      title="Custom fields"
      description="Extra typed fields shown on every task in this project."
      action={
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
          Add field
        </Button>
      }
    >
      <ul className="divide-y divide-line rounded-lg border border-line">
        {fields?.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {f.name}
                {f.required && <span className="ml-1.5 text-xs text-warning">required</span>}
              </span>
              <span className="block text-xs text-muted">
                {FIELD_TYPE_LABELS[f.type]}
                {f.options?.length ? ` · ${f.options.map((o) => o.label).join(", ")}` : ""}
              </span>
            </span>
            <IconButton label={`Edit ${f.name}`} onClick={() => setEditing(f)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label={`Delete ${f.name}`} onClick={() => setDeleting(f)}>
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
        {!fields?.length && <li className="px-3 py-3 text-sm text-muted">No custom fields.</li>}
      </ul>
      {editing && <FieldDialog key={editing === "new" ? "new" : editing.id} projectId={project.id} open onClose={() => setEditing(null)} editing={editing === "new" ? null : editing} />}
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.name}?`}
        message="Its values are removed from every task in this project."
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting!.id, { onSuccess: () => (toast.success("Field deleted"), setDeleting(null)) })}
      />
    </Card>
  );
};

export const ApprovalPolicyCard = ({ project }: { project: Project }) => {
  const set = useProjectAction((mode: "NONE" | "REQUIRED") => api.patch(`/projects/${project.id}`, { completionApproval: mode }), "Could not change the approval policy");
  // Flip immediately; the project's stored value takes over once the save settles
  const [pending, setPending] = useState<boolean | null>(null);
  const required = pending ?? project.completionApproval === "REQUIRED";
  return (
    <Card title="Completion approval" description="Anyone can request an approval on any task. Turn this on to make an approval mandatory before a task in this project can be marked done.">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={required}
          disabled={set.isPending}
          onChange={(e) => {
            const on = e.target.checked;
            setPending(on);
            set.mutate(on ? "REQUIRED" : "NONE", {
              onSuccess: () => toast.success(on ? "Approval is now required" : "Approval is optional"),
              onSettled: () => setPending(null),
            });
          }}
        />
        Require an approval before tasks are completed
      </label>
    </Card>
  );
};

export const TemplatesCard = ({ project }: { project: Project }) => {
  const { can } = useAuth();
  const { data: templates } = useTemplates(project.id);
  const [deleting, setDeleting] = useState<string | null>(null);
  const remove = useProjectAction((id: string) => api.delete(`/templates/${id}`), "Could not delete the template");
  const target = templates?.find((t) => t.id === deleting);

  return (
    <Card title="Templates" description="Start new tasks from a template in the New task dialog. Save one from any task with the bookmark button in the task panel.">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {templates?.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{t.name}</span>
              <span className="block text-xs text-muted">
                {t.projectId ? "This project" : "All projects"} · {t.checklistCount} checklist item{t.checklistCount === 1 ? "" : "s"} · {t.subtaskCount} subtask{t.subtaskCount === 1 ? "" : "s"}
              </span>
            </span>
            {can("templates:manage") && (
              <IconButton label={`Delete template ${t.name}`} onClick={() => setDeleting(t.id)}>
                <Trash2 className="size-4" />
              </IconButton>
            )}
          </li>
        ))}
        {!templates?.length && <li className="px-3 py-3 text-sm text-muted">No templates yet.</li>}
      </ul>
      <ConfirmDialog
        open={!!target}
        title={`Delete ${target?.name}?`}
        message={target?.projectId ? "Tasks already created from it stay as they are." : "It's used by every project. Tasks already created from it stay as they are."}
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting!, { onSuccess: () => (toast.success("Template deleted"), setDeleting(null)) })}
      />
    </Card>
  );
};
