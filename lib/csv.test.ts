import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("writes a header and rows, CRLF-separated", () => {
    expect(toCsv(["DATE", "KM"], [["2026-10-20", 42]])).toBe("DATE,KM\r\n2026-10-20,42");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(toCsv(["A"], [["Site Alpha, Calasiao"], ['Say "hi"'], ["two\nlines"]])).toBe(
      'A\r\n"Site Alpha, Calasiao"\r\n"Say ""hi"""\r\n"two\nlines"',
    );
  });

  it("writes Yes/No for checkboxes and blank for none", () => {
    expect(toCsv(["A", "B", "C"], [[true, false, null]])).toBe("A,B,C\r\nYes,No,");
  });

  it("keeps text that looks like a formula from running", () => {
    expect(toCsv(["A"], [["=HYPERLINK(1)"], ["-5 km"]])).toBe("A\r\n'=HYPERLINK(1)\r\n'-5 km");
    expect(toCsv(["A"], [[-5]])).toBe("A\r\n-5");
  });
});
