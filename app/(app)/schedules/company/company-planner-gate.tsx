"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { schedulingHref } from "@/lib/scheduling";
import { useKovaData } from "@/lib/use-kova-data";

/**
 * The old Company trips page (?date=YYYY-MM-DD, or ?trip=<schedule id>):
 * retired for Scheduling's Company trips, opened on that day.
 */
export default function CompanyPlannerGate() {
  const router = useRouter();
  const params = useSearchParams();
  const tripId = params.get("trip");
  const trip = useKovaData().schedules.find((item) => item.id === tripId);
  const date = trip?.date ?? params.get("date") ?? undefined;
  useEffect(() => {
    router.replace(schedulingHref(date, "COMPANY", trip?.id));
  }, [router, date, trip?.id]);
  return null;
}
