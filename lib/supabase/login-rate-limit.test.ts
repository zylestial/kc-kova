import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory login_attempts table behind the few calls the limiter makes.
const rows = new Map<string, { count: number; window_start: string }>();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: (_: string, key: string) => ({ maybeSingle: async () => ({ data: rows.get(key) ?? null }) }) }),
      update: (patch: { count: number }) => ({ eq: async (_: string, key: string) => void rows.set(key, { ...rows.get(key)!, ...patch }) }),
      upsert: async (row: { key: string; count: number; window_start: string }) => void rows.set(row.key, row),
      delete: () => ({ eq: async (_: string, key: string) => void rows.delete(key) }),
    }),
  }),
}));

import {
  attemptsLeft,
  clearLoginAttempts,
  clientIp,
  isLoginRateLimited,
  recordFailedLogin,
  SIGN_IN_LIMIT,
} from "@/lib/supabase/login-rate-limit";

const small = { max: 3, windowMs: 60_000 };

describe("login rate limit", () => {
  beforeEach(() => rows.clear());

  it("limits a key once it reaches the max within the window", async () => {
    for (let i = 0; i < SIGN_IN_LIMIT.max - 1; i++) await recordFailedLogin("Ana");
    expect(await isLoginRateLimited("ana")).toBe(false);
    await recordFailedLogin(" ana ");
    expect(await isLoginRateLimited("ANA")).toBe(true);
  });

  it("counts several attempts at once and reports what's left", async () => {
    expect(await attemptsLeft("invite:a1", small)).toBe(3);
    await recordFailedLogin("invite:a1", small, 2);
    expect(await attemptsLeft("invite:a1", small)).toBe(1);
    await recordFailedLogin("invite:a1", small, 5);
    expect(await attemptsLeft("invite:a1", small)).toBe(0);
  });

  it("starts a new window once the old one runs out", async () => {
    rows.set("ip:1.2.3.4", { count: 99, window_start: new Date(Date.now() - 120_000).toISOString() });
    expect(await isLoginRateLimited("ip:1.2.3.4", small)).toBe(false);
    await recordFailedLogin("ip:1.2.3.4", small);
    expect(rows.get("ip:1.2.3.4")?.count).toBe(1);
  });

  it("clears a key", async () => {
    await recordFailedLogin("ana", small, 3);
    await clearLoginAttempts("Ana");
    expect(await attemptsLeft("ana", small)).toBe(3);
  });
});

describe("clientIp", () => {
  const request = (headers: Record<string, string>) => new Request("http://localhost/api/x", { headers });

  it("takes the first x-forwarded-for address", () => {
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to null", () => {
    expect(clientIp(request({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(clientIp(request({}))).toBeNull();
  });
});
