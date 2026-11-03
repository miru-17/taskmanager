import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../services/api";
import { useNotificationAction, useNotificationPrefs } from "../../data/queries";
import { NOTIFICATION_LABELS, type NotificationType } from "../../types/Task";
import PageShell, { Card } from "../../components/PageShell";
import { Button, Spinner } from "../../ui";

const ORDER: NotificationType[] = ["MENTIONED", "ASSIGNED", "APPROVAL_REQUESTED", "APPROVAL_DECIDED", "DUE_SOON", "COMMENTED", "STATUS_CHANGED"];

/** In-app notifications are always on; this chooses which ones also arrive by email. */
const NotificationSettings = () => {
  const { data, isPending } = useNotificationPrefs();
  const [types, setTypes] = useState<NotificationType[]>([]);
  useEffect(() => data && setTypes(data.emailTypes), [data]);
  const save = useNotificationAction(() => api.put("/notifications/preferences", { emailTypes: types }));
  const dirty = data && [...types].sort().join() !== [...data.emailTypes].sort().join();

  return (
    <PageShell title="Notifications" subtitle="Everything shows up in the bell. Choose what also comes by email.">
      <Card title="Email me when…">
        {isPending ? (
          <Spinner />
        ) : (
          <>
            {data && !data.emailConfigured && (
              <p className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">Email isn't set up on this server yet, so these settings are saved but no emails go out.</p>
            )}
            <ul className="space-y-2">
              {ORDER.map((t) => (
                <li key={t}>
                  <label className="flex items-center gap-3 text-sm">
                    <input type="checkbox" className="size-4" checked={types.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))} />
                    {NOTIFICATION_LABELS[t]}
                  </label>
                </li>
              ))}
            </ul>
            <Button className="mt-5" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => toast.success("Preferences saved") })}>
              Save
            </Button>
          </>
        )}
      </Card>
    </PageShell>
  );
};

export default NotificationSettings;
