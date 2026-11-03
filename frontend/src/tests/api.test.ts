import { describe, it, expect, beforeEach, vi } from "vitest";
import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import api, { isSessionExpiry, refreshSession, tokenStore } from "../services/api";
import type { AuthPayload } from "../types/auth";

const payload = (token: string) => ({ accessToken: token, organizations: [], permissions: [] }) as unknown as AuthPayload;

const respond = (config: InternalAxiosRequestConfig, status: number, data: unknown) => {
  const response = { data, status, statusText: String(status), headers: {}, config };
  if (status >= 400) {
    return Promise.reject(new AxiosError(`HTTP ${status}`, undefined, config, null, response));
  }
  return Promise.resolve(response);
};

/** Fake server: /tasks needs "fresh" token; /auth/refresh behaviour is configurable. */
let refreshCalls = 0;
let refreshBehaviour: "ok" | "fail" | "race-then-ok" = "ok";
const seenAuth: string[] = [];

const adapter: AxiosAdapter = async (config) => {
  const url = config.url ?? "";
  const auth = String(AxiosHeaders.from(config.headers).get("Authorization") ?? "");
  if (url === "/auth/refresh") {
    refreshCalls++;
    if (refreshBehaviour === "fail") return respond(config, 401, { code: "SESSION_INVALID" });
    if (refreshBehaviour === "race-then-ok" && refreshCalls === 1) return respond(config, 409, { code: "REFRESH_RACE" });
    return respond(config, 200, payload("fresh"));
  }
  if (url === "/auth/login") return respond(config, 401, { code: "INVALID_CREDENTIALS" });
  seenAuth.push(auth);
  return auth === "Bearer fresh" ? respond(config, 200, { ok: true }) : respond(config, 401, { code: "TOKEN_INVALID" });
};

beforeEach(() => {
  api.defaults.adapter = adapter;
  refreshCalls = 0;
  refreshBehaviour = "ok";
  seenAuth.length = 0;
  tokenStore.set(payload("stale"));
});

describe("access token handling", () => {
  it("refreshes once for concurrent 401s and retries each request with the new token", async () => {
    const [a, b] = await Promise.all([api.get("/tasks"), api.get("/orgs/current")]);
    expect(a.data).toEqual({ ok: true });
    expect(b.data).toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
    expect(tokenStore.get()).toBe("fresh");
    expect(seenAuth.filter((h) => h === "Bearer fresh")).toHaveLength(2);
  });

  it("retries the refresh once when another tab won a rotation race (409)", async () => {
    refreshBehaviour = "race-then-ok";
    expect((await refreshSession())?.accessToken).toBe("fresh");
    expect(refreshCalls).toBe(2);
  });

  it("ends the session and announces it when the refresh fails", async () => {
    refreshBehaviour = "fail";
    const listener = vi.fn();
    window.addEventListener("session-expired", listener);
    await expect(api.get("/tasks")).rejects.toBeInstanceOf(AxiosError);
    expect(tokenStore.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("session-expired", listener);
  });

  it("never refreshes on a wrong-password login (regression from Phase 0)", async () => {
    await expect(api.post("/auth/login", {})).rejects.toBeInstanceOf(AxiosError);
    expect(refreshCalls).toBe(0);
    expect(tokenStore.get()).toBe("stale");
  });

  it("never stores the token in localStorage", async () => {
    await api.get("/tasks");
    expect(JSON.stringify({ ...localStorage })).not.toContain("fresh");
  });
});

describe("isSessionExpiry", () => {
  const err = (status: number, url: string) =>
    ({ response: { status }, config: { url } }) as unknown as AxiosError<{ code?: string }>;

  it("is true only for 401s outside the credential endpoints", () => {
    expect(isSessionExpiry(err(401, "/tasks"))).toBe(true);
    expect(isSessionExpiry(err(401, "/auth/login"))).toBe(false);
    expect(isSessionExpiry(err(401, "/auth/refresh"))).toBe(false);
    expect(isSessionExpiry(err(400, "/user/change-password"))).toBe(false);
    expect(isSessionExpiry(err(403, "/tasks"))).toBe(false);
  });
});
