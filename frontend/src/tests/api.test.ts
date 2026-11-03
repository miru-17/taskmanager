import { describe, it, expect } from "vitest";
import type { AxiosError } from "axios";
import { isSessionExpiry } from "../services/api";

const err = (status: number, url: string, withToken: boolean) =>
  ({
    response: { status },
    config: { url, headers: withToken ? { Authorization: "Bearer x" } : {} },
  }) as unknown as AxiosError;

describe("isSessionExpiry", () => {
  it("treats a 401 on a protected route with a token as an expired session", () => {
    expect(isSessionExpiry(err(401, "/tasks", true))).toBe(true);
  });

  it("does not log out on a wrong-password login (regression)", () => {
    expect(isSessionExpiry(err(401, "/auth/login", false))).toBe(false);
    expect(isSessionExpiry(err(401, "/auth/login", true))).toBe(false);
  });

  it("ignores non-401 errors", () => {
    expect(isSessionExpiry(err(400, "/user/change-password", true))).toBe(false);
    expect(isSessionExpiry(err(500, "/tasks", true))).toBe(false);
  });

  it("ignores 401s when no token was sent", () => {
    expect(isSessionExpiry(err(401, "/tasks", false))).toBe(false);
  });
});
