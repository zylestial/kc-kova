import { describe, expect, it } from "vitest";
import { addDays, isUrgentEligibleDate, manilaToday, regularMinDate } from "@/lib/timezone";

describe("manilaToday", () => {
  it("returns the Manila calendar date for a UTC time still on the same day", () => {
    // 09:00 UTC is 17:00 in Manila (UTC+8) - still the same calendar day.
    expect(manilaToday(new Date("2026-01-01T09:00:00Z"))).toBe("2026-01-01");
  });

  it("rolls over to the next Manila calendar day before UTC midnight", () => {
    // 17:00 UTC is 01:00 the next day in Manila.
    expect(manilaToday(new Date("2026-01-01T17:00:00Z"))).toBe("2026-01-02");
  });

  it("stays on the same Manila day just before the UTC rollover", () => {
    // 15:59 UTC is 23:59 in Manila - still the same day.
    expect(manilaToday(new Date("2026-01-01T15:59:00Z"))).toBe("2026-01-01");
  });
});

describe("addDays", () => {
  it("adds days within the same month", () => {
    expect(addDays("2026-01-01", 7)).toBe("2026-01-08");
  });

  it("rolls over a month boundary", () => {
    expect(addDays("2026-01-28", 5)).toBe("2026-02-02");
  });

  it("rolls over a year boundary", () => {
    expect(addDays("2025-12-30", 5)).toBe("2026-01-04");
  });

  it("supports zero days", () => {
    expect(addDays("2026-03-15", 0)).toBe("2026-03-15");
  });
});

describe("regularMinDate", () => {
  it("is exactly 7 Manila calendar days from today", () => {
    expect(regularMinDate(new Date("2026-01-01T09:00:00Z"))).toBe("2026-01-08");
  });

  it("accounts for the Manila day already having rolled over", () => {
    expect(regularMinDate(new Date("2026-01-01T17:00:00Z"))).toBe("2026-01-09");
  });
});

describe("isUrgentEligibleDate", () => {
  const now = new Date("2026-01-01T09:00:00Z"); // 2026-01-01 in Manila

  it("accepts today", () => {
    expect(isUrgentEligibleDate("2026-01-01", now)).toBe(true);
  });

  it("accepts tomorrow", () => {
    expect(isUrgentEligibleDate("2026-01-02", now)).toBe(true);
  });

  it("rejects two days out", () => {
    expect(isUrgentEligibleDate("2026-01-03", now)).toBe(false);
  });

  it("rejects yesterday", () => {
    expect(isUrgentEligibleDate("2025-12-31", now)).toBe(false);
  });
});
