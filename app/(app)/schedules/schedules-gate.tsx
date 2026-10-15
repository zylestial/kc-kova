"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Schedules, { scheduleViews, type ScheduleView } from "../../schedules";
import { scheduleStateLabel, type ScheduleState } from "@/lib/trip-record";
import { schedulingHref } from "@/lib/scheduling";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useKovaData } from "@/lib/use-kova-data";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function SchedulesGate() {
  const router = useRouter();
  const { account, viewRole } = useAccount();
  const { schedules } = useKovaData();
  const params = useSearchParams();
  const [date] = useState(() => params.get("date") ?? undefined);
  // Read once, then strip from the URL so a refresh doesn't re-show it.
  const [notice, setNotice] = useState(() => params.get("notice") ?? "");
  const [openId] = useState(() => params.get("open") ?? undefined);
  // A Dashboard tile's starting filter. A status filter on its own opens
  // All dates, so the screen shows everything the tile counted.
  const [status] = useState(() => {
    const value = params.get("status");
    return value && Object.hasOwn(scheduleStateLabel, value) ? (value as ScheduleState) : undefined;
  });
  const [view] = useState(() => {
    const value = params.get("view") as ScheduleView | null;
    return value && scheduleViews.includes(value) ? value : status ? "all" : undefined;
  });
  useAutoClear(notice, setNotice);
  useEffect(() => {
    if (["notice", "open", "status", "view"].some((key) => params.get(key)))
      router.replace(date ? `/schedules?date=${encodeURIComponent(date)}` : "/schedules");
    // Only ever runs once, on mount, to consume the initial query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <RequireRole allow={viewRole === "Scheduler" || viewRole === "Admin"}>
      <Schedules
        key={date ?? "today"}
        viewerId={account.id}
        canEdit={viewRole === "Scheduler"}
        canReview={viewRole === "Admin"}
        notice={notice}
        initialDate={date}
        initialOpenId={openId}
        initialView={view}
        initialStatus={status}
        onCreate={viewRole === "Scheduler" ? () => router.push(schedulingHref(date)) : undefined}
        onEdit={(id) => {
          const schedule = schedules.find((item) => item.id === id);
          router.push(schedulingHref(schedule?.date, schedule?.kind));
        }}
      />
    </RequireRole>
  );
}
