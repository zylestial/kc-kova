import { describe, expect, it } from "vitest";
import { parseCompletionInput, parseHandleProblemInput, parseProblemNote } from "@/lib/completion-input";

describe("parseCompletionInput", () => {
  it("accepts whole-number odometers, including equal readings", () => {
    expect(parseCompletionInput({ startOdometer: 1000, endOdometer: 1042 })).toEqual({
      startOdometer: 1000,
      endOdometer: 1042,
      fullTank: null,
      fleetCardUsed: null,
      gasReceiptAttached: null,
    });
    expect(parseCompletionInput({ startOdometer: 0, endOdometer: 0 })).toEqual({
      startOdometer: 0,
      endOdometer: 0,
      fullTank: null,
      fleetCardUsed: null,
      gasReceiptAttached: null,
    });
  });

  it("reads the optional return checks when given as booleans", () => {
    expect(
      parseCompletionInput({ startOdometer: 1000, endOdometer: 1042, fullTank: true, fleetCardUsed: false, gasReceiptAttached: true }),
    ).toEqual({ startOdometer: 1000, endOdometer: 1042, fullTank: true, fleetCardUsed: false, gasReceiptAttached: true });
  });

  it("treats a non-boolean return check as unanswered", () => {
    expect(parseCompletionInput({ startOdometer: 1000, endOdometer: 1042, fullTank: "yes" })?.fullTank).toBeNull();
  });

  it("rejects an end below the start or a negative start", () => {
    expect(parseCompletionInput({ startOdometer: 150, endOdometer: 100 })).toBeNull();
    expect(parseCompletionInput({ startOdometer: -1, endOdometer: 100 })).toBeNull();
  });

  it("rejects missing, fractional and non-numeric readings", () => {
    expect(parseCompletionInput({ startOdometer: 1 })).toBeNull();
    expect(parseCompletionInput({ startOdometer: 1.5, endOdometer: 2 })).toBeNull();
    expect(parseCompletionInput({ startOdometer: "1000", endOdometer: "1042" })).toBeNull();
    expect(parseCompletionInput(null)).toBeNull();
  });

  it("takes no readings at all, for a vehicle without an odometer (0078)", () => {
    expect(parseCompletionInput({ fullTank: true })).toEqual({
      startOdometer: null,
      endOdometer: null,
      fullTank: true,
      fleetCardUsed: null,
      gasReceiptAttached: null,
    });
    expect(parseCompletionInput({ startOdometer: null, endOdometer: null })?.startOdometer).toBeNull();
    expect(parseCompletionInput({ startOdometer: null, endOdometer: 1042 })).toBeNull();
  });
});

describe("parseProblemNote", () => {
  it("trims the note", () => {
    expect(parseProblemNote({ note: "  Road closed  " })).toBe("Road closed");
  });

  it("rejects a blank or missing note", () => {
    expect(parseProblemNote({ note: "   " })).toBeNull();
    expect(parseProblemNote({})).toBeNull();
    expect(parseProblemNote({ note: 5 })).toBeNull();
    expect(parseProblemNote(undefined)).toBeNull();
  });
});

describe("parseHandleProblemInput", () => {
  it("trims the note and keeps an optional follow-up", () => {
    expect(parseHandleProblemInput({ handlingNote: "  Tyre replaced ", followUpScheduleId: "s2" })).toEqual({
      handlingNote: "Tyre replaced",
      followUpScheduleId: "s2",
    });
    expect(parseHandleProblemInput({ handlingNote: "Fixed" })).toEqual({ handlingNote: "Fixed", followUpScheduleId: null });
    expect(parseHandleProblemInput({ handlingNote: "Fixed", followUpScheduleId: null })?.followUpScheduleId).toBeNull();
  });

  it("rejects a blank or missing note and a non-string follow-up", () => {
    expect(parseHandleProblemInput({ handlingNote: "   " })).toBeNull();
    expect(parseHandleProblemInput({})).toBeNull();
    expect(parseHandleProblemInput({ handlingNote: "Fixed", followUpScheduleId: 5 })).toBeNull();
    expect(parseHandleProblemInput(null)).toBeNull();
  });
});
