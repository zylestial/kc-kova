import { describe, expect, it } from "vitest";
import { parseRequestInput } from "@/lib/request-input";

const valid = {
  date: "2026-10-05",
  projectId: "pr1",
  projectOther: "",
  vehiclePlate: "ABC-123",
  destinations: [
    { destinationId: "d1", destinationOther: "", purposeId: "p1", purposeOther: "" },
    { destinationId: "d2", destinationOther: "", purposeId: "p2", purposeOther: "" },
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

  it("accepts a typed Other destination or purpose in place of an id", () => {
    const parsed = parseRequestInput({
      ...valid,
      destinations: [{ destinationId: "", destinationOther: "  Warehouse X ", purposeId: "p1", purposeOther: "" }],
    });
    expect(parsed?.destinations).toEqual([{ destinationId: "", destinationOther: "Warehouse X", purposeId: "p1", purposeOther: "" }]);
  });

  it("leaves the vehicle blank for a Daily request", () => {
    expect(parseRequestInput({ ...valid, vehiclePlate: undefined })?.vehiclePlate).toBe("");
  });

  it("ignores a request type sent by the client", () => {
    expect(parseRequestInput({ ...valid, requestType: "URGENT" })).toEqual(valid);
  });

  it("rejects missing or malformed fields", () => {
    expect(parseRequestInput(null)).toBeNull();
    expect(parseRequestInput({ ...valid, date: "10/05/2026" })).toBeNull();
    expect(parseRequestInput({ ...valid, destinations: [] })).toBeNull();
    expect(parseRequestInput({ ...valid, destinations: [{ destinationId: "d1" }] })).toBeNull();
    expect(parseRequestInput({ ...valid, destinations: [{ destinationId: "", destinationOther: "", purposeId: "p1" }] })).toBeNull();
  });
});
