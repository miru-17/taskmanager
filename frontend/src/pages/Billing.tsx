import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, Check, ExternalLink } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useOrgKey } from "../data/queries";
import { getErrorMessage } from "../data/errors";
import PageShell, { Card, primaryButton, secondaryButton } from "../components/PageShell";
import { Spinner, ErrorState } from "../ui";
import { cx } from "../ui/cx";

type PlanId = "FREE" | "PRO" | "BUSINESS";
interface Limits {
  members: number | null;
  clients: number | null;
  projects: number | null;
  storageMb: number;
  automations: number | null;
  aiRequestsPerMonth: number | null;
  branding: boolean;
}
export interface BillingSummary {
  plan: PlanId;
  paidPlan: PlanId;
  limits: Limits;
  usage: { members: number; clients: number; pendingMembers: number; pendingClients: number; projects: number; storageBytes: number; automations: number; aiThisMonth: number };
  trial: { active: boolean; endsAt: string | null; available: boolean; days: number; plan: PlanId };
  subscription: { status: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  billing: { configured: boolean; testMode: boolean; purchasable: PlanId[] };
  plans: Record<PlanId, { name: string; priceNote: string; limits: Limits }>;
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const fmtLimit = (n: number | null) => (n === null ? "Unlimited" : n.toLocaleString());

/** One usage row: a bar that turns amber near the limit and red at it, always with the numbers in text. */
const Meter = ({ label, used, max, note, unit = "" }: { label: string; used: number; max: number | null; note?: string; unit?: string }) => {
  const pct = max ? Math.min(100, (used / max) * 100) : 0;
  const tone = max === null ? "bg-accent" : pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-accent";
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-fg-soft">
          {used.toLocaleString()}
          {unit} {max === null ? "· unlimited" : `of ${max.toLocaleString()}${unit}`}
        </span>
      </div>
      {max !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elev" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={max}>
          <div className={cx("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
        </div>
      )}
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </li>
  );
};

const FEATURES = (l: Limits) => [
  `${fmtLimit(l.members)} team members`,
  `${fmtLimit(l.clients)} clients`,
  `${fmtLimit(l.projects)} active projects`,
  `${l.storageMb >= 1024 ? `${l.storageMb / 1024} GB` : `${l.storageMb} MB`} file storage`,
  `${fmtLimit(l.automations)} active automations`,
  `${fmtLimit(l.aiRequestsPerMonth)} AI requests a month`,
  l.branding ? "Your logo and brand colour" : "TaskForge branding",
];

const Billing = () => {
  const org = useOrgKey();
  const qc = useQueryClient();
  const { can } = useAuth();
  const admin = can("billing:manage");
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const { data: b, isPending, isError, error, refetch } = useQuery({ queryKey: ["org", org, "billing"], queryFn: async () => (await api.get<BillingSummary>("/billing")).data });

  // Back from Stripe Checkout: the plan changes when Stripe's webhook arrives, which can take a few seconds
  const checkout = params.get("checkout");
  useEffect(() => {
    if (checkout === "success") {
      toast.success("Payment received. Your plan updates as soon as Stripe confirms it.");
      const t = setInterval(() => refetch(), 3000);
      const stop = setTimeout(() => clearInterval(t), 30_000);
      return () => (clearInterval(t), clearTimeout(stop));
    }
    if (checkout === "cancelled") toast("Checkout cancelled. Nothing was charged.");
  }, [checkout, refetch]);

  const act = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't work"));
    } finally {
      setBusy(null);
    }
  };
  const redirect = (path: string, body?: object) => act(path, async () => {
    const { url } = (await api.post<{ url: string }>(path, body)).data;
    window.location.assign(url);
  });

  if (isPending) return <PageShell title="Plan and billing"><Spinner label="Loading…" /></PageShell>;
  if (isError) return <PageShell title="Plan and billing"><ErrorState message={getErrorMessage(error, "Couldn't load billing")} onRetry={() => refetch()} /></PageShell>;

