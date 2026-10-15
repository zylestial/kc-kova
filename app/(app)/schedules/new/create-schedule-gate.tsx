"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { schedulingHref } from "@/lib/scheduling";
import { useKovaData } from "@/lib/use-kova-data";

/**
 * The old Create schedule page (?scheduleId=<id> to continue one): retired
 * for Scheduling, which opens on that schedule's day and kind.
 */
export default function CreateScheduleGate() {
  const router = useRouter();
  const scheduleId = useSearchParams().get("scheduleId");
  const schedule = useKovaData().schedules.find((item) => item.id === scheduleId);
  useEffect(() => {
    router.replace(schedulingHref(schedule?.date, schedule?.kind));
  }, [router, schedule]);
  return null;
}
