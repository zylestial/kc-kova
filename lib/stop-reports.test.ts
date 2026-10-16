import { describe, expect, it } from "vitest";
import type { ProblemReport } from "@/lib/kova-api";
import { missedLegs, stopReportLabel } from "@/lib/stop-reports";

const report = (patch: Partial<ProblemReport>): ProblemReport => ({
  id: "p",
  scheduleId: "s",
  revisionId: "r",
  driverId: "d",
  note: "",
  createdAt: "",
  status: "OPEN",
  handlingNote: "",
  kind: "OTHER",
  missed: false,
  ...patch,
});

describe("stop reports", () => {
  it("names a report, saying when the stop was missed", () => {
    expect(stopReportLabel(report({ kind: "NOT_AVAILABLE", missed: true }))).toBe("Missed: Not available");
    expect(stopReportLabel(report({ kind: "ROAD_BLOCKED" }))).toBe("Road blocked or bad weather");
  });

  it("lists only the missed stops, by leg", () => {
    const missed = missedLegs([report({ id: "a", legId: "l1", missed: true }), report({ id: "b", legId: "l2" }), report({ id: "c" })]);
    expect([...missed.keys()]).toEqual(["l1"]);
  });
});
