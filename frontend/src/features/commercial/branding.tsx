import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../services/api";
import { useOrgKey } from "../../data/queries";
import { useAuth } from "../../context/AuthContext";

export interface Branding {
  name: string;
  brandColor: string | null;
  hasLogo: boolean;
  version: number;
}

export const useBranding = () => {
  const org = useOrgKey();
  const { organization } = useAuth();
  return useQuery({ queryKey: ["org", org, "branding"], queryFn: async () => (await api.get<Branding>("/orgs/current/branding")).data, enabled: Boolean(organization), staleTime: 5 * 60_000 });
};

/** Applies the brand colour to the whole app (and removes it when switching to an unbranded org). */
export const BrandingApplier = () => {
  const { data } = useBranding();
  useEffect(() => {
    const root = document.documentElement;
    if (data?.brandColor) {
      root.style.setProperty("--brand", data.brandColor);
      root.setAttribute("data-brand", "");
    } else {
      root.style.removeProperty("--brand");
      root.removeAttribute("data-brand");
    }
  }, [data?.brandColor]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("--brand");
      document.documentElement.removeAttribute("data-brand");
    },
    []
  );
  return null;
};

/** The logo needs the access token, so it's fetched as a blob rather than linked directly. */
export const useLogoUrl = () => {
  const { data } = useBranding();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.hasLogo) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let made: string | null = null;
    api
      .get<Blob>("/orgs/current/branding/logo", { responseType: "blob", params: { v: data.version } })
      .then((r) => {
        if (revoked) return;
        made = URL.createObjectURL(r.data);
        setUrl(made);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [data?.hasLogo, data?.version]);
  return url;
};
