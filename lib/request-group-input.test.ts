import { describe, expect, it } from "vitest";
import { parseRequestForm, parseRequestGroupInput } from "@/lib/request-group-input";

const stop = {
  projectId: "p1",
  projectOther: "",
  destinationId: "d1",
  destinationOther: "",
  purposeId: "pu",
  purposeOther: "",
  urgentReasonId: "",
  details: " 40 bags cement ",
  flexibility: "FIXED",
  fixedTime: "08:30",
  contact: "Liza 0917 555 0142",
  supplierId: "",
};
const valid = {
  date: "2026-10-20",
  stops: [stop],
  startingPointId: "",
  vehiclePlate: "",
  driverId: "",
  supervisorId: "",
  headId: "",
  siteOfficer: "",
  siteCompany: "",
};

describe("parseRequestGroupInput", () => {
  it("accepts a Daily request and trims its text", () => {
    expect(parseRequestGroupInput(valid)?.stops[0]).toMatchObject({ details: "40 bags cement", flexibility: "FIXED", fixedTime: "08:30" });
  });

  it("fills in missing fields, so a Daily form need not send the Company Trip ones", () => {
    const parsed = parseRequestGroupInput({ date: "2026-10-20", stops: [{ destinationId: "d1" }] });
    expect(parsed).toMatchObject({ vehiclePlate: "", driverId: "", stops: [{ flexibility: "DAY", fixedTime: "", urgentReasonId: "" }] });
  });

  it("keeps a stop's id for an edit and drops a malformed one", () => {
    const id = "6f1c2a4e-1d2b-4c3d-9e8f-0a1b2c3d4e5f";
    expect(parseRequestGroupInput({ ...valid, stops: [{ ...stop, id }] })?.stops[0].id).toBe(id);
    expect(parseRequestGroupInput({ ...valid, stops: [{ ...stop, id: "nope" }] })?.stops[0].id).toBeUndefined();
  });

  it("rejects a bad date, more than 20 stops or overlong details", () => {
    expect(parseRequestGroupInput({ ...valid, date: "20/10/2026" })).toBeNull();
    expect(parseRequestGroupInput({ ...valid, stops: Array(21).fill(stop) })).toBeNull();
    expect(parseRequestGroupInput({ ...valid, stops: [{ ...stop, details: "x".repeat(151) }] })).toBeNull();
    expect(parseRequestGroupInput(null)).toBeNull();
  });
});

describe("parseRequestForm", () => {
  it("reads only the two forms", () => {
    expect(parseRequestForm({ form: "COMPANY" })).toBe("COMPANY");
    expect(parseRequestForm({ form: "TRUCK" })).toBeNull();
  });
});
