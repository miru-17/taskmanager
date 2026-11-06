import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import api from "../../services/api";
import { useOrgKey } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { Card, inputClass, primaryButton, secondaryButton } from "../../components/PageShell";
import { useBranding, useLogoUrl, type Branding } from "./branding";

/** Logo and brand colour. The server enforces the plan, the image type and colour contrast; this explains them. */
export const BrandingCard = ({ canEdit }: { canEdit: boolean }) => {
  const { data } = useBranding();
  const logo = useLogoUrl();
  const org = useOrgKey();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; plan: boolean } | null>(null);
  if (!data) return null;
  const value = color ?? data.brandColor ?? "#4f46e5";
  const save = async (fn: () => Promise<{ data: Branding }>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(["org", org, "branding"], (await fn()).data);
      setColor(null);
      toast.success(ok);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
      setError({ message: getErrorMessage(err, "Couldn't save the branding"), plan: code === "PLAN_LIMIT" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Branding">
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-4">
          {logo ? <img src={logo} alt={`${data.name} logo`} className="size-12 rounded-lg border border-line object-contain" /> : <span className="flex size-12 items-center justify-center rounded-lg bg-accent text-lg font-bold text-accent-fg" aria-hidden>{data.name.slice(0, 1).toUpperCase()}</span>}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="Logo image"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const form = new FormData();
                  form.append("file", f);
                  void save(() => api.put<Branding>("/orgs/current/branding/logo", form), "Logo updated");
                }}
              />
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => file.current?.click()}>
                {data.hasLogo ? "Replace logo" : "Upload logo"}
              </button>
              {data.hasLogo && (
                <button type="button" className={secondaryButton} disabled={busy} onClick={() => save(() => api.delete<Branding>("/orgs/current/branding/logo"), "Logo removed")}>
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted">PNG, JPEG or WebP, up to 512 KB. Square images look best.</p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              Brand colour
              <input type="color" aria-label="Brand colour" value={value} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent" />
            </label>
            <input aria-label="Brand colour hex" className={`${inputClass} w-28 font-mono`} value={value} maxLength={7} onChange={(e) => setColor(e.target.value)} />
            <button type="button" className={primaryButton} disabled={busy || value === data.brandColor} onClick={() => save(() => api.patch<Branding>("/orgs/current/branding", { brandColor: value }), "Brand colour saved")}>
              Save colour
            </button>
            {data.brandColor && (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => save(() => api.patch<Branding>("/orgs/current/branding", { brandColor: null }), "Back to the default colour")}>
                Use default
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="text-danger" role="alert">
            {error.message} {error.plan && <Link to="/settings/billing" className="underline">See plans</Link>}
          </p>
        )}
      </div>
    </Card>
  );
};
