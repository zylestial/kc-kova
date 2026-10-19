import { describe, expect, it } from "vitest";
import { hashToken, newToken } from "@/lib/account-tokens";

describe("newToken", () => {
  it("makes a long, URL-safe token whose hash is what gets stored", () => {
    const { raw, hash } = newToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashToken(raw));
    expect(hash).not.toContain(raw);
  });

  it("never repeats", () => {
    expect(newToken().raw).not.toBe(newToken().raw);
  });
});
