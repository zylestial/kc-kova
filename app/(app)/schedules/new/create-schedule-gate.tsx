"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import SchedulePlanner from "../../../schedule-planner";
import { RequireRole } from "../../require-role";
import { useAccount } from "../../providers";

export default function CreateScheduleGate() {
  const router = useRouter();
  const { viewRole, leave } = useAccount();
  const params = useSearchParams();
  const scheduleId = params.get("scheduleId") ?? undefined;
  return (
    <RequireRole allow={viewRole === "Scheduler"}>
      {scheduleId && (
        <Button variant="ghost" className="back" onClick={() => leave(() => router.push("/schedules"))}>
          <ArrowLeft size={17} /> Schedules
        </Button>
      )}
      <SchedulePlanner
        key={scheduleId ?? "new"}
        scheduleId={scheduleId}
        onDone={(notice, date) =>
          router.push(
            "/schedules?notice=" + encodeURIComponent(notice) + "&date=" + encodeURIComponent(date),
          )
        }
      />
    </RequireRole>
  );
}
