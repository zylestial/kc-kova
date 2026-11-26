"use client";
import { useEffect, useState } from "react";
import type { ProblemReport } from "@/lib/kova-api";
import { stopReportLabel } from "@/lib/stop-reports";

/**
 * Opening a trip at one of its reports (owner's call 2026-11-26): remembers
 * the report, then scrolls the dialog to it once it's mounted. A stop report
 * is shown opened on its leg card; a trip problem in the list below.
 */
export function useReportFocus(selectedId: string | null) {
  const [focusReport, setFocusReport] = useState<ProblemReport | null>(null);
  useEffect(() => {
    if (!focusReport || !selectedId) return;
    const anchor = focusReport.legId ? `leg-report-${focusReport.id}` : `report-${focusReport.id}`;
    // The dialog mounts in a portal after this render.
    const timer = window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
    return () => window.clearTimeout(timer);
  }, [focusReport, selectedId]);
  return { focusReport, setFocusReport };
}

/** "Open problem: Missed: Not available" in a Finished Trips row; opens the trip at that report. */
export default function OpenProblemLink({ problems, onOpen }: { problems: ProblemReport[]; onOpen: (report: ProblemReport) => void }) {
  const problem = problems.find((item) => item.status === "OPEN");
  if (!problem) return null;
  return (
    <button
      type="button"
      className="trip-problem-link"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(problem);
      }}
    >
      Open problem: {problem.legId ? stopReportLabel(problem) : "on the trip"}
    </button>
  );
}
