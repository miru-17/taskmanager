import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Pencil, Reply, SmilePlus, Trash2 } from "lucide-react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { commentKeys, useComments, useProject } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { timeAgo } from "../../data/dates";
import { REACTIONS, displayName, type Comment, type CommentThread, type Reaction, type TaskDetail } from "../../types/Task";
import { Avatar, Button, ConfirmDialog, IconButton, textarea } from "../../ui";
import { cx } from "../../ui/cx";
import { useAssignable } from "../tasks/useAssignable";
import RichText from "./RichText";
import { activeQuery, decodeMentions, encodeMentions, type Mention } from "./mentions";

// ─── Composer with @mention picker ───────────────────────────────────────────

const MentionInput = ({
  projectId,
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  projectId: string;
  initial?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<unknown>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) => {
  const seeded = useMemo(() => decodeMentions(initial ?? ""), [initial]);
  const [text, setText] = useState(seeded.text);
  const [mentions, setMentions] = useState<Mention[]>(seeded.mentions);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();
  const people = useAssignable(projectId).filter((p) => p.id !== user?.id);

  const matches = query
    ? people.filter((p) => displayName(p).toLowerCase().includes(query.query.toLowerCase()) || p.email.toLowerCase().startsWith(query.query.toLowerCase())).slice(0, 6)
    : [];

  const pick = (p: { id: number; name: string | null; email: string }) => {
    if (!query) return;
    const name = displayName(p);
    const caret = ref.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, query.start)}@${name} ${text.slice(caret)}`;
    setText(next);
    if (!mentions.some((m) => m.id === p.id)) setMentions([...mentions, { id: p.id, name }]);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + name.length + 2;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(encodeMentions(text.trim(), mentions));
      setText("");
      setMentions([]);
    } catch {
      /* the caller shows the error */
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === "ArrowDown") return (e.preventDefault(), setActive((a) => (a + 1) % matches.length));
      if (e.key === "ArrowUp") return (e.preventDefault(), setActive((a) => (a - 1 + matches.length) % matches.length));
      if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), pick(matches[active]));
      if (e.key === "Escape") return (e.preventDefault(), e.stopPropagation(), setQuery(null));
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        aria-label={placeholder}
        autoFocus={autoFocus}
        rows={2}
        maxLength={10_000}
        placeholder={placeholder}
        className={cx(textarea, "min-h-16")}
        value={text}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setText(e.target.value);
          setQuery(activeQuery(e.target.value, e.target.selectionStart));
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {matches.length > 0 && (
        <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full z-20 mb-1 w-64 overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === active ? "bg-elev" : "hover:bg-elev")}
              >
                <Avatar user={p} size={18} />
                <span className="truncate">{displayName(p)}</span>
                <span className="ml-auto truncate text-xs text-muted">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[11px] text-muted">@ to mention · **bold** · `code` · Ctrl+Enter to send</span>
        <span className="ml-auto flex gap-1.5">
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={!text.trim()} loading={busy} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </span>
      </div>
    </div>
  );
};

// ─── One comment ─────────────────────────────────────────────────────────────

const CommentItem = ({
  c,
  task,
  canWrite,
  canModerate,
  onReply,
  refresh,
}: {
  c: Comment;
  task: TaskDetail;
  canWrite: boolean;
  canModerate: boolean;
  onReply?: () => void;
  refresh: () => Promise<unknown>;
}) => {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const mine = c.author?.id === user?.id;

  const call = async (fn: () => Promise<unknown>, fallback: string) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      toast.error(getErrorMessage(err, fallback));
      throw err;
    }
  };
  const react = (emoji: Reaction) => call(() => api.post(`/comments/${c.id}/reactions`, { emoji }), "Couldn't add the reaction").catch(() => {});

  if (c.deleted) return <p className="py-1 text-sm italic text-muted">This comment was deleted.</p>;

  return (
    <div className="group flex gap-2.5">
      <Avatar user={c.author} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{displayName(c.author)}</span>
          <time className="text-xs text-muted" dateTime={c.createdAt} title={new Date(c.createdAt).toLocaleString()}>
            {timeAgo(c.createdAt)}
          </time>
          {c.editedAt && <span className="text-xs text-muted">(edited)</span>}
          <span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {canWrite && (
              <IconButton label="Add reaction" className="size-7" onClick={() => setPicking((p) => !p)}>
                <SmilePlus className="size-3.5" />
              </IconButton>
            )}
            {canWrite && onReply && (
              <IconButton label="Reply" className="size-7" onClick={onReply}>
                <Reply className="size-3.5" />
              </IconButton>
            )}
            {mine && canWrite && (
              <IconButton label="Edit comment" className="size-7" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </IconButton>
            )}
            {(mine || canModerate) && (
              <IconButton label="Delete comment" className="size-7" onClick={() => setConfirm(true)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            )}
          </span>
        </div>
        {editing ? (
          <div className="mt-1">
            <MentionInput
              projectId={task.projectId}
              initial={c.body}
              placeholder="Edit comment"
              submitLabel="Save"
              autoFocus
              onCancel={() => setEditing(false)}
              onSubmit={(body) => call(() => api.patch(`/comments/${c.id}`, { body }), "Couldn't save the comment").then(() => setEditing(false))}
            />
          </div>
        ) : (
          <RichText text={c.body} meId={user?.id} />
        )}
        {picking && (
          <div role="group" aria-label="Reactions" className="mt-1 inline-flex gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-card">
            {REACTIONS.map((r) => (
              <button key={r} type="button" aria-label={`React with ${r}`} className="rounded px-1.5 py-0.5 hover:bg-elev" onClick={() => (react(r), setPicking(false))}>
                {r}
              </button>
            ))}
          </div>
        )}
        {c.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {c.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                aria-pressed={r.mine}
                aria-label={`${r.emoji} ${r.count}`}
                disabled={!canWrite}
                onClick={() => react(r.emoji)}
                className={cx("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-xs", r.mine ? "border-accent bg-accent/10" : "border-line hover:bg-elev")}
              >
                {r.emoji} <span className="tabular-nums text-fg-soft">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title="Delete this comment?"
        message={mine ? "It's removed for everyone." : "You're removing someone else's comment as a project manager. This is recorded in the audit log."}
        onClose={() => setConfirm(false)}
        onConfirm={() => call(() => api.delete(`/comments/${c.id}`), "Couldn't delete the comment").then(() => setConfirm(false)).catch(() => {})}
      />
    </div>
  );
};

// ─── Section ─────────────────────────────────────────────────────────────────

const CommentsSection = ({ task }: { task: TaskDetail }) => {
  const qc = useQueryClient();
  const { organization } = useAuth();
  const { data, isPending } = useComments(task.id);
  const { data: project } = useProject(task.projectId);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const key = commentKeys.task(organization?.id ?? "none", task.id);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  // Org viewers are read-only; archived work can't be discussed further
  const canWrite = organization?.role !== "VIEWER" && !task.archivedAt && project?.status !== "ARCHIVED";
  const canModerate = Boolean(project?.capabilities?.manage);
  const post = async (body: string, parentId?: string) => {
    try {
      await api.post(`/tasks/${task.id}/comments`, { body, parentId });
      await refresh();
      if (parentId) setReplyTo(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't post the comment"));
      throw err;
    }
  };
  const count = (data ?? []).reduce((n, t: CommentThread) => n + (t.deleted ? 0 : 1) + t.replies.length, 0);

  return (
    <section className="border-t border-line px-6 py-4" aria-label="Comments">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Comments{count ? ` · ${count}` : ""}</h3>
      {isPending ? (
        <p className="text-sm text-muted">Loading comments…</p>
      ) : (
        <ol className="space-y-4">
          {data?.map((t) => (
            <li key={t.id} className="space-y-3">
              <CommentItem c={t} task={task} canWrite={canWrite} canModerate={canModerate} onReply={() => setReplyTo(t.id)} refresh={refresh} />
              {(t.replies.length > 0 || replyTo === t.id) && (
                <ol className="ml-9 space-y-3 border-l border-line pl-3">
                  {t.replies.map((r) => (
                    <li key={r.id}>
                      <CommentItem c={r} task={task} canWrite={canWrite} canModerate={canModerate} onReply={() => setReplyTo(t.id)} refresh={refresh} />
                    </li>
                  ))}
                  {replyTo === t.id && (
                    <li>
                      <MentionInput projectId={task.projectId} placeholder="Write a reply" submitLabel="Reply" autoFocus onCancel={() => setReplyTo(null)} onSubmit={(b) => post(b, t.id)} />
                    </li>
                  )}
                </ol>
              )}
            </li>
          ))}
          {!data?.length && <li className="text-sm text-muted">No comments yet.</li>}
        </ol>
      )}
      {canWrite ? (
        <div className="mt-4">
          <MentionInput projectId={task.projectId} placeholder="Write a comment" submitLabel="Comment" onSubmit={(b) => post(b)} />
        </div>
      ) : (
        organization?.role === "VIEWER" && <p className="mt-3 text-xs text-muted">Viewers can read comments but not write them.</p>
      )}
    </section>
  );
};

export default CommentsSection;
