import { describe, expect, it } from "vitest";
import { accessSummary, positionAsk } from "@/lib/invite-fields";

const base = { canRequestDaily: false, canRequestCompany: false };

describe("positionAsk", () => {
  it("needs a Position for company trips, offers it to Admins, and skips it otherwise", () => {
    expect(positionAsk({ role: "Requester", canRequestCompany: true })).toBe("required");
    expect(positionAsk({ role: "Admin", canRequestCompany: false })).toBe("optional");
    expect(positionAsk({ role: "Requester", canRequestCompany: false })).toBe("none");
    expect(positionAsk({ role: "Scheduler", canRequestCompany: false })).toBe("none");
    expect(positionAsk({ role: "Driver", canRequestCompany: false })).toBe("none");
  });
});

describe("accessSummary", () => {
  it("says what each invite allows", () => {
    expect(accessSummary({ ...base, role: "Requester" })).toBe("Requester · Daily requests");
    expect(accessSummary({ ...base, role: "Requester", canRequestCompany: true })).toBe("Requester · Daily requests · Company trips");
    expect(accessSummary({ ...base, role: "Driver", driverType: "Truck" })).toBe("Truck Driver");
    expect(accessSummary({ ...base, role: "Driver", driverType: "Company car", canRequestDaily: true })).toBe(
      "Company car Driver · Daily requests",
    );
    expect(accessSummary({ ...base, role: "Scheduler" })).toBe("Scheduler · plans the trips");
    expect(accessSummary({ ...base, role: "Scheduler", canRequestDaily: true, canRequestCompany: true })).toBe(
      "Scheduler · plans the trips · Daily requests · Company trips",
    );
    expect(accessSummary({ ...base, role: "Finance" })).toBe("Finance · views trips and attendance");
    expect(accessSummary({ ...base, role: "Finance", canRequestDaily: true })).toBe(
      "Finance · views trips and attendance · Daily requests",
    );
  });
});
