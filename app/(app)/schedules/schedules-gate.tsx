"use client";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import Schedules from "../../schedules";
import { useAutoClear } from "@/lib/use-auto-clear";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function SchedulesGate() {
  const router = useRouter();
  const { viewRole } = useAccount();
  const params = useSearchParams();
  const [date] = useState(() => params.get("date") ?? undefined);
  // Read once, then strip from the URL so a refresh doesn't re-show it.
  const [notice, setNotice] = useState(() => params.get("notice") ?? "");
  const [openId] = useState(() => params.get("open") ?? undefined);
  useAutoClear(notice, setNotice);
  useEffect(() => {
    if (params.get("notice") || params.get("open")) router.replace(date ? `/schedules?date=${encodeURIComponent(date)}` : "/schedules");
    // Only ever runs once, on mount, to consume the initial ?notice=/?open=.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <RequireRole allow={viewRole === "Scheduler" || viewRole === "Admin"}>
      <Button variant="ghost" className="back" onClick={() => router.push("/home")}>
        <ArrowLeft size={17} /> {viewRole} Home
      </Button>
      <Schedules
        key={date ?? "today"}
        canEdit={viewRole === "Scheduler"}
        canReview={viewRole === "Admin"}
        notice={notice}
        initialDate={date}
        initialOpenId={openId}
        onCreate={viewRole === "Scheduler" ? () => router.push("/schedules/new") : undefined}
        onEdit={(id) => router.push("/schedules/new?scheduleId=" + encodeURIComponent(id))}
      />
    </RequireRole>
  );
}
