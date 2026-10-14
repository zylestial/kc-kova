"use client";
import { useSearchParams } from "next/navigation";
import Scheduling from "../../scheduling";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

/** /scheduling, or ?date=YYYY-MM-DD to open on a day. */
export default function SchedulingGate() {
  const { viewRole } = useAccount();
  const params = useSearchParams();
  return (
    <RequireRole allow={viewRole === "Scheduler"}>
      <Scheduling initialDate={params.get("date") ?? undefined} />
    </RequireRole>
  );
}
