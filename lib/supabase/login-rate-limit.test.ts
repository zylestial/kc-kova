import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory login_attempts table behind add_login_attempts (0082) and the delete.
const rows = new Map<string, { count: number; window_start: number }>();
function addLoginAttempts({ p_key, p_by, p_window_seconds }: { p_key: string; p_by: number; p_window_seconds: number }) {
  const row = rows.get(p_key);
  const expired = !row || row.window_start <= Date.now() - p_window_seconds * 1000;
  const next = expired ? { count: Math.max(p_by, 0), window_start: Date.now() } : { ...row, count: Math.max(row.count + p_by, 0) };
  rows.set(p_key, next);
  return next.count;
}
let failing = false;
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (_: string, args: Parameters<typeof addLoginAttempts>[0]) =>
      failing ? { data: null, error: { message: "down" } } : { data: addLoginAttempts(args), error: null },
    from: () => ({ delete: () => ({ eq: async (_: string, key: string) => void rows.delete(key) }) }),
  }),
}));

import { clearLoginAttempts, clientIp, giveBackAttempts, SIGN_IN_LIMIT, takeAttempts } from "@/lib/supabase/login-rate-limit";

const small = { max: 3, windowMs: 60_000 };

describe("login rate limit", () => {
  beforeEach(() => {
    rows.clear();
    failing = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("allows the max within the window, then refuses", async () => {
    for (let i = 0; i < SIGN_IN_LIMIT.max; i++) expect((await takeAttempts(i % 2 ? "Ana" : " ana ")).ok).toBe(true);
    expect(await takeAttempts("ANA")).toEqual({ ok: false, left: 0 });
  });

  it("doesn't count a refused try", async () => {
    await takeAttempts("ana", small, 3);
    await takeAttempts("ana", small);
    await takeAttempts("ana", small);
    expect(rows.get("ana")?.count).toBe(3);
  });

  it("refuses tries sent at the same moment once they pass the max", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => takeAttempts("ana", small)));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
  });

  it("takes several at once and says how many would still fit", async () => {
    expect(await takeAttempts("invite:a1", small, 2)).toEqual({ ok: true, left: 1 });
    expect(await takeAttempts("invite:a1", small, 2)).toEqual({ ok: false, left: 1 });
    expect(await takeAttempts("invite:a1", small, 1)).toEqual({ ok: true, left: 0 });
  });

  it("gives attempts back", async () => {
    await takeAttempts("ip:1.2.3.4", small, 3);
    await giveBackAttempts("ip:1.2.3.4", small, 2);
    expect(await takeAttempts("ip:1.2.3.4", small, 2)).toEqual({ ok: true, left: 0 });
  });

  it("starts a new window once the old one runs out", async () => {
    rows.set("ip:1.2.3.4", { count: 99, window_start: Date.now() - 120_000 });
    expect((await takeAttempts("ip:1.2.3.4", small)).ok).toBe(true);
    expect(rows.get("ip:1.2.3.4")?.count).toBe(1);
  });

  it("clears a key", async () => {
    await takeAttempts("ana", small, 3);
    await clearLoginAttempts("Ana");
    expect((await takeAttempts("ana", small, 3)).ok).toBe(true);
  });

  it("allows the try when the database can't be asked", async () => {
    failing = true;
    expect((await takeAttempts("ana", small)).ok).toBe(true);
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
