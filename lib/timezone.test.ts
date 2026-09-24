import { describe, expect, it } from "vitest";
import { addDays, dateInBusinessTimezone, manilaToday, regularMinDate, requestDateError } from "@/lib/timezone";

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

describe("dateInBusinessTimezone", () => {
  it("renders a UTC timestamp still on the same Manila day", () => {
    expect(dateInBusinessTimezone("2026-01-01T09:00:00Z")).toBe("2026-01-01");
  });

  it("rolls over to the next Manila calendar day before UTC midnight", () => {
    expect(dateInBusinessTimezone("2026-01-01T17:00:00Z")).toBe("2026-01-02");
  });

  it("returns an empty string for a missing timestamp", () => {
    expect(dateInBusinessTimezone(undefined)).toBe("");
  });

  it("returns an empty string for an invalid timestamp", () => {
    expect(dateInBusinessTimezone("not a date")).toBe("");
  });
});

describe("requestDateError", () => {
  // 02:00 UTC on 2026-03-10 is 10:00 the same day in Manila.
  const now = new Date("2026-03-10T02:00:00Z");

  it("allows Regular from 7 days ahead, not 6", () => {
    expect(requestDateError("2026-03-17", "REGULAR", false, now)).toBe("");
    expect(requestDateError("2026-03-16", "REGULAR", false, now)).not.toBe("");
  });

  it("allows Urgent today and tomorrow only", () => {
    expect(requestDateError("2026-03-10", "URGENT", false, now)).toBe("");
    expect(requestDateError("2026-03-11", "URGENT", false, now)).toBe("");
    expect(requestDateError("2026-03-12", "URGENT", false, now)).not.toBe("");
    expect(requestDateError("2026-03-17", "URGENT", false, now)).not.toBe("");
  });

  it("refuses 2-6 days ahead for both types", () => {
    for (const date of ["2026-03-12", "2026-03-14", "2026-03-16"]) {
      expect(requestDateError(date, "REGULAR", true, now)).not.toBe("");
      expect(requestDateError(date, "URGENT", true, now)).not.toBe("");
    }
  });

  it("lets only Admin pick a past date", () => {
    expect(requestDateError("2026-03-01", "REGULAR", true, now)).toBe("");
    expect(requestDateError("2026-03-01", "REGULAR", false, now)).not.toBe("");
  });

  it("uses the Manila calendar day, not UTC", () => {
    // 17:00 UTC on the 10th is already the 11th in Manila, so the 11th is "today".
    expect(requestDateError("2026-03-12", "URGENT", false, new Date("2026-03-10T17:00:00Z"))).toBe("");
  });
});
