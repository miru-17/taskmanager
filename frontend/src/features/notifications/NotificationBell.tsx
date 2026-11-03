import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Settings } from "lucide-react";
import api from "../../services/api";
import { useNotificationAction, useNotifications, useUnreadCount } from "../../data/queries";
import { timeAgo } from "../../data/dates";
import type { AppNotification } from "../../types/Task";
import { describeNotification } from "./describe";
import { Avatar, Button, IconButton } from "../../ui";
import { cx } from "../../ui/cx";

const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: unread } = useUnreadCount();
  const { data, isPending } = useNotifications(open);
  const readOne = useNotificationAction((id: string) => api.post("/notifications/read", { ids: [id] }));
  const readAll = useNotificationAction(() => api.post("/notifications/read-all"));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (n: AppNotification) => {
    if (!n.readAt) readOne.mutate(n.id);
    setOpen(false);
    if (n.taskId) navigate(`/projects/${n.data.projectId}/board?task=${n.taskId}`);
  };

  return (
    <div className="relative" ref={panel}>
      <IconButton label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Bell className="size-4" />
        {!!unread && (
          <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white" aria-hidden>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </IconButton>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute top-full left-0 z-50 mt-1 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <span className="ml-auto flex items-center">
              {!!unread && (
                <Button size="sm" variant="ghost" icon={<CheckCheck className="size-3.5" />} onClick={() => readAll.mutate(undefined)}>
                  Mark all read
                </Button>
              )}
              <IconButton
                label="Notification settings"
                onClick={() => {
                  setOpen(false);
                  navigate("/settings/notifications");
                }}
              >
                <Settings className="size-4" />
              </IconButton>
            </span>
          </div>
          <div className="scroll-thin max-h-[26rem] overflow-y-auto">
            {isPending ? (
              <p className="px-4 py-6 text-sm text-muted">Loading…</p>
            ) : !data?.items.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.items.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => go(n)} className={cx("flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-elev", !n.readAt && "bg-accent/5")}>
                      <Avatar user={n.actor} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">
                          <span className="font-medium">{describeNotification(n)}</span>
                        </span>
                        <span className="block truncate text-xs text-fg-soft">
                          {n.data.key} · {n.data.title}
                        </span>
                        {n.data.excerpt && <span className="mt-0.5 block truncate text-xs text-muted">“{n.data.excerpt}”</span>}
                        <span className="block text-[11px] text-muted">
                          {n.data.projectName} · {timeAgo(n.createdAt)}
                        </span>
                      </span>
                      {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
