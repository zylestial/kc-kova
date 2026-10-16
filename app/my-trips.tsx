"use client";
import { useMemo, useState } from "react";
import { Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordCompanyRun, recordCompanyStop, type Schedule, type ScheduleRevision } from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { useAutoClear } from "@/lib/use-auto-clear";
import { manilaToday } from "@/lib/timezone";
import { getPhoneLocation } from "@/lib/phone-location";
import { companyTripSteps, type CompanyStep } from "@/lib/company-trips";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

type Trip = { schedule: Schedule; revision: ScheduleRevision };

/**
 * My Trips (Company Trip Flow prototype, "Drive"): the requester's approved
 * Company trips. The requester taps Start trip at the starting point with
 * the odometer, Arrived and Leaving at each stop, and End trip on reaching
 * the last stop with the odometer again; End trip submits the trip. The
 * Driver drives; nothing goes into Attendance (0055).
 */
export default function MyTrips({ accountId, initialOpenId }: { accountId: string; initialOpenId?: string }) {
  const { schedules, requests, vehicles, companyRuns, stopTaps, completions } = useKovaData();
  const today = manilaToday();
  const mine = useMemo(() => new Set(requests.filter((request) => request.ownerAccountId === accountId).map((request) => request.id)), [requests, accountId]);
  const trips: Trip[] = schedules
    .filter((schedule) => schedule.kind === "COMPANY" && schedule.status === "ACTIVE")
    .flatMap((schedule) => {
      const revision = schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
      return revision && revision.requestIds.some((id) => mine.has(id)) ? [{ schedule, revision }] : [];
    })
    .sort((a, b) => a.schedule.date.localeCompare(b.schedule.date));
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [odometer, setOdometer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locationOff, setLocationOff] = useState(false);
  useAutoClear(notice, setNotice);

  const open = trips.find((trip) => trip.schedule.id === openId);
  const runOf = (trip: Trip) => companyRuns.find((run) => run.scheduleId === trip.schedule.id);
  const stepsOf = (trip: Trip) =>
    companyTripSteps(trip.revision.legs, runOf(trip), stopTaps.filter((tap) => tap.scheduleId === trip.schedule.id));
  const vehicleName = (plate: string) => vehicles.find((vehicle) => vehicle.plate === plate)?.name ?? plate;

  function status(trip: Trip): [string, string] {
    const run = runOf(trip);
    const completion = completions.find((item) => item.scheduleId === trip.schedule.id);
    if (completion) return [completion.status === "DONE" ? "Done" : "Submitted", "scheduled"];
    if (run?.endAt) return ["Submitted", "scheduled"];
    if (run) return ["On the road", "info"];
    return trip.schedule.date <= today ? ["Ready to start", "pending"] : ["Upcoming", "info"];
  }

  async function tap(trip: Trip, step: CompanyStep) {
    const needsOdometer = step.kind === "START" || step.kind === "END";
    const reading = Number(odometer);
    if (needsOdometer && (odometer.trim() === "" || !Number.isInteger(reading) || reading < 0)) {
      setError("Enter the odometer reading in whole kilometres.");
      return;
    }
    const run = runOf(trip);
    if (step.kind === "END" && run && reading < run.startOdometer) {
      setError(`The ending reading can't be lower than the start (${run.startOdometer} km).`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const location = await getPhoneLocation();
      if (step.kind === "START" || step.kind === "END") {
        await recordCompanyRun(trip.schedule.id, { kind: step.kind, odometer: reading, location });
        setOdometer("");
        if (step.kind === "END") setNotice("Trip ended and submitted. Thank you!");
      } else {
        await recordCompanyStop(trip.schedule.id, { legId: step.legId!, kind: step.kind, location });
      }
      setLocationOff(!location);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    }
    setBusy(false);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMPANY TRIPS</div>
          <h1>
            My Trips<span className="title-dot">.</span>
          </h1>
          <p>Your approved Company trips. You record each one: Start trip with the odometer, each stop, then End trip.</p>
        </div>
      </div>
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <Car size={20} />
            <h2>Trips</h2>
            <span className="count">{trips.length}</span>
          </div>
        </div>
        {trips.length ? (
          <div className="my-trips">
            {trips.map((trip) => {
              const [label, pill] = status(trip);
              const isOpen = open?.schedule.id === trip.schedule.id;
              const steps = stepsOf(trip);
              const next = steps.find((step) => !step.at);
              const run = runOf(trip);
              return (
                <article key={trip.schedule.id} className={"my-trip" + (isOpen ? " open" : "")}>
                  <button
                    type="button"
                    className="my-trip-head"
                    aria-expanded={isOpen}
                    onClick={() => {
                      setOpenId(isOpen ? null : trip.schedule.id);
                      setError("");
                      setOdometer("");
                    }}
                  >
                    <span>
                      <b>{dateLabel(trip.schedule.date)}</b> · {vehicleName(trip.revision.plate)} {trip.revision.plate}
                      <small>
                        Driver {trip.revision.driverName} · {trip.revision.legs[0]?.origin} →{" "}
                        {trip.revision.legs.map((leg) => leg.destinationName).join(" → ")}
                      </small>
                    </span>
                    <span className={"status-pill " + pill}>{label}</span>
                  </button>
                  {isOpen && (
                    <div className="my-trip-body">
                      <ol className="my-trip-steps">
                        {steps.map((step) => (
                          <li key={step.key} className={step.at ? "done" : step === next ? "next" : ""}>
                            <span>{step.label}</span>
                            <small>{step.at ? timeLabel(step.at) : ""}</small>
                          </li>
                        ))}
                      </ol>
                      {run && (
                        <p className="helper">
                          Starting odometer: <b>{run.startOdometer} km</b>
                          {run.endOdometer !== undefined && (
                            <>
                              {" "}
                              · Ending: <b>{run.endOdometer} km</b> ({run.endOdometer - run.startOdometer} km)
                            </>
                          )}
                        </p>
                      )}
                      {next && trip.schedule.date > today && <p className="helper">Start trip opens on {dateLabel(trip.schedule.date)}.</p>}
                      {next && trip.schedule.date <= today && (
                        <div className="my-trip-action">
                          {(next.kind === "START" || next.kind === "END") && (
                            <label className="field">
                              <span>{next.kind === "START" ? "Starting odometer (km)" : "Ending odometer (km)"}</span>
                              <Input
                                inputMode="numeric"
                                placeholder={next.kind === "START" ? "e.g. 48215" : run ? `At least ${run.startOdometer}` : ""}
                                value={odometer}
                                onChange={(event) => setOdometer(event.target.value)}
                              />
                            </label>
                          )}
                          <Button className="primary trip-step-button" disabled={busy} onClick={() => tap(trip, next)}>
                            {busy ? "Saving…" : next.label}
                          </Button>
                        </div>
                      )}
                      {locationOff && next && (
                        <p className="notice" role="alert">
                          Your location is off. Turn it on for this site, then keep going.
                        </p>
                      )}
                      {error && (
                        <p className="modal-error" role="alert">
                          {error}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <Car size={30} />
            </div>
            <h3>No trips yet</h3>
            <p>Your Company trips appear here once an Admin approves them.</p>
          </div>
        )}
      </section>
    </>
  );
}
