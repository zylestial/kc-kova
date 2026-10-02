import { describe, expect, it } from "vitest";
import { anyDate, inDateFilter, presetRange } from "@/lib/date-range";

// 2026-10-02 is a Friday.
const today = "2026-10-02";

describe("presetRange", () => {
  it("covers just today", () => {
    expect(presetRange("today", today)).toEqual({ from: today, to: today });
  });

  it("runs this week Monday to Sunday", () => {
    expect(presetRange("this-week", today)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(presetRange("this-week", "2026-09-28")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(presetRange("this-week", "2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("covers the whole calendar month", () => {
    expect(presetRange("this-month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("this-month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("this-month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("covers last month, across a year boundary too", () => {
    expect(presetRange("last-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last-month", "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("leaves any date open", () => {
    expect(presetRange("any", today)).toEqual({ from: "", to: "" });
  });
});

describe("inDateFilter", () => {
  it("matches everything for any date", () => {
    expect(inDateFilter("1999-01-01", anyDate, today)).toBe(true);
  });

  it("includes both ends of a custom range", () => {
    const filter = { preset: "custom" as const, from: "2026-09-10", to: "2026-09-20" };
    expect(inDateFilter("2026-09-10", filter, today)).toBe(true);
    expect(inDateFilter("2026-09-20", filter, today)).toBe(true);
    expect(inDateFilter("2026-09-21", filter, today)).toBe(false);
    expect(inDateFilter("2026-09-09", filter, today)).toBe(false);
  });

  it("leaves a blank end of a custom range open", () => {
    expect(inDateFilter("2030-01-01", { preset: "custom", from: "2026-09-10", to: "" }, today)).toBe(true);
    expect(inDateFilter("2000-01-01", { preset: "custom", from: "", to: "2026-09-10" }, today)).toBe(true);
  });

  it("uses the quick pick's dates, not stale From/To", () => {
    expect(inDateFilter("2026-09-15", { preset: "last-month", from: "2026-10-01", to: "2026-10-01" }, today)).toBe(true);
  });
});
