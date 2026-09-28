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
      <Button
        variant="ghost"
        className="back"
        onClick={() => leave(() => router.push(scheduleId ? "/schedules" : "/home"))}
      >
        <ArrowLeft size={17} /> {scheduleId ? "Schedules" : "Scheduler Home"}
      </Button>
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
