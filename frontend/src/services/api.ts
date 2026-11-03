import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import type { AuthPayload } from "../types/auth";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Sent on cookie-authenticated requests; the server rejects them without it (CSRF guard). */
export const CSRF_HEADERS = { "X-TaskForge-CSRF": "1" };

/**
 * The access token lives only in memory — never in localStorage — so an XSS bug
 * can't lift a long-lived credential. A reload restores it via the httpOnly
 * refresh cookie (see refreshSession).
 */
let accessToken: string | null = null;
type Listener = (payload: AuthPayload | null) => void;
const listeners = new Set<Listener>();

export const tokenStore = {
  get: () => accessToken,
  set: (payload: AuthPayload | null) => {
    accessToken = payload?.accessToken ?? null;
    listeners.forEach((l) => l(payload));
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

const api = axios.create({
  baseURL: API_URL,
  timeout: 15_000,
  withCredentials: true, // send the refresh cookie to /auth/*
});

api.interceptors.request.use((config) => {
  if (accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let refreshing: Promise<AuthPayload | null> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share
 * one request (single flight). A 409 means another tab rotated the cookie a moment
 * ago, so we retry once with the browser's newer cookie.
 */
export const refreshSession = (): Promise<AuthPayload | null> => {
  refreshing ??= (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await api.post<AuthPayload>("/auth/refresh", {}, { headers: CSRF_HEADERS, _skipAuthRetry: true } as AxiosRequestConfig);
        tokenStore.set(res.data);
        return res.data;
      } catch (err) {
        const e = err as AxiosError<{ code?: string }>;
        if (e.response?.status === 409 && attempt === 0) {
          await sleep(300);
          continue;
        }
        return null;
      }
    }
    return null;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
};

/** Codes for which a fresh access token might help. Anything else (wrong password, forbidden …) is passed through. */
const RETRYABLE = new Set(["TOKEN_INVALID", "TOKEN_MISSING"]);

export const isSessionExpiry = (error: AxiosError<{ code?: string }>): boolean => {
  if (error.response?.status !== 401) return false;
  const url = error.config?.url ?? "";
  return !url.startsWith("/auth/login") && !url.startsWith("/auth/refresh") && !url.startsWith("/auth/register");
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ code?: string }>) => {
    const config = error.config as (AxiosRequestConfig & { _retried?: boolean; _skipAuthRetry?: boolean }) | undefined;
    if (!config || config._skipAuthRetry || !isSessionExpiry(error)) return Promise.reject(error);

    const code = error.response?.data?.code ?? "";
    if (!config._retried && RETRYABLE.has(code) && (await refreshSession())) {
      config._retried = true;
      config.headers = { ...config.headers, Authorization: `Bearer ${tokenStore.get()}` };
      return api.request(config);
    }

    // Session is really over (revoked, expired, signed out elsewhere)
    if (tokenStore.get()) {
      tokenStore.set(null);
      window.dispatchEvent(new CustomEvent("session-expired"));
    }
    return Promise.reject(error);
  }
);

export default api;
