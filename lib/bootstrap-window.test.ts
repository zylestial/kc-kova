import { describe, expect, it } from "vitest";
import { defaultSince, parseSince } from "@/lib/bootstrap-window";

// 02:00 UTC on 2026-10-02 is 10:00 the same day in Manila.
const now = new Date("2026-10-02T02:00:00Z");

describe("defaultSince", () => {
  it("is 90 Manila days back", () => {
    expect(defaultSince(now)).toBe("2026-07-04");
  });

  it("uses the Manila day, not UTC", () => {
    expect(defaultSince(new Date("2026-10-02T17:00:00Z"))).toBe("2026-07-05");
  });
});

describe("parseSince", () => {
  it("accepts a real date", () => {
    expect(parseSince("2025-01-31", now)).toBe("2025-01-31");
  });

  it("falls back to the default for missing or malformed values", () => {
    for (const value of [null, "", "yesterday", "2026-13-40", "10/02/2026", "2026-10-02; drop table"]) {
      expect(parseSince(value, now)).toBe("2026-07-04");
    }
  });
});
