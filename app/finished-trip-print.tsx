"use client";
import { createPortal } from "react-dom";
import type { TransportRequest } from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import type { FinishedTrip } from "@/lib/finished-trips";
import { dateInBusinessTimezone } from "@/lib/timezone";
import { BASE, MAX_LEGS, type StopInfo } from "@/lib/trip-record";
import { formTimeValue, type LegTimes } from "@/lib/stop-times";
import { printKm } from "@/lib/odometer";
import { missedLegs, stopReportLabel } from "@/lib/stop-reports";

const blank = "________________";

/**
 * The printed Daily Vehicle Trip & Utilization Form for one finished trip.
 * Same layout as the paper form; v2 fills in what it knows (route, actual
 * times from the Driver's taps or an Admin's entries, Driver, odometers,
 * submission date) and leaves the rest, such as a time nobody recorded,
 * signatures, fuel checks and Finance, blank for handwriting. Rendered into
 * document.body so the print stylesheet can hide the app shell and show
 * only this form.
 */
export default function FinishedTripPrint({
  trip,
  stopsById,
  requests,
  times,
}: {
  trip: FinishedTrip;
  stopsById: Map<string, StopInfo>;
  requests: TransportRequest[];
  /** Each leg's actual Time Out / Time In (lib/stop-times), in leg order. */
  times: LegTimes[];
}) {
  const { schedule, revision, completion } = trip;
  const { vehicles } = useKovaData();
  // A stop reported missed (0061) has no Time In, and the leg after it no Time Out.
  const missed = missedLegs(trip.problems);
  const vehicle = vehicles.find((item) => item.plate === revision.plate)?.name ?? "";
  const projects = [
    ...new Set(
      requests
        .filter((item) => revision.requestIds.includes(item.id))
        .map((item) => item.projectName)
        .filter(Boolean),
    ),
  ].join(", ");
  const val = (s: string | number) => (s === "" ? blank : s);
  return createPortal(
    <article className="print-form">
      <header className="print-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/kova-print-logo.png" alt="Kayelen's Construction logo" />
      </header>
      <h1>DAILY VEHICLE TRIP &amp; UTILIZATION FORM</h1>
      <div className="print-info">
        <div>
          DATE <b>{schedule.date}</b>
        </div>
        <div>
          VEHICLE <b>{val(vehicle)}</b>
        </div>
        <div>
          PLATE NO. <b>{revision.plate}</b>
        </div>
        <div>
          DRIVER <b>{revision.driverName}</b>
        </div>
        <div>
          PROJECT / DEPARTMENT <b>{val(projects)}</b>
        </div>
        <div>
          STARTING ODOMETER <b>{printKm(completion.startOdometer)}</b>
        </div>
      </div>
      <h2>ROUTE & RECORDING RULE</h2>
      <p>
        The first trip leg of the day MUST originate from ANONANG and the final trip leg MUST terminate at ANONANG.
        Record every movement chronologically. The destination of the preceding leg must be the origin of the
        succeeding leg. A Requestor may sign/countersign a trip leg when applicable. Example: ANONANG → PROJECT SITE →
        SUPPLIER → SHELL → ANONANG.
      </p>
      <h2>TRIP RECORD</h2>
      <table className="print-trips">
        <colgroup>
          {[15, 22, 4, 10, 7, 12, 7, 23].map((n, i) => (
            <col key={i} style={{ width: n + "%" }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {[
              "REQUESTOR / SIGNATURE",
              "PURPOSE / ACTIVITY AT DESTINATION",
              "LEG",
              "ORIGIN",
              "TIME OUT",
              "DESTINATION",
              "TIME IN",
              "DESTINATION CONTACT / SITE ENGR. / LEADMAN / SUPPLIER",
            ].map((title) => (
              <th key={title}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: MAX_LEGS }, (_, i) => {
            const leg = revision.legs[i];
            const legTimes = times.find((item) => item.leg.id === leg?.id);
            const missedHere = leg ? missed.get(leg.id) : undefined;
            const missedBefore = i > 0 && missed.has(revision.legs[i - 1]?.id ?? "");
            const served = (leg?.stops ?? []).map((id) => stopsById.get(id)).filter((stop): stop is StopInfo => !!stop);
            return (
              <tr key={i}>
                <td>
                  Name: {served.map((stop) => stop.requester).join(", ") || "____________"}
                  <div className="sign-line">Sign: ______________</div>
                </td>
                <td>{served.map((stop) => stop.purposeName).join(", ")}</td>
                <td>{i + 1}</td>
                <td>{leg?.origin || (i === 0 ? BASE : "")}</td>
                <td>{legTimes && (formTimeValue(legTimes.out) ?? (missedBefore ? "—" : null))}</td>
                <td>
                  {leg?.destinationName || (!leg && i === MAX_LEGS - 1 ? BASE : "")}
                  {missedHere && ` (${stopReportLabel(missedHere)})`}
                </td>
                <td>{legTimes && (formTimeValue(legTimes.in) ?? (missedHere ? "Missed" : null))}</td>
                <td>
                  Name: {leg?.contactName || "________________"}
                  <div className="sign-line">Contact: {leg?.contactNumber || "______________"}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>FINAL RETURN / FULL-TANK CONFIRMATION</h2>
      <div className="print-return">
        <div>
          <p>
            <strong>FUELING LOCATION</strong> SHELL
          </p>
          <p>
            <strong>FULL-TANK CONFIRMATION</strong> {completion.fullTank ? "☑" : "☐"} DRIVER CONFIRMS VEHICLE IS RETURNED IN
            FULL-TANK CONDITION
          </p>
          <p>
            <strong>DRIVER CERTIFICATION</strong> I certify that the vehicle was refueled to FULL TANK before returning
            to Anonang, using the official company fleet card, and the Shell gas receipt is attached.
          </p>
        </div>
        <div>
          <p>
            <strong>FLEET CARD</strong> {completion.fleetCardUsed ? "☑" : "☐"} USED
          </p>
          <p>
            <strong>GAS RECEIPT</strong> {completion.gasReceiptAttached ? "☑" : "☐"} ATTACHED
          </p>
          <p>
            <strong>SIGNATURE</strong> ________________
          </p>
        </div>
      </div>
      <h2>VEHICLE CONTROL</h2>
      <div className="print-row">
        <span>
          ENDING ODOMETER <b>{printKm(completion.endOdometer)}</b>
        </span>
        <span>
          TOTAL DISTANCE <b>{printKm(completion.distance)}</b>
        </span>
        <span>
          NO. OF TRIP LEGS <b>{revision.legs.length}</b>
        </span>
      </div>
      <h2>APPROVALS</h2>
      <div className="print-approval">
        <span>PROJECT MANAGER</span>
        <span>Joedel Capillan (PM)</span>
        <span>SIGNATURE ________________________</span>
        <span>2ND-LEVEL APPROVAL / COO</span>
        <span>President Vargas (COO)</span>
        <span>SIGNATURE ________________________</span>
      </div>
      <h2>FOR FINANCE USE</h2>
      <div className="print-row">
        <span>DATE SUBMITTED {dateInBusinessTimezone(completion.submittedAt)}</span>
        <span>RECEIVED BY {blank}</span>
        <span>REF. NO. {blank}</span>
      </div>
      <div className="print-row">
        <span>STATUS</span>
        {["Complete", "Returned", "Invalid / late"].map((status) => (
          <span key={status}>☐ {status.toUpperCase()}</span>
        ))}
        <span>DATE {blank}</span>
      </div>
      <p className="submission">
        SUBMISSION CONTROL: Completed trip forms must be submitted to Finance by the next business day. Late forms may
        be considered INVALID.
      </p>
    </article>,
    document.body,
  );
}
