import { describe, expect, it } from "vitest";
import { finalLeg, initialLegs, newLeg } from "@/lib/trip-record";
import {
  hasUnsavedChanges,
  requestDraftHasContent,
  setUnsavedChanges,
  tripSignature,
} from "@/lib/unsaved-changes";

describe("unsaved changes registry", () => {
  it("reports changes while any screen holds some, and clears when they are gone", () => {
    expect(hasUnsavedChanges()).toBe(false);
    setUnsavedChanges("request", true);
    setUnsavedChanges("planner", true);
    setUnsavedChanges("request", false);
    expect(hasUnsavedChanges()).toBe(true);
    setUnsavedChanges("planner", false);
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe("requestDraftHasContent", () => {
  const emptyRow = { destinationId: "", destinationOther: "", purposeId: "", purposeOther: "" };
  const empty = { projectId: "", projectOther: "", destinations: [emptyRow] };

  it("treats a fresh form as empty", () => {
    expect(requestDraftHasContent(empty)).toBe(false);
    expect(requestDraftHasContent({ ...empty, projectOther: "   " })).toBe(false);
  });

  it("notices a project, a destination or a purpose", () => {
    expect(requestDraftHasContent({ ...empty, projectId: "p1" })).toBe(true);
    expect(requestDraftHasContent({ ...empty, projectOther: "Site B" })).toBe(true);
    expect(requestDraftHasContent({ ...empty, destinations: [{ ...emptyRow, destinationId: "d1" }] })).toBe(true);
    expect(requestDraftHasContent({ ...empty, destinations: [{ ...emptyRow, purposeId: "u1" }] })).toBe(true);
    expect(requestDraftHasContent({ ...empty, destinations: [{ ...emptyRow, destinationOther: "Warehouse" }] })).toBe(true);
    expect(requestDraftHasContent({ ...empty, destinations: [{ ...emptyRow, purposeOther: "Errand" }] })).toBe(true);
  });
});

describe("tripSignature", () => {
  it("ignores row ids but notices real edits", () => {
    const a = initialLegs();
    const b = initialLegs();
    expect(a[0].key).not.toBe(b[0].key);
    expect(tripSignature("V1", ["r1"], a)).toBe(tripSignature("V1", ["r1"], b));
    expect(tripSignature("V1", ["r1"], a)).not.toBe(tripSignature("V2", ["r1"], a));
    expect(tripSignature("V1", ["r1"], a)).not.toBe(tripSignature("V1", ["r1", "r2"], a));
    expect(tripSignature("V1", ["r1"], a)).not.toBe(
      tripSignature("V1", ["r1"], [{ ...a[0], plannedTimeIn: "09:00" }]),
    );
    expect(tripSignature("V1", ["r1"], a)).not.toBe(tripSignature("V1", ["r1"], [...a.slice(0, 1), newLeg(), finalLeg()]));
  });

  it("does not depend on the order requests were ticked", () => {
    const legs = initialLegs();
    expect(tripSignature("V1", ["r1", "r2"], legs)).toBe(tripSignature("V1", ["r2", "r1"], legs));
  });
});
