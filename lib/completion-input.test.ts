import { describe, expect, it } from "vitest";
import { parseCompletionInput, parseProblemNote } from "@/lib/completion-input";

describe("parseCompletionInput", () => {
  it("accepts whole-number odometers, including equal readings", () => {
    expect(parseCompletionInput({ startOdometer: 1000, endOdometer: 1042 })).toEqual({ startOdometer: 1000, endOdometer: 1042 });
    expect(parseCompletionInput({ startOdometer: 0, endOdometer: 0 })).toEqual({ startOdometer: 0, endOdometer: 0 });
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
