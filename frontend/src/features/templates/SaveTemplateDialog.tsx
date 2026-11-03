import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../services/api";
import { useOrgAction } from "../../data/queries";
import type { TaskDetail } from "../../types/Task";
import { Button, Dialog, Field, field, textarea } from "../../ui";

/** Snapshots a task (fields, checklist, subtasks, duration) as a reusable template. */
const SaveTemplateDialog = ({ task, open, onClose }: { task: TaskDetail; open: boolean; onClose: () => void }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectOnly, setProjectOnly] = useState(true);
  useEffect(() => {
    if (open) {
      setName(task.title.slice(0, 80));
      setDescription("");
      setProjectOnly(true);
    }
  }, [open, task.title]);

  const save = useOrgAction(() => api.post(`/templates/from-task/${task.id}`, { name: name.trim(), description: description.trim() || null, projectOnly }), "Could not save the template");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save as template"
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => (toast.success("Template saved"), onClose()) })}>
            Save template
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Saves the title, description, priority, estimate, labels, checklist and {task.subtasks.length} subtask{task.subtasks.length === 1 ? "" : "s"}. The due date is kept relative to the day it's used.
        </p>
        <Field label="Template name">{(id) => <input id={id} data-autofocus className={field} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Description (optional)">{(id) => <textarea id={id} rows={2} maxLength={500} className={textarea} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <label className="flex items-start gap-2 text-sm text-fg-soft">
          <input type="checkbox" className="mt-0.5" checked={projectOnly} onChange={(e) => setProjectOnly(e.target.checked)} />
          <span>
            Only for {task.project.name}
            <span className="block text-xs text-muted">Keeps custom field values. Uncheck to offer it in every project (custom field values are left out).</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
};

export default SaveTemplateDialog;
