import { describe, expect, it } from "vitest";
import { isoDate, parseWith, rowVersionBody, text, trimmedText } from "@/lib/validation";

describe("validation helpers", () => {
  it("defaults missing or non-string text to empty", () => {
    expect(text.parse(undefined)).toBe("");
    expect(text.parse(5)).toBe("");
    expect(trimmedText.parse("  Ana ")).toBe("Ana");
  });

  it("accepts only YYYY-MM-DD dates", () => {
    expect(isoDate.safeParse("2026-10-05").success).toBe(true);
    expect(isoDate.safeParse("10/05/2026").success).toBe(false);
  });

  it("reads a whole-number row version", () => {
    expect(parseWith(rowVersionBody, { rowVersion: 3 })).toEqual({ rowVersion: 3 });
    expect(parseWith(rowVersionBody, { rowVersion: "4" })).toEqual({ rowVersion: 4 });
    expect(parseWith(rowVersionBody, { rowVersion: 1.5 })).toBeNull();
    expect(parseWith(rowVersionBody, {})).toBeNull();
    expect(parseWith(rowVersionBody, null)).toBeNull();
  });
});
