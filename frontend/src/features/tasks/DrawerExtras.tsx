import { useEffect, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { CheckCircle2, Download, Eye, FileText, Paperclip, Repeat, Trash2, Upload, XCircle } from "lucide-react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useOrgMembers, useProject, useStorageUsage, useTaskAction } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { formatDay, timeAgo, toDateInput } from "../../data/dates";
import { displayName, type ApprovalRequest, type Attachment, type Frequency, type TaskDetail } from "../../types/Task";
import { Avatar, Button, Dialog, Field, IconButton, field, fieldBase, textarea } from "../../ui";
import { cx } from "../../ui/cx";
import { formatBytes } from "../../data/format";
import { useTaskParam } from "./composer";

export const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="border-t border-line px-6 py-4">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

// ─── Recurrence ──────────────────────────────────────────────────────────────

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UNIT: Record<Frequency, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };

const RecurrenceDialog = ({ task, open, onClose }: { task: TaskDetail; open: boolean; onClose: () => void }) => {
  const r = task.recurrence?.active ? task.recurrence : null;
  const anchorDay = task.dueDate ? Number(toDateInput(task.dueDate).slice(8)) : new Date().getDate();
  const [frequency, setFrequency] = useState<Frequency>("WEEKLY");
  const [interval, setInterval] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState(anchorDay);
  const [end, setEnd] = useState<"never" | "date" | "count">("never");
  const [endsOn, setEndsOn] = useState("");
  const [count, setCount] = useState(10);

  useEffect(() => {
    if (!open) return;
    setFrequency(r?.frequency ?? "WEEKLY");
    setInterval(r?.interval ?? 1);
    setWeekdays(r?.weekdays ?? []);
    setMonthDay(r?.monthDay ?? anchorDay);
    setEnd(r?.endsOn ? "date" : r?.maxOccurrences ? "count" : "never");
    setEndsOn(toDateInput(r?.endsOn));
    setCount(r?.maxOccurrences ?? 10);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useTaskAction(
    () =>
      api.put(`/tasks/${task.id}/recurrence`, {
        frequency,
        interval,
        weekdays: frequency === "WEEKLY" ? weekdays : [],
        monthDay: frequency === "MONTHLY" || frequency === "YEARLY" ? monthDay : null,
        endsOn: end === "date" ? endsOn || null : null,
        maxOccurrences: end === "count" ? count : null,
      }),
    "Could not save the repeat rule"
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Repeat task"
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={end === "date" && !endsOn} onClick={() => save.mutate(undefined, { onSuccess: () => (toast.success("Repeat saved"), onClose()) })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-xs text-muted">When this task is completed, the next one is created automatically with the next due date, the same assignee, labels and checklist.</p>
        <div className="flex items-center gap-2">
          <span>Every</span>
          <input aria-label="Interval" type="number" min={1} max={365} className={cx(fieldBase, "w-20")} value={interval} onChange={(e) => setInterval(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
          <select aria-label="Frequency" className={cx(fieldBase, "w-32")} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {(Object.keys(UNIT) as Frequency[]).map((f) => (
              <option key={f} value={f}>
                {UNIT[f]}
                {interval > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </div>
        {frequency === "WEEKLY" && (
          <div role="group" aria-label="On days" className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => {
              const on = weekdays.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== i) : [...weekdays, i])}
                  className={cx("h-8 w-11 rounded-md border text-xs", on ? "border-accent bg-accent text-accent-fg" : "border-line text-fg-soft hover:bg-elev")}
                >
                  {d}
                </button>
              );
            })}
            {!weekdays.length && <p className="w-full text-xs text-muted">No day chosen: repeats on the due date's weekday.</p>}
          </div>
        )}
        {(frequency === "MONTHLY" || frequency === "YEARLY") && (
          <label className="flex items-center gap-2">
            On day
            <input aria-label="Day of month" type="number" min={1} max={31} className={cx(fieldBase, "w-20")} value={monthDay} onChange={(e) => setMonthDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
            <span className="text-xs text-muted">(shorter months use their last day)</span>
          </label>
        )}
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-fg-soft">Ends</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="end" checked={end === "never"} onChange={() => setEnd("never")} /> Never
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="end" checked={end === "date"} onChange={() => setEnd("date")} /> On
            <input aria-label="End date" type="date" className={cx(fieldBase, "w-44")} disabled={end !== "date"} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="end" checked={end === "count"} onChange={() => setEnd("count")} /> After
            <input aria-label="Number of occurrences" type="number" min={1} max={1000} className={cx(fieldBase, "w-20")} disabled={end !== "count"} value={count} onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
            occurrences
          </label>
        </fieldset>
      </div>
    </Dialog>
  );
};

export const RecurrenceSection = ({ task }: { task: TaskDetail }) => {
  const [open, setOpen] = useState(false);
  const { openTask } = useTaskParam();
  const stop = useTaskAction(() => api.delete(`/tasks/${task.id}/recurrence`), "Could not stop the repeat");
  const r = task.recurrence?.active ? task.recurrence : null;
  const canEdit = task.permissions.edit && !task.archivedAt && !task.parentId;
  if (task.parentId && !r) return null;

  return (
    <Section
      title="Repeat"
      action={
        canEdit && task.status !== "DONE" ? (
          <Button size="sm" variant="ghost" icon={<Repeat className="size-3.5" />} onClick={() => setOpen(true)}>
            {r ? "Change" : "Make recurring"}
          </Button>
        ) : undefined
      }
    >
      {r ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Repeat className="size-4 text-accent" aria-hidden />
          <span>{r.summary}</span>
          {r.endsOn && <span className="text-xs text-muted">until {formatDay(r.endsOn)}</span>}
          {r.maxOccurrences && (
            <span className="text-xs text-muted">
              · {r.occurrences} of {r.maxOccurrences}
            </span>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" className="ml-auto" loading={stop.isPending} onClick={() => stop.mutate(undefined, { onSuccess: () => toast.success("Repeat stopped") })}>
              Stop repeating
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{task.recurrence && !task.recurrence.active ? "This series has ended." : "Doesn't repeat."}</p>
      )}
      {(task.previousOccurrence || task.nextOccurrence) && (
        <p className="mt-2 flex gap-3 text-xs">
          {task.previousOccurrence && (
            <button type="button" className="text-muted hover:text-fg" onClick={() => openTask(task.previousOccurrence!.id)}>
              ← Previous: {task.previousOccurrence.key}
            </button>
          )}
          {task.nextOccurrence && (
            <button type="button" className="text-muted hover:text-fg" onClick={() => openTask(task.nextOccurrence!.id)}>
              Next: {task.nextOccurrence.key} →
            </button>
          )}
        </p>
      )}
      <RecurrenceDialog task={task} open={open} onClose={() => setOpen(false)} />
    </Section>
  );
};

// ─── Attachments ─────────────────────────────────────────────────────────────

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

/** Files need the bearer token, so they're fetched as blobs rather than linked directly. */
const fetchBlob = async (a: Attachment) => {
  const res = await api.get<Blob>(`/attachments/${a.id}/download`, { responseType: "blob" });
  return URL.createObjectURL(new Blob([res.data], { type: a.mimeType }));
};

export const AttachmentsSection = ({ task }: { task: TaskDetail }) => {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const editable = task.permissions.edit && !task.archivedAt;
  const { data: usage } = useStorageUsage(editable);
  const { data: project } = useProject(task.projectId);
  const fullEditor = project?.capabilities?.editTasks === "any";

  const upload = useTaskAction(async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    setProgress(0);
    try {
      await api.post(`/tasks/${task.id}/attachments`, body, { onUploadProgress: (e) => setProgress(e.total ? Math.round((e.loaded / e.total) * 100) : null) });
    } finally {
      setProgress(null);
    }
  }, "Upload failed");
  const remove = useTaskAction((id: string) => api.delete(`/attachments/${id}`), "Could not remove the file");

  const send = (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (usage && file.size > usage.maxFileBytes) {
      toast.error(`Files can be at most ${formatBytes(usage.maxFileBytes)}`);
      return;
    }
    upload.mutate(file, { onSuccess: () => toast.success(`Uploaded ${file.name}`) });
  };

  const download = async (a: Attachment, view: boolean) => {
    try {
      const url = await fetchBlob(a);
      if (view) {
        window.open(url, "_blank", "noopener");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = a.fileName;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't download the file"));
    }
  };

  return (
    <Section
      title={`Files${task.attachments.length ? ` · ${task.attachments.length}` : ""}`}
      action={
        editable ? (
          <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} loading={upload.isPending} onClick={() => input.current?.click()}>
            Upload
          </Button>
        ) : undefined
      }
    >
      <input ref={input} type="file" className="hidden" aria-label="Choose a file to upload" accept={usage?.allowedExtensions.map((e) => `.${e}`).join(",")} onChange={(e) => (send(e.target.files), (e.target.value = ""))} />
      <div
        onDragOver={(e) => {
          if (!editable || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!editable) return;
          e.preventDefault();
          setDragging(false);
          send(e.dataTransfer.files);
        }}
        className={cx("rounded-lg", dragging && "ring-2 ring-accent ring-offset-2 ring-offset-surface")}
      >
        {task.attachments.length ? (
          <ul className="space-y-1">
            {task.attachments.map((a) => (
              <li key={a.id} className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-elev">
                {a.mimeType.startsWith("image/") ? <Paperclip className="size-4 text-muted" aria-hidden /> : <FileText className="size-4 text-muted" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{a.fileName}</span>
                  <span className="block text-xs text-muted">
                    {formatBytes(a.size)} · {displayName(a.uploadedBy)} · {timeAgo(a.createdAt)}
                  </span>
                </span>
                {INLINE.has(a.mimeType) && (
                  <IconButton label={`View ${a.fileName}`} onClick={() => download(a, true)}>
                    <Eye className="size-4" />
                  </IconButton>
                )}
                <IconButton label={`Download ${a.fileName}`} onClick={() => download(a, false)}>
                  <Download className="size-4" />
                </IconButton>
                {editable && (fullEditor || a.uploadedBy?.id === user?.id) && (
                  <IconButton label={`Remove ${a.fileName}`} onClick={() => remove.mutate(a.id)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-sm text-muted">{editable ? "No files yet. Drop one here or use Upload." : "No files."}</p>
        )}
        {progress !== null && <p className="mt-2 text-xs text-muted">Uploading… {progress}%</p>}
        {editable && usage && (
          <p className="mt-2 text-[11px] text-muted">
            Up to {formatBytes(usage.maxFileBytes)} per file ({usage.allowedExtensions.join(", ")}). Organization storage: {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)}.
          </p>
        )}
      </div>
    </Section>
  );
};

// ─── Approvals ───────────────────────────────────────────────────────────────

const STATE_STYLE: Record<ApprovalRequest["status"], string> = {
  PENDING: "bg-warning/12 text-warning",
  APPROVED: "bg-success/12 text-success",
  REJECTED: "bg-danger/12 text-danger",
  CANCELLED: "bg-elev text-muted",
};
const STATE_LABEL: Record<ApprovalRequest["status"], string> = { PENDING: "Waiting for approval", APPROVED: "Approved", REJECTED: "Changes requested", CANCELLED: "Cancelled" };

const RequestDialog = ({ task, open, onClose }: { task: TaskDetail; open: boolean; onClose: () => void }) => {
  const { user } = useAuth();
  const { data: members } = useOrgMembers();
  const [ids, setIds] = useState<number[]>([]);
  const [rule, setRule] = useState<"ANY" | "ALL">("ANY");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setIds([]);
      setRule("ANY");
      setNote("");
    }
  }, [open]);
  // Viewers can't approve and nobody approves their own request; project access is checked by the server
  const candidates = (members ?? []).filter((m) => m.userId !== user?.id && m.role !== "VIEWER");
  const send = useTaskAction(() => api.post(`/tasks/${task.id}/approvals`, { approverIds: ids, rule, note: note.trim() || null }), "Could not request approval");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Request approval"
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ids.length} loading={send.isPending} onClick={() => send.mutate(undefined, { onSuccess: () => (toast.success("Approval requested"), onClose()) })}>
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">The task moves to In review. When it's approved it's completed automatically; if changes are requested it goes back to In progress.</p>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-fg-soft">Approvers</legend>
          {members ? (
            <ul className="scroll-thin max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
              {candidates.map((m) => (
                <li key={m.userId}>
                  <label className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-elev">
                    <input type="checkbox" checked={ids.includes(m.userId)} onChange={(e) => setIds(e.target.checked ? [...ids, m.userId] : ids.filter((x) => x !== m.userId))} />
                    <Avatar user={{ id: m.userId, name: m.name, email: m.email }} size={18} />
                    <span className="min-w-0 flex-1 truncate">{displayName(m)}</span>
                    {m.role === "CLIENT" && <span className="text-[11px] text-muted">Client</span>}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Your role can't list members, so you can't pick approvers.</p>
          )}
        </fieldset>
        {ids.length > 1 && (
          <Field label="Needs">
            {(id) => (
              <select id={id} className={field} value={rule} onChange={(e) => setRule(e.target.value as "ANY" | "ALL")}>
                <option value="ANY">Any one approver</option>
                <option value="ALL">Every approver</option>
              </select>
            )}
          </Field>
        )}
        <Field label="Note (optional)">{(id) => <textarea id={id} rows={2} maxLength={2000} className={textarea} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
};

export const ApprovalSection = ({ task }: { task: TaskDetail }) => {
  const { user } = useAuth();
  const { data: project } = useProject(task.projectId);
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const current = task.approvals[0];
  const pending = current?.status === "PENDING" ? current : null;
  const myStep = pending?.steps.find((s) => s.approver.id === user?.id && s.decision === "PENDING");
  const decide = useTaskAction(
    (decision: "APPROVE" | "REJECT") => api.post(`/approvals/${pending!.id}/decision`, { decision, comment: comment.trim() || null }),
    "Could not record your decision"
  );
  const cancel = useTaskAction(() => api.post(`/approvals/${pending!.id}/cancel`), "Could not cancel the approval");
  const canRequest = task.permissions.edit && !task.archivedAt && task.status !== "DONE" && !pending;
  const canCancel = pending && (pending.requestedBy?.id === user?.id || project?.capabilities?.manage);

  if (!current && !canRequest && !task.approvalRequired) return null;

  return (
    <Section
      title="Approval"
      action={
        canRequest ? (
          <Button size="sm" variant="ghost" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setAsking(true)}>
            Request approval
          </Button>
        ) : undefined
      }
    >
      {task.approvalRequired && !pending && task.status !== "DONE" && <p className="mb-2 text-xs text-warning">This project requires an approval before a task can be completed.</p>}
      {current ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", STATE_STYLE[current.status])}>{STATE_LABEL[current.status]}</span>
            <span className="text-xs text-muted">
              {current.rule === "ALL" && current.steps.length > 1 ? "Every approver must approve" : "Any approver can approve"} · requested by {displayName(current.requestedBy)} {timeAgo(current.createdAt)}
            </span>
          </div>
          {current.note && <p className="rounded-md bg-elev px-3 py-2 text-sm text-fg-soft">{current.note}</p>}
          <ul className="space-y-1">
            {current.steps.map((s) => (
              <li key={s.approver.id} className="flex items-start gap-2 text-sm">
                <Avatar user={s.approver} size={20} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{displayName(s.approver)}</span>{" "}
                  <span className={cx("text-xs", s.decision === "APPROVED" ? "text-success" : s.decision === "REJECTED" ? "text-danger" : "text-muted")}>
                    {s.decision === "PENDING" ? "hasn't responded" : s.decision === "APPROVED" ? "approved" : "requested changes"}
                  </span>
                  {s.comment && <span className="block text-xs text-fg-soft">“{s.comment}”</span>}
                </span>
              </li>
            ))}
          </ul>
          {myStep && (
            <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="text-sm font-medium">Your decision</p>
              <textarea aria-label="Comment for the requester" rows={2} maxLength={2000} placeholder="Comment (optional)" className={textarea} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" icon={<CheckCircle2 className="size-3.5" />} loading={decide.isPending} onClick={() => decide.mutate("APPROVE", { onSuccess: () => (setComment(""), toast.success("Approved")) })}>
                  Approve
                </Button>
                <Button variant="danger" size="sm" icon={<XCircle className="size-3.5" />} loading={decide.isPending} onClick={() => decide.mutate("REJECT", { onSuccess: () => (setComment(""), toast.success("Changes requested")) })}>
                  Request changes
                </Button>
              </div>
            </div>
          )}
          {canCancel && (
            <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: () => toast.success("Approval cancelled") })}>
              Cancel request
            </Button>
          )}
          {current.status === "APPROVED" && task.status !== "DONE" && task.isBlocked && <p className="text-xs text-muted">Approved, but it's still blocked by unfinished tasks, so it wasn't completed yet.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">No approval requested.</p>
      )}
      <RequestDialog task={task} open={asking} onClose={() => setAsking(false)} />
    </Section>
  );
};