  const u = b.usage;
  const plan = b.plans[b.plan];
  const sub = b.subscription;
  return (
    <PageShell title="Plan and billing" subtitle={admin ? "Limits are applied by the server; this page shows where you stand." : "Only organization admins can change the plan."}>
      <Card title={`Current plan: ${plan.name}${b.trial.active ? " (trial)" : ""}`}>
        <div className="space-y-2 text-sm">
          {b.trial.active && <p className="text-fg-soft">Your {b.trial.days}-day {b.plans[b.trial.plan].name} trial ends on {fmtDate(b.trial.endsAt)}. Afterwards you'll be back on {b.plans[b.paidPlan].name} limits; nothing is deleted, but you won't be able to add more than they allow.</p>}
          {sub?.status === "past_due" && (
            <p className="flex items-center gap-2 text-warning" role="status">
              <AlertTriangle className="size-4" aria-hidden /> Stripe couldn't take the last payment. Your plan stays active while Stripe retries; update the card in the billing portal.
            </p>
          )}
          {sub?.cancelAtPeriodEnd && <p className="text-fg-soft">Your subscription ends on {fmtDate(sub.currentPeriodEnd)}, then you move to Free.</p>}
          {sub && !sub.cancelAtPeriodEnd && sub.status === "active" && <p className="text-fg-soft">Renews on {fmtDate(sub.currentPeriodEnd)}.</p>}
          {admin && b.trial.available && (
            <button type="button" className={primaryButton} disabled={busy === "trial"} onClick={() => act("trial", async () => {
              qc.setQueryData(["org", org, "billing"], (await api.post<BillingSummary>("/billing/trial")).data);
              await qc.invalidateQueries({ queryKey: ["org", org, "branding"] });
              toast.success(`${b.plans[b.trial.plan].name} trial started`);
            })}>
              Start the free {b.trial.days}-day {b.plans[b.trial.plan].name} trial
            </button>
          )}
          {admin && b.billing.configured && sub && (
            <button type="button" className={cx(secondaryButton, "inline-flex items-center gap-1.5")} disabled={busy === "/billing/portal"} onClick={() => redirect("/billing/portal")}>
              Manage billing <ExternalLink className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </Card>

      <Card title="Usage">
        <ul className="space-y-3" aria-label="Usage against your plan">
          <Meter label="Team members" used={u.members + u.pendingMembers} max={b.limits.members} note={u.pendingMembers ? `Includes ${u.pendingMembers} pending invitation${u.pendingMembers === 1 ? "" : "s"}` : undefined} />
          <Meter label="Clients" used={u.clients + u.pendingClients} max={b.limits.clients} note={u.pendingClients ? `Includes ${u.pendingClients} pending invitation${u.pendingClients === 1 ? "" : "s"}` : undefined} />
          <Meter label="Active projects" used={u.projects} max={b.limits.projects} note="Archived projects don't count." />
          <Meter label="File storage" used={Math.round((u.storageBytes / 1024 / 1024) * 10) / 10} max={b.limits.storageMb} unit=" MB" />
          <Meter label="Active automations" used={u.automations} max={b.limits.automations} />
          <Meter label="AI requests this month" used={u.aiThisMonth} max={b.limits.aiRequestsPerMonth} note="Past the limit, AI features keep working with built-in rules until next month." />
        </ul>
      </Card>

      <Card title="Plans">
        {!b.billing.configured && <p className="mb-3 text-sm text-muted">Online payment isn't set up on this server. {admin ? "Ask whoever runs it to change your plan, or start the trial." : ""}</p>}
        {b.billing.configured && <p className="mb-3 text-xs text-muted">Payments run in Stripe test mode: use card 4242 4242 4242 4242. No real money is charged.</p>}
        <ul className="grid gap-3 md:grid-cols-3" aria-label="Plans">
          {(Object.keys(b.plans) as PlanId[]).map((id) => {
            const p = b.plans[id];
            const current = id === b.paidPlan;
            const buyable = admin && b.billing.purchasable.includes(id) && !current && !sub;
            return (
              <li key={id} className={cx("flex flex-col rounded-xl border p-4", current ? "border-accent" : "border-line")}>
                <p className="font-semibold">
                  {p.name} {current && <span className="ml-1 rounded bg-accent/12 px-1.5 py-0.5 text-[11px] text-accent">Current</span>}
                </p>
                <p className="text-xs text-muted">{p.priceNote}</p>
                <ul className="mt-3 flex-1 space-y-1 text-sm">
                  {FEATURES(p.limits).map((f) => (
                    <li key={f} className="flex gap-1.5">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
                {buyable && (
                  <button type="button" className={cx(primaryButton, "mt-4")} disabled={busy === "/billing/checkout"} onClick={() => redirect("/billing/checkout", { plan: id })}>
                    Choose {p.name}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </PageShell>
  );
};

export default Billing;
