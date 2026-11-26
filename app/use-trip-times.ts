"use client";
import { runAsAttendance } from "@/lib/company-trips";
import { legTimes, placeResolver } from "@/lib/stop-times";
import { useKovaData } from "@/lib/use-kova-data";

type TripLike = { schedule: { id: string; kind: string }; revision: { legs: Parameters<typeof legTimes>[0] } };

/**
 * Each leg's actual Time Out / Time In for a trip: the Driver's (or a
 * Company trip requester's) taps, or an Admin's entry in place of one. The
 * same times the printed forms use.
 */
export function useTripTimes() {
  const { attendance, companyRuns, stopTaps, timeCorrections, options } = useKovaData();
  const placeOf = placeResolver(options.destinations);
  return (trip: TripLike) =>
    legTimes(
      trip.revision.legs,
      trip.schedule.kind === "COMPANY"
        ? runAsAttendance(companyRuns.find((item) => item.scheduleId === trip.schedule.id))
        : attendance.find((item) => item.scheduleId === trip.schedule.id),
      stopTaps.filter((item) => item.scheduleId === trip.schedule.id),
      timeCorrections.filter((item) => item.scheduleId === trip.schedule.id),
      placeOf,
      trip.schedule.kind === "COMPANY",
    );
}
