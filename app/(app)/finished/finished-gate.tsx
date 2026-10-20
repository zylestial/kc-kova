"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AdminFinishedTrips, { finishedProblemFilters, finishedStatusFilters } from "../../admin-finished-trips";
import SchedulerFinishedTrips from "../../scheduler-finished-trips";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function FinishedGate() {
  const router = useRouter();
  const { viewRole } = useAccount();
  const params = useSearchParams();
  const [openId] = useState(() => params.get("open") ?? undefined);
  // A Dashboard tile's starting filters.
  const [status] = useState(() => {
    const value = params.get("status");
    return value && finishedStatusFilters.includes(value) ? value : undefined;
  });
  const [problems] = useState(() => {
    const value = params.get("problems");
    return value && finishedProblemFilters.includes(value) ? value : undefined;
  });
  useEffect(() => {
    if (["open", "status", "problems"].some((key) => params.get(key))) router.replace("/finished");
    // Only ever runs once, on mount, to consume the initial query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <RequireRole allow={viewRole === "Admin" || viewRole === "Scheduler" || viewRole === "Finance"}>
      {viewRole === "Scheduler" ? (
        <SchedulerFinishedTrips />
      ) : (
        <AdminFinishedTrips
          initialOpenId={openId}
          initialStatus={status}
          initialProblems={problems}
          readOnly={viewRole === "Finance"}
        />
      )}
    </RequireRole>
  );
}
