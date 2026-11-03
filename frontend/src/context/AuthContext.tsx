import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import api, { CSRF_HEADERS, refreshSession, tokenStore } from "../services/api";
import type { AuthPayload, AuthUser, OrgSummary, Permission } from "../types/auth";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextType {
  status: Status;
  isAuthenticated: boolean;
  user: AuthUser | null;
  organization: OrgSummary | null;
  organizations: OrgSummary[];
  permissions: Permission[];
  can: (permission: Permission) => boolean;
  /** Store the result of login / refresh / switch / accept-invite. */
  applySession: (payload: AuthPayload) => void;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<AuthPayload | null>(null);

  const queryClient = useQueryClient();

  // Keep React state in sync with the token store (the API layer refreshes tokens on its own)
  useEffect(
    () =>
      tokenStore.subscribe((payload) => {
        // Signed out: drop every cached response so the next person on this browser sees nothing of it
        if (!payload) queryClient.clear();
        setSession(payload);
        setStatus(payload ? "authenticated" : "anonymous");
      }),
    [queryClient]
  );

  // On first load: drop anything older versions kept in localStorage, then restore from the cookie
  useEffect(() => {
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch {
      /* storage unavailable */
    }
    let cancelled = false;
    refreshSession().then((payload) => {
      if (!cancelled && !payload) setStatus("anonymous");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => toast.error("Your session has ended. Please sign in again.", { id: "session-expired" });
    window.addEventListener("session-expired", onExpired);
    return () => window.removeEventListener("session-expired", onExpired);
  }, []);

  const applySession = useCallback((payload: AuthPayload) => tokenStore.set(payload), []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", {}, { headers: CSRF_HEADERS });
    } catch {
      /* already signed out server-side */
    }
    tokenStore.set(null);
  }, []);

  const switchOrganization = useCallback(async (organizationId: string) => {
    const res = await api.post<AuthPayload>("/auth/switch-organization", { organizationId });
    tokenStore.set(res.data);
  }, []);

  const reload = useCallback(async () => {
    const res = await api.get<AuthPayload>("/auth/me");
    tokenStore.set(res.data);
  }, []);

  const value = useMemo<AuthContextType>(() => {
    const permissions = session?.permissions ?? [];
    return {
      status,
      isAuthenticated: status === "authenticated",
      user: session?.user ?? null,
      organization: session?.organization ?? null,
      organizations: session?.organizations ?? [],
      permissions,
      can: (p) => permissions.includes(p),
      applySession,
      logout,
      switchOrganization,
      reload,
    };
  }, [status, session, applySession, logout, switchOrganization, reload]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
