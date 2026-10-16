import { describe, expect, it } from "vitest";

import { hasUnsavedChanges, requestDraftHasContent, setUnsavedChanges } from "@/lib/unsaved-changes";

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
