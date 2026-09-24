"use client";
import { createPortal } from "react-dom";
import type { FinishedTrip } from "@/lib/finished-trips";
import { BASE, MAX_LEGS, type StopInfo } from "@/lib/trip-record";

const blank = "________________";

/**
 * The printed Daily Vehicle Record for one finished trip, built from the
 * approved version and its completion. Rendered into document.body so the
 * print stylesheet can hide the app shell and show only this form. The
 * planned times stand in for actual ones; odometers are the Driver's.
 */
export default function FinishedTripPrint({ trip, stopsById }: { trip: FinishedTrip; stopsById: Map<string, StopInfo> }) {
  const { schedule, revision, completion, problems } = trip;
  return createPortal(
    <article className="print-form">
      <header className="print-header">
        <span className="print-header-tag">COMPANY TRIP FORM - TRUCK UTILIZATION</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/kova-print-logo.png" alt="Kayelen's Construction logo" />
      </header>
      <h1>DAILY VEHICLE TRIP &amp; UTILIZATION FORM</h1>
      <div className="print-info">
        <div>
          DATE <b>{schedule.date}</b>
        </div>
        <div>
          PLATE NO. <b>{revision.plate}</b>
        </div>
        <div>
          DRIVER <b>{revision.driverName}</b>
        </div>
        <div>
          STATUS <b>{completion.status === "DONE" ? "DONE" : "SUBMITTED FOR REVIEW"}</b>
        </div>
        <div>
          STARTING ODOMETER <b>{completion.startOdometer} km</b>
        </div>
        <div>
          ENDING ODOMETER <b>{completion.endOdometer} km</b>
        </div>
      </div>
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
              "REQUESTOR",
              "PURPOSE / ACTIVITY AT DESTINATION",
              "LEG",
              "ORIGIN",
              "TIME OUT",
              "DESTINATION",
              "TIME IN",
              "DESTINATION CONTACT",
            ].map((title) => (
              <th key={title}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: MAX_LEGS }, (_, i) => {
            const leg = revision.legs[i];
            const served = (leg?.stops ?? []).map((id) => stopsById.get(id)).filter((stop): stop is StopInfo => !!stop);
            return (
              <tr key={i}>
                <td>{served.map((stop) => stop.requester).join(", ")}</td>
                <td>{served.map((stop) => stop.purposeName).join(", ")}</td>
                <td>{i + 1}</td>
                <td>{leg?.origin || (i === 0 ? BASE : "")}</td>
                <td>{leg?.plannedTimeOut}</td>
                <td>{leg?.destinationName}</td>
                <td>{leg?.plannedTimeIn}</td>
                <td>{[leg?.contactName, leg?.contactNumber].filter(Boolean).join(" · ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>VEHICLE CONTROL</h2>
      <div className="print-row">
        <span>
          TOTAL DISTANCE <b>{completion.distance} km</b>
        </span>
        <span>
          NO. OF TRIP LEGS <b>{revision.legs.length}</b>
        </span>
      </div>
      {problems.length > 0 && (
        <>
          <h2>PROBLEMS REPORTED</h2>
          {problems.map((item) => (
            <p key={item.id}>
              {item.note}
              {item.status === "HANDLED" && ` — Handled: ${item.handlingNote}`}
            </p>
          ))}
        </>
      )}
      <h2>APPROVALS</h2>
      <div className="print-approval">
        <span>PROJECT MANAGER</span>
        <span>Joedel Capillan (PM)</span>
        <span>SIGNATURE {blank}</span>
        <span>2ND-LEVEL APPROVAL / COO</span>
        <span>President Vargas (COO)</span>
        <span>SIGNATURE {blank}</span>
      </div>
    </article>,
    document.body,
  );
}
