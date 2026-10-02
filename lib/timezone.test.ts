import { describe, expect, it } from "vitest";
import { addDays, dateInBusinessTimezone, manilaToday, hasTripEnded, regularMinDate, requestDateError } from "@/lib/timezone";

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

  it("allows Urgent from today up to 6 days ahead, not 7", () => {
    for (const date of ["2026-03-10", "2026-03-11", "2026-03-12", "2026-03-16"]) {
      expect(requestDateError(date, "URGENT", false, now)).toBe("");
    }
    expect(requestDateError("2026-03-17", "URGENT", false, now)).not.toBe("");
  });

  it("leaves no gap: every future date suits exactly one type", () => {
    for (let day = 10; day <= 24; day++) {
      const date = `2026-03-${day}`;
      const allowed = [requestDateError(date, "REGULAR", false, now), requestDateError(date, "URGENT", false, now)].filter(
        (error) => !error,
      );
      expect(allowed).toHaveLength(1);
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

describe("hasTripEnded", () => {
  it("is false until the last Time In in Manila, true from that minute on", () => {
    // 10:30 Manila is 02:30 UTC.
    expect(hasTripEnded("2026-10-05", "10:30", new Date("2026-10-05T02:29:00Z"))).toBe(false);
    expect(hasTripEnded("2026-10-05", "10:30", new Date("2026-10-05T02:30:00Z"))).toBe(true);
  });

  it("uses the Manila date, not the viewer's", () => {
    // 23:30 UTC on the 4th is already 07:30 on the 5th in Manila.
    expect(hasTripEnded("2026-10-05", "07:00", new Date("2026-10-04T23:30:00Z"))).toBe(true);
    expect(hasTripEnded("2026-10-05", "08:00", new Date("2026-10-04T23:30:00Z"))).toBe(false);
  });

  it("is false for an unusable date or time", () => {
    expect(hasTripEnded("", "10:30")).toBe(false);
    expect(hasTripEnded("2026-10-05", "")).toBe(false);
  });
});
