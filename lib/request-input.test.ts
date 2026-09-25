import { describe, expect, it } from "vitest";
import { parseRequestInput } from "@/lib/request-input";

const valid = {
  date: "2026-10-05",
  requestType: "REGULAR",
  projectId: "pr1",
  projectOther: "",
  destinations: [
    { destinationId: "d1", purposeId: "p1" },
    { destinationId: "d2", purposeId: "p2" },
  ],
};

describe("parseRequestInput", () => {
  it("accepts a complete body and keeps destination order", () => {
    expect(parseRequestInput(valid)).toEqual(valid);
  });

  it("trims Other text and defaults missing project fields", () => {
    const parsed = parseRequestInput({ ...valid, projectId: undefined, projectOther: "  Barangay 5 hall " });
    expect(parsed).toMatchObject({ projectId: "", projectOther: "Barangay 5 hall" });
  });

  it("rejects missing or malformed fields", () => {
    expect(parseRequestInput(null)).toBeNull();
    expect(parseRequestInput({ ...valid, date: "10/05/2026" })).toBeNull();
    expect(parseRequestInput({ ...valid, requestType: "SOON" })).toBeNull();
    expect(parseRequestInput({ ...valid, destinations: [] })).toBeNull();
    expect(parseRequestInput({ ...valid, destinations: [{ destinationId: "d1" }] })).toBeNull();
  });
});
