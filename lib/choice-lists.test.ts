import { describe, expect, it } from "vitest";
import { emptyOptions as empty, type BookingOption } from "@/lib/kova-api";
import { CHOICE_LISTS, activeCount, choiceGaps, gapEffect } from "@/lib/choice-lists";

const item = (name: string, status: BookingOption["status"] = "Active") => ({ id: name, name, status }) as BookingOption;

describe("choiceGaps", () => {
  it("lists every needed list that has no active choice, never an optional one", () => {
    expect(choiceGaps(empty()).map((l) => l.group)).toEqual(["projects", "destinations", "purposes", "urgent_reasons", "starting_points", "supervisors", "heads"]);
  });

  it("counts only active choices", () => {
    const options = { ...empty(), projects: [item("Riverside", "Inactive")], destinations: [item("Wilcon Depot")] };
    expect(activeCount(options, "projects")).toBe(0);
    expect(choiceGaps(options).map((l) => l.group)).toContain("projects");
    expect(choiceGaps(options).map((l) => l.group)).not.toContain("destinations");
  });
});

describe("gapEffect", () => {
  it("says what an empty list stops", () => {
    const by = (group: string) => CHOICE_LISTS.find((l) => l.group === group)!;
    expect(gapEffect(by("purposes"))).toBe("Nobody can send a request until it has one.");
    expect(gapEffect(by("urgent_reasons"))).toBe("Nobody can mark a stop Urgent until it has one.");
    expect(gapEffect(by("heads"))).toBe("Nobody can send a Company Trip until it has one.");
  });
});
