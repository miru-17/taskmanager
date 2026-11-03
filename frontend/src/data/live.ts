import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { API_URL, refreshSession, tokenStore } from "../services/api";
import { useAuth } from "../context/AuthContext";

export type LiveState = "connecting" | "live" | "offline";

interface LiveEvent {
  type: string;
  projectId?: string;
  taskIds?: number[];
  actorId?: number | null;
}

/** Parses "event: x\ndata: {...}\n\n" blocks out of a growing text buffer. */
export const parseSse = (buffer: string): { events: { event: string; data: string }[]; rest: string } => {
  const events: { event: string; data: string }[] = [];
  let rest = buffer;
  let i;
  while ((i = rest.indexOf("\n\n")) >= 0) {
    const block = rest.slice(0, i);
    rest = rest.slice(i + 2);
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
};

/**
 * Keeps one live connection per signed-in tab. Events are only "something changed" signals;
 * the hook invalidates the matching queries and React Query refetches through the normal,
 * permission-checked API. Reconnects with backoff; a missed window is covered by refetching
 * everything after a reconnect.
 */
export const useLiveUpdates = (): LiveState => {
  const qc = useQueryClient();
  const { organization, user } = useAuth();
  const [state, setState] = useState<LiveState>("connecting");
  const me = useRef(user?.id);
  me.current = user?.id;

  useEffect(() => {
    if (!organization || import.meta.env.MODE === "test") return;
    const org = organization.id;
    let cancelled = false;
    let ctrl: AbortController | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const handle = (name: string, e: LiveEvent) => {
      if (name === "notification.created") {
        qc.invalidateQueries({ queryKey: ["org", org, "notifications"] });
        toast("New notification", { id: "live-notification", icon: "🔔" });
        return;
      }
      if (name === "comment.changed") {
        for (const id of e.taskIds ?? []) qc.invalidateQueries({ queryKey: ["org", org, "tasks", "comments", id] });
      }
      // Our own writes already refreshed what they touched
      if (e.actorId && e.actorId === me.current) return;
      if (name === "task.changed" || name === "comment.changed" || name === "project.changed") {
        qc.invalidateQueries({ queryKey: ["org", org, "tasks"] });
        qc.invalidateQueries({ queryKey: ["org", org, "projects"] });
      }
    };

    const connect = async () => {
      if (cancelled) return;
      ctrl = new AbortController();
      let token = tokenStore.get();
      try {
        let res = await fetch(`${API_URL}/events`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" }, signal: ctrl.signal });
        if (res.status === 401 && (await refreshSession())) {
          token = tokenStore.get();
          res = await fetch(`${API_URL}/events`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" }, signal: ctrl.signal });
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        setState("live");
        if (attempt > 0) {
          // We may have missed events while disconnected
          qc.invalidateQueries({ queryKey: ["org", org] });
        }
        attempt = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let tokenExpired = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const parsed = parseSse(buffer + decoder.decode(value, { stream: true }));
          buffer = parsed.rest;
          for (const ev of parsed.events) {
            try {
              const data = JSON.parse(ev.data) as LiveEvent & { reason?: string };
              if (ev.event === "stream.closed") tokenExpired = data.reason === "token_expired";
              else if (ev.event !== "ready") handle(ev.event, data);
            } catch {
              /* ignore malformed */
            }
          }
        }
        // Server closed the stream: refresh the token if that's why, then reconnect
        if (tokenExpired) await refreshSession();
        if (!cancelled) timer = setTimeout(connect, 250);
      } catch {
        if (cancelled) return;
        setState("offline");
        const delay = Math.min(30_000, 1000 * 2 ** attempt++) + Math.random() * 500;
        timer = setTimeout(connect, delay);
      }
    };

    setState("connecting");
    void connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl?.abort();
    };
  }, [organization, qc]);

  return state;
};
