"use client";
import { createPortal } from "react-dom";
import type { TransportRequest } from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import type { FinishedTrip } from "@/lib/finished-trips";
import { formTimeValue, type LegTimes } from "@/lib/stop-times";
import CompanyTripPaper from "./company-trip-paper";

/**
 * The printed Company Trip Form for one finished Company trip: the
 * requester, their Position, department and signatories from the request,
 * the legs with their actual times (the requester's taps or an Admin's
 * entries) and both odometer readings. Signatures and For Finance Use print
 * blank. Rendered into document.body so the print stylesheet shows only
 * this form, like the Daily form (finished-trip-print.tsx).
 */
export default function CompanyTripPrint({
  trip,
  requests,
  times,
}: {
  trip: FinishedTrip;
  requests: TransportRequest[];
  times: LegTimes[];
}) {
  const { schedule, revision, completion } = trip;
  const { vehicles, accounts } = useKovaData();
  const stops = requests.filter((request) => revision.requestIds.includes(request.id));
  const group = stops[0]?.group;
  const stopOf = (stopId?: string) => stops.find((request) => request.destinations.some((item) => item.id === stopId));
  return createPortal(
    <div className="print-form company-print">
      <CompanyTripPaper
        data={{
          date: schedule.date,
          vehicleName: vehicles.find((item) => item.plate === revision.plate)?.name ?? "",
          plate: revision.plate,
          driverName: revision.driverName,
          requestedBy: [...new Set(stops.map((stop) => stop.ownerName))].join(", "),
          position: accounts.find((account) => account.id === group?.ownerAccountId)?.position ?? "",
          department: group?.department?.name ?? "",
          legs: times.map(({ leg, out, in: timeIn }) => {
            const stop = stopOf(leg.stops[0]);
            const purpose = stop?.urgentReason ? `Urgent: ${stop.urgentReason.name}` : (stop?.destinations[0]?.purposeName ?? "");
            return {
              purpose: [purpose, stop?.details].filter(Boolean).join(" – "),
              origin: leg.origin,
              destination: leg.destinationName,
              timeOut: formTimeValue(out) ?? "",
              timeIn: formTimeValue(timeIn) ?? "",
              contact: stop?.contact ?? "",
              supplier: stop?.supplier?.name ?? "",
            };
          }),
          supervisor: group?.supervisor?.name ?? "",
          head: group?.head?.name ?? "",
          siteOfficer: group?.siteOfficer ?? "",
          siteCompany: group?.siteCompany ?? "",
          odometerStart: completion.startOdometer,
          odometerEnd: completion.endOdometer,
        }}
      />
    </div>,
    document.body,
  );
}
