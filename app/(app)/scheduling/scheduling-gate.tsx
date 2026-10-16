"use client";
import { useRouter, useSearchParams } from "next/navigation";
import Scheduling from "../../scheduling";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

/**
 * /scheduling, or ?date=YYYY-MM-DD&type=DAILY|COMPANY to open the planner for
 * that day and type; &trip=<schedule id> also shows that trip's vehicle.
 */
export default function SchedulingGate() {
  const { viewRole } = useAccount();
  const params = useSearchParams();
  const router = useRouter();
  const type = params.get("type");
  return (
    <RequireRole allow={viewRole === "Scheduler"}>
      <Scheduling
        initialDate={params.get("date") ?? undefined}
        initialKind={type === "DAILY" || type === "COMPANY" ? type : undefined}
        initialTripId={params.get("trip") ?? undefined}
        onChange={(date, kind) =>
          router.replace(`/scheduling?date=${encodeURIComponent(date)}&type=${kind}`, { scroll: false })
        }
      />
    </RequireRole>
  );
}
