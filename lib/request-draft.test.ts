import { describe, expect, it } from "vitest";
import { emptyOptions, type BookingOptions, type RequestGroup, type TransportRequest } from "@/lib/kova-api";
import {
  draftFromGroup,
  draftHasContent,
  draftMissing,
  draftToInput,
  emptyRequestDraft,
  emptyStop,
  needsDetails,
  stopErrors,
  stopLetter,
  weekLabel,
  whenText,
  type RequestDraft,
} from "@/lib/request-draft";

const option = (id: string, name: string) => ({ id, name, status: "Active" as const });
const options: BookingOptions = {
  ...emptyOptions(),
  projects: [option("p1", "Riverside Townhomes"), option("p2", "Head office")],
  destinations: [option("d1", "Wilcon Depot")],
  purposes: [option("pu", "Pick up"), option("sv", "Site visit")],
  urgent_reasons: [option("ur", "Critical materials delivery")],
};

const filled = (): RequestDraft => ({
  ...emptyRequestDraft("DAILY", "2026-10-20"),
  projectId: "p1",
  stops: [{ ...emptyStop(), destinationId: "d1", purposeId: "sv" }],
});

describe("stopErrors", () => {
  it("passes a complete regular stop", () => {
    const draft = filled();
    expect(stopErrors(draft, draft.stops[0], options)).toEqual({});
  });

  it("needs details for Pick up and for every Urgent stop", () => {
    const draft = filled();
    const pickUp = { ...draft.stops[0], purposeId: "pu" };
    expect(needsDetails(pickUp, options)).toBe(true);
    expect(stopErrors(draft, pickUp, options).details).toBe("Say what to pick up, e.g. items, quantity, who receives.");
    const urgent = { ...draft.stops[0], urgent: true, urgentReasonId: "ur" };
    expect(stopErrors(draft, urgent, options)).toEqual({
      details: "Say what's needed at this stop, e.g. what to pick up or deliver.",
    });
  });

  it("asks an Urgent stop for its reason instead of a purpose", () => {
    const draft = filled();
    const errors = stopErrors(draft, { ...draft.stops[0], purposeId: "", urgent: true, details: "x" }, options);
    expect(errors).toEqual({ urgentReason: "Pick why this stop is urgent, or set it to Regular." });
  });

  it("needs a time for a fixed stop, and a project per stop in multiple mode", () => {
    const draft = { ...filled(), projectMode: "multi" as const };
    expect(stopErrors(draft, { ...draft.stops[0], flexibility: "FIXED" }, options)).toEqual({
      project: "Pick the project this stop is for.",
      fixedTime: "Add the appointment time.",
    });
  });

  it("skips a locked stop", () => {
    const draft = filled();
    expect(stopErrors(draft, { ...emptyStop(), locked: true }, options)).toEqual({});
  });
});

describe("draftMissing", () => {
  it("names each stop's missing fields by letter", () => {
    const draft = { ...filled(), projectId: "", stops: [filled().stops[0], emptyStop()] };
    expect(draftMissing(draft, options)).toEqual(["Project / Site", "Stop B: Destination", "Stop B: Purpose"]);
  });
});

describe("draftToInput", () => {
  it("gives every stop the single project and leaves the Company Trip fields blank", () => {
    const draft = { ...filled(), vehiclePlate: "VM", stops: [filled().stops[0], { ...filled().stops[0], details: " 2 boxes " }] };
    const input = draftToInput(draft);
    expect(input.stops.map((stop) => stop.projectId)).toEqual(["p1", "p1"]);
    expect(input.stops[1].details).toBe("2 boxes");
    expect(input.vehiclePlate).toBe("");
  });

  it("sends an Urgent stop's reason and no purpose, and a time only when fixed", () => {
    const stop = { ...filled().stops[0], urgent: true, urgentReasonId: "ur", fixedTime: "09:30" };
    const [sent] = draftToInput({ ...filled(), stops: [stop] }).stops;
    expect(sent).toMatchObject({ purposeId: "", urgentReasonId: "ur", fixedTime: "" });
  });

  it("sends a typed project and a saved stop's id", () => {
    const draft = { ...filled(), projectOtherMode: true, projectOther: " New site ", stops: [{ ...filled().stops[0], id: "s1" }] };
    expect(draftToInput(draft).stops[0]).toMatchObject({ id: "s1", projectId: "", projectOther: "New site" });
  });
});

describe("stopLetter", () => {
  it("letters new stops in order, after any saved ones", () => {
    const draft = { ...filled(), stops: [{ ...emptyStop(), letter: "A" }, emptyStop(), emptyStop()] };
    expect([0, 1, 2].map((index) => stopLetter(draft, index, 3))).toEqual(["A", "D", "E"]);
    expect(stopLetter(filled(), 0)).toBe("A");
  });
});

describe("draftFromGroup", () => {
  const group: RequestGroup = {
    id: "g",
    number: 52,
    ownerAccountId: "o",
    ownerName: "Ana",
    form: "DAILY",
    date: "2026-10-20",
    siteOfficer: "",
    siteCompany: "",
    rowVersion: 1,
    createdAt: "",
  };
  const request = (id: string, letter: string, over: Partial<TransportRequest> = {}): TransportRequest => ({
    id,
    stopLetter: letter,
    details: "",
    flexibility: "DAY",
    contact: "",
    ownerAccountId: "o",
    ownerName: "Ana",
    date: "2026-10-20",
    requestType: "REGULAR",
    projectId: "p1",
    projectName: "Riverside Townhomes",
    projectIsOther: false,
    status: "ACTIVE",
    rowVersion: 1,
    createdAt: "",
    updatedAt: "",
    progress: "NOT_YET_SCHEDULED",
    cancellationPending: false,
    destinations: [
      { id: "x" + id, position: 1, destinationId: "d1", destinationName: "Wilcon Depot", destinationIsOther: false, purposeId: "sv", purposeName: "Site visit", purposeIsOther: false },
    ],
    ...over,
  });

  it("rebuilds the form, single project, without cancelled stops", () => {
    const draft = draftFromGroup(group, [request("a", "A"), request("b", "B", { status: "CANCELLED", projectId: "p2" })], new Set(["a"]));
    expect(draft).toMatchObject({ projectMode: "one", projectId: "p1" });
    expect(draft.stops).toHaveLength(1);
    expect(draft.stops[0]).toMatchObject({ id: "a", letter: "A", locked: true, destinationId: "d1", purposeId: "sv" });
  });

  it("uses multiple mode when stops differ, and reads an Urgent stop", () => {
    const urgent = request("b", "B", { projectId: "p2", urgentReason: { id: "ur", name: "Critical materials delivery" } });
    const draft = draftFromGroup(group, [request("a", "A"), urgent], new Set());
    expect(draft.projectMode).toBe("multi");
    expect(draft.stops[1]).toMatchObject({ urgent: true, urgentReasonId: "ur", purposeId: "", projectId: "p2" });
  });
});

describe("labels", () => {
  it("covers Monday to Saturday for any day that week", () => {
    expect(weekLabel("2026-10-14")).toBe("Oct 12–17");
    expect(whenText("2026-10-15", "FIXED", "13:05")).toBe("Thu, Oct 15 at 1:05 PM");
    expect(whenText("2026-10-15", "DAY", "")).toBe("Thu, Oct 15, any time");
  });

  it("sees an untouched form as empty", () => {
    expect(draftHasContent(emptyRequestDraft("DAILY", "2026-10-20"))).toBe(false);
    expect(draftHasContent(filled())).toBe(true);
  });
});
