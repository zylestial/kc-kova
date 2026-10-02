import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAccount = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ marker: "client" }) }));
vi.mock("@/lib/supabase/session", () => ({ requireAccount: (...args: unknown[]) => requireAccount(...args) }));

import { authed, readJson, unprocessable } from "@/lib/api-route";

const account = { id: "a1", name: "Ana", username: "ana", role: "Admin", status: "Active" };
const request = (body?: string) => new Request("http://localhost/api/x", { method: "POST", body });

describe("authed", () => {
  beforeEach(() => requireAccount.mockReset());

  it("answers 401 without calling the handler when nobody is signed in", async () => {
    requireAccount.mockResolvedValue(null);
    const handler = vi.fn();
    const response = await authed(handler)(request(), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Sign in required." });
    expect(handler).not.toHaveBeenCalled();
  });

  it("gives the handler the client, account, request and resolved params", async () => {
    requireAccount.mockResolvedValue(account);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const req = request();
    const response = await authed<{ id: string }>(handler)(req, { params: Promise.resolve({ id: "s1" }) });
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({ request: req, supabase: { marker: "client" }, account, params: { id: "s1" } });
  });
});

describe("readJson", () => {
  it("parses a JSON body and returns null for anything else", async () => {
    expect(await readJson(request('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(request("not json"))).toBeNull();
    expect(await readJson(request())).toBeNull();
  });
});

describe("unprocessable", () => {
  it("is a 422 carrying the message", async () => {
    const response = unprocessable("Add a note.");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: "Add a note." });
  });
});
