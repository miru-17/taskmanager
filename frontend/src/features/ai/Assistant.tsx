import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send, Sparkles, Trash2, X } from "lucide-react";
import { getErrorMessage } from "../../data/errors";
import { Button, Drawer, IconButton, fieldBase } from "../../ui";
import { cx } from "../../ui/cx";
import { useTaskParam } from "../tasks/composer";
import { aiPost, useAiStatus, type AssistantReply } from "./ai";
import { SourceBadge } from "./SourceBadge";

type Msg = { role: "user" | "assistant"; content: string; reply?: AssistantReply; error?: boolean };

const SUGGESTIONS = ["What should I work on next?", "What's overdue?", "What's due this week?", "What's blocked?", "Who is overloaded?"];

/**
 * Ask about your work. Answers come only from tasks you can see, and the assistant can't change
 * anything. The conversation lives in this tab only; nothing is stored.
 */
const AssistantPanel = ({ onClose }: { onClose: () => void }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: status } = useAiStatus(true);
  const { openTask } = useTaskParam();
  const end = useRef<HTMLDivElement>(null);
  // The latest answer is the most reliable signal of what's in use right now
  const lastReply = [...msgs].reverse().find((m) => m.reply)?.reply;
  const mode = lastReply?.source ?? status?.mode;
  const modeLabel = mode === "ai" ? `AI · ${status?.model ?? "model"}` : mode === "rules" ? "Offline mode: built-in answers" : "";
  // Braces matter: newer Chromium returns a Promise from scrollIntoView, which React would treat as a cleanup
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [msgs]);

  const ask = async (q: string) => {
    const message = q.trim();
    if (!message || busy) return;
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setText("");
    setBusy(true);
    try {
      const reply = await aiPost<AssistantReply>("/assistant", { message, history: history.slice(-10) });
      setMsgs((m) => [...m, { role: "assistant", content: reply.answer, reply }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: "assistant", content: getErrorMessage(err, "Something went wrong. Try again."), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <Sparkles className="size-4 text-accent" aria-hidden />
        <h2 className="font-semibold">Assistant</h2>
        <span className="text-xs text-muted">{modeLabel}</span>
        <span className="ml-auto flex">
          {msgs.length > 0 && (
            <IconButton label="Clear conversation" onClick={() => setMsgs([])}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
          <IconButton label="Close assistant" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </span>
      </header>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {!msgs.length && (
          <div className="space-y-3 text-sm text-muted">
            <p>Ask about your tasks and projects. Answers only use tasks you can see, and the assistant never changes anything.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-soft hover:border-accent hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cx("flex", m.role === "user" && "justify-end")}>
            <div className={cx("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.role === "user" ? "bg-accent text-accent-fg" : m.error ? "bg-danger/10 text-danger" : "bg-elev text-fg")}>
              <p className="whitespace-pre-line break-words">{m.content}</p>
              {m.reply && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <SourceBadge r={m.reply} />
                  {m.reply.references.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      title={r.title}
                      onClick={() => (onClose(), openTask(r.id))}
                      className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs hover:border-accent hover:text-accent"
                    >
                      {r.key}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-muted">Thinking…</p>}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t border-line px-5 py-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <input data-autofocus aria-label="Ask the assistant" className={`${fieldBase} min-w-0 flex-1`} maxLength={1000} placeholder="Ask about your work…" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="primary" icon={<Send className="size-4" />} disabled={!text.trim()} loading={busy}>
          Ask
        </Button>
      </form>
    </>
  );
};

export const AssistantButton = ({ className }: { className: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Sparkles className="size-4" aria-hidden /> Assistant
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} label="Assistant">
        <AssistantPanel onClose={() => setOpen(false)} />
      </Drawer>
    </>
  );
};
