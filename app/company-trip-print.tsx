"use client";
import { createPortal } from "react-dom";
import type { Account, CompanyTripStatus, RequestGroup, TransportRequest, Vehicle } from "@/lib/kova-api";
import CompanyTripPaper, { type CompanyTripPaperData } from "./company-trip-paper";

/** What a Company trip request prints (Company trip v2): sections A and B from the request, odometers once it has ended. */
export function companyPaperData(
  group: RequestGroup,
  stops: TransportRequest[],
  status: CompanyTripStatus | undefined,
  vehicles: Vehicle[],
  accounts: Account[],
): CompanyTripPaperData {
  const active = stops.filter((stop) => stop.status === "ACTIVE");
  const vehicle = vehicles.find((item) => item.plate === group.vehiclePlate);
  const legs = status?.legs ?? [];
  const passengers = (status?.passengers ?? []).map((item) =>
    "accountId" in item ? (accounts.find((account) => account.id === item.accountId)?.name ?? "") : item.guestName,
  );
  return {
    date: group.date,
    employeeName: group.ownerName,
    position: accounts.find((account) => account.id === group.ownerAccountId)?.position ?? "",
    department: group.department?.name ?? "",
    plate: group.vehiclePlate ?? "",
    vehicleName: vehicle?.name ?? "",
    personal: !!vehicle?.ownerAccountId,
    driverName: group.driver && group.driver.id !== group.ownerAccountId ? group.driver.name : "",
    fleetCard: group.fleetCard,
    destinations: (active.length ? active : stops).map((stop) => stop.destinations[0]?.destinationName ?? ""),
    purpose: group.purpose,
    passengers: passengers.filter(Boolean).join(", "),
    timeOut: legs[0]?.out ?? "",
    timeIn: legs.at(-1)?.in ?? "",
    odometerStart: status?.odometerStart,
    odometerEnd: status?.odometerEnd,
    noOdometer: !!status?.finished && status.odometerStart == null,
  };
}

/**
 * The printed Company Trip Form, rendered into document.body so the print
 * stylesheet shows only this page (dialogs and the app hide when printing).
 */
export default function CompanyTripPrint({ data }: { data: CompanyTripPaperData }) {
  return createPortal(
    <div className="print-form company-print">
      <CompanyTripPaper data={data} />
    </div>,
    document.body,
  );
}
