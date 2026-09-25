import { describe, expect, it } from "vitest";
import { accountMissing, requestDraftMissing, stillNeeded, vehicleMissing } from "@/lib/missing-fields";

const draft = (over: Partial<Parameters<typeof requestDraftMissing>[0]> = {}) => ({
  date: "2026-10-05",
  projectOtherMode: false,
  projectOther: "",
  destinations: [{ destinationId: "d1", purposeId: "p1" }],
  ...over,
});

describe("stillNeeded", () => {
  it("lists the missing fields, or says nothing", () => {
    expect(stillNeeded(["Name", "Username"])).toBe("Still needed: Name, Username.");
    expect(stillNeeded([])).toBe("");
  });
});

describe("requestDraftMissing", () => {
  it("is empty for a complete request", () => {
    expect(requestDraftMissing(draft())).toEqual([]);
  });

  it("names the destination and purpose that are empty, numbered when there are several stops", () => {
    expect(requestDraftMissing(draft({ destinations: [{ destinationId: "", purposeId: "" }] }))).toEqual(["Destination", "Purpose"]);
    expect(
      requestDraftMissing(
        draft({
          destinations: [
            { destinationId: "d1", purposeId: "p1" },
            { destinationId: "d2", purposeId: "" },
            { destinationId: "", purposeId: "p3" },
          ],
        }),
      ),
    ).toEqual(["Purpose 2", "Destination 3"]);
  });

  it("needs a typed Project / Site only when Other is chosen", () => {
    expect(requestDraftMissing(draft({ projectOtherMode: true, projectOther: "  " }))).toEqual(["Project / Site"]);
    expect(requestDraftMissing(draft({ projectOtherMode: true, projectOther: "Site B" }))).toEqual([]);
  });

  it("asks for a destination when there are none, and a date when it is blank", () => {
    expect(requestDraftMissing(draft({ destinations: [] }))).toEqual(["at least one destination"]);
    expect(requestDraftMissing(draft({ date: "" }))).toEqual(["Date"]);
  });
});

describe("account and vehicle forms", () => {
  it("requires a password only for a new account", () => {
    expect(accountMissing({ name: "", username: " ", password: "" }, true)).toEqual(["Name", "Username", "Password"]);
    expect(accountMissing({ name: "Ana", username: "ana", password: "" }, false)).toEqual([]);
  });

  it("requires a plate and a name for a vehicle", () => {
    expect(vehicleMissing({ plate: " ", name: "" })).toEqual(["Plate", "Name"]);
    expect(vehicleMissing({ plate: "V1", name: "Van" })).toEqual([]);
  });
});
