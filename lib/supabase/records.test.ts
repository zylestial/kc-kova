import { describe, expect, it } from "vitest";
import { canFinishTrip, diffFields, isAnonangRoundTrip, matchesBookingKey, omit, stripAdminOnlyFields } from "@/lib/supabase/records";

describe("diffFields", () => {
  it("reports only fields whose value actually changed", () => {
    const changes = diffFields({ a: 1, b: "x", c: true }, { a: 1, b: "y", c: true });
    expect(changes).toEqual([{ field: "b", before: "x", after: "y" }]);
  });

  it("reports fields added or removed between the two objects", () => {
    const changes = diffFields({ a: 1 }, { a: 1, b: 2 });
    expect(changes).toContainEqual({ field: "b", before: null, after: 2 });
  });

  it("never reports the history field itself", () => {
    const changes = diffFields({ history: [1] }, { history: [1, 2] });
    expect(changes).toEqual([]);
  });

  it("compares nested values (legs) structurally, not by reference", () => {
    const legs = [{ origin: "ANONANG" }];
    const changes = diffFields({ legs }, { legs: [{ origin: "ANONANG" }] });
    expect(changes).toEqual([]);
  });
});

describe("isAnonangRoundTrip", () => {
  it("accepts a trip that starts and ends at ANONANG", () => {
    expect(isAnonangRoundTrip([{ origin: "ANONANG", destination: "Site A" }, { origin: "Site A", destination: "ANONANG" }])).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isAnonangRoundTrip([{ origin: " anonang ", destination: "anonang" }])).toBe(true);
  });

  it("rejects a trip that doesn't start at ANONANG", () => {
    expect(isAnonangRoundTrip([{ origin: "Site A", destination: "ANONANG" }])).toBe(false);
  });

  it("rejects a trip that doesn't end at ANONANG", () => {
    expect(isAnonangRoundTrip([{ origin: "ANONANG", destination: "Site A" }])).toBe(false);
  });

  it("rejects an empty or missing leg list", () => {
    expect(isAnonangRoundTrip([])).toBe(false);
    expect(isAnonangRoundTrip(undefined)).toBe(false);
    expect(isAnonangRoundTrip("not an array")).toBe(false);
  });
});

describe("canFinishTrip", () => {
  it("is true once the scheduled end hour has passed", () => {
    expect(canFinishTrip("2026-01-01", 17, new Date("2026-01-01T18:00:00"))).toBe(true);
  });

  it("is false before the scheduled end hour", () => {
    expect(canFinishTrip("2026-01-01", 17, new Date("2026-01-01T10:00:00"))).toBe(false);
  });

  it("is false for a malformed date", () => {
    expect(canFinishTrip("01/01/2026", 17, new Date())).toBe(false);
  });

  it("is false for a non-integer end hour", () => {
    expect(canFinishTrip("2026-01-01", 17.5, new Date("2026-01-01T20:00:00"))).toBe(false);
  });
});

describe("matchesBookingKey", () => {
  it("accepts a date/plate that matches the booking", () => {
    expect(matchesBookingKey("2026-01-01", "ABC-123", { date: "2026-01-01", plate: "ABC-123" })).toBe(true);
  });

  it("rejects a plate that doesn't match the booking's vehicle", () => {
    expect(matchesBookingKey("2026-01-01", "OTHER-999", { date: "2026-01-01", plate: "ABC-123" })).toBe(false);
  });

  it("rejects a date that doesn't match the booking's day", () => {
    expect(matchesBookingKey("2026-02-02", "ABC-123", { date: "2026-01-01", plate: "ABC-123" })).toBe(false);
  });
});

describe("stripAdminOnlyFields", () => {
  it("removes every finance/approval/history field", () => {
    const stripped = stripAdminOnlyFields({
      start: "100",
      pm: "Joedel Capillan",
      coo: "President Vargas",
      submitted: "2026-01-01",
      received: "Someone",
      reference: "REF-1",
      finance: "Pending",
      financeDate: "2026-01-02",
      history: [{ action: "EDIT" }],
    });
    expect(stripped).toEqual({ start: "100" });
  });

  it("leaves non-admin-only fields untouched", () => {
    expect(stripAdminOnlyFields({ start: "1", end: "2", legs: [] })).toEqual({ start: "1", end: "2", legs: [] });
  });
});

describe("omit", () => {
  it("removes only the named keys", () => {
    expect(omit({ a: 1, b: 2, c: 3 }, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("is a no-op when none of the keys are present", () => {
    expect(omit({ a: 1 }, ["z"])).toEqual({ a: 1 });
  });
});
