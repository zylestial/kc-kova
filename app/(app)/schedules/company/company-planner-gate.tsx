"use client";
import { useSearchParams } from "next/navigation";
import CompanyPlanner from "../../../company-planner";
import { RequireRole } from "../../require-role";
import { useAccount } from "../../providers";

/** /schedules/company?date=YYYY-MM-DD, or ?trip=<schedule id> to open one of its trips. */
export default function CompanyPlannerGate() {
  const { viewRole } = useAccount();
  const params = useSearchParams();
  const tripId = params.get("trip") ?? undefined;
  return (
    <RequireRole allow={viewRole === "Scheduler"}>
      <CompanyPlanner key={tripId ?? "day"} initialDate={params.get("date") ?? undefined} openTripId={tripId} />
    </RequireRole>
  );
}
