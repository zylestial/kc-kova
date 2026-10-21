"use client";
import { useMemo, useState } from "react";
import { Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  recordCompanyRun,
  recordCompanyStop,
  reportStop,
  type Schedule,
  type ScheduleRevision,
  type StopReportKind,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { useAutoClear } from "@/lib/use-auto-clear";
import { manilaToday } from "@/lib/timezone";
import { getPhoneLocation } from "@/lib/phone-location";
import { companyTripSteps, type CompanyStep } from "@/lib/company-trips";
import { routeChangedAt } from "@/lib/trip-record";
import { answerText, holdText, latestAnswer, missedLegs, stopChoices, stopReportLabel } from "@/lib/stop-reports";
import StopReportForm from "./stop-report-form";
import SavedTapsBanner from "./saved-taps-banner";

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
 * Driver drives; nothing goes into Attendance (0055). A problem at a stop
 * is reported here too (0061): a missed stop is passed over, and a vehicle
 * problem pauses the trip until Resume trip.
 */
export default function MyTrips({ accountId, initialOpenId }: { accountId: string; initialOpenId?: string }) {
  const { schedules, requests, vehicles, companyRuns, stopTaps, completions, problems } = useKovaData();
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
  /** The stop being reported (0061). */
  const [reportAt, setReportAt] = useState<{ legId: string; place: string } | null>(null);
  useAutoClear(notice, setNotice);

  const open = trips.find((trip) => trip.schedule.id === openId);
  const runOf = (trip: Trip) => companyRuns.find((run) => run.scheduleId === trip.schedule.id);
  const problemsOf = (trip: Trip) => problems.filter((item) => item.scheduleId === trip.schedule.id);
  const stepsOf = (trip: Trip) =>
    companyTripSteps(
      trip.revision.legs,
      runOf(trip),
      stopTaps.filter((tap) => tap.scheduleId === trip.schedule.id),
      new Set(missedLegs(problemsOf(trip)).keys()),
    );
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
    // With no signal the tap is saved on the phone with this moment's time (0077).
    const tappedAt = new Date().toISOString();
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
        const result = await recordCompanyRun(trip.schedule.id, { kind: step.kind, odometer: reading, location }, tappedAt);
        setOdometer("");
        if (step.kind === "END") {
          setNotice(result === "sent" ? "Trip ended and submitted. Thank you!" : "Trip ended. It submits when you have signal. Thank you!");
        }
      } else {
        await recordCompanyStop(trip.schedule.id, { legId: step.legId!, kind: step.kind, location }, tappedAt);
      }
      setLocationOff(!location);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    }
    setBusy(false);
  }

  async function sendStopReport(trip: Trip, report: { kind: StopReportKind; note: string; requestIds?: string[] }) {
    if (!reportAt) return;
    setBusy(true);
    setError("");
    try {
      const location = await getPhoneLocation();
      await reportStop(trip.schedule.id, { legId: reportAt.legId, ...report, location });
      setNotice("Reported. The Scheduler has been told; wait for their answer.");
      setReportAt(null);
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
      <SavedTapsBanner />
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
              const next = steps.find((step) => !step.at && !step.missed);
              const run = runOf(trip);
              const missed = missedLegs(problemsOf(trip));
              // The stop the next step is at (End trip is the last stop's arrival).
              const nextLeg = next?.legId ?? (next?.kind === "END" ? trip.revision.legs.at(-1)?.id : undefined);
              const onTheRoad = !!run && !run.endAt;
              // The Scheduler's latest answer to a stop report (0068).
              const answer = onTheRoad && !trip.schedule.pausedAt ? latestAnswer(problemsOf(trip)) : undefined;
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
                      setReportAt(null);
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
                      {routeChangedAt(trip.revision, run?.startAt) && (
                        <p className="notice" role="status">
                          Route changed by the Scheduler at {timeLabel(routeChangedAt(trip.revision, run?.startAt)!)}. Check your next stop.
                        </p>
                      )}
                      {answer && (
                        <p className="notice info" role="status">
                          <b>Scheduler&apos;s answer at {timeLabel(answer.decidedAt!)}:</b>{" "}
                          {answerText(answer, trip.revision.legs.find((leg) => leg.id === answer.legId)?.destinationName ?? "this stop")}
                        </p>
                      )}
                      <ol className="my-trip-steps">
                        {steps
                          .filter((step) => !(step.missed && step.kind === "LEAVE"))
                          .map((step) =>
                            step.missed ? (
                              <li key={step.key} className="missed">
                                <span>{step.label.replace("Arrived at ", "")}</span>
                                <small>{stopReportLabel(missed.get(step.legId!)!)}</small>
                              </li>
                            ) : (
                              <li key={step.key} className={step.at ? "done" : step === next ? "next" : ""}>
                                <span>{step.label}</span>
                                <small>{step.at ? timeLabel(step.at) : ""}</small>
                              </li>
                            ),
                          )}
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
                      {reportAt && (
                        <StopReportForm
                          place={reportAt.place}
                          stops={stopChoices(trip.revision.legs.find((leg) => leg.id === reportAt.legId), requests)}
                          busy={busy}
                          onCancel={() => {
                            setReportAt(null);
                            setError("");
                          }}
                          onSend={(report) => sendStopReport(trip, report)}
                        />
                      )}
                      {!reportAt && next && onTheRoad && trip.schedule.pausedAt && (
                        <p className="notice error trip-held" role="status">
                          {holdText(problemsOf(trip))}
                        </p>
                      )}
                      {!reportAt && next && trip.schedule.date <= today && !(onTheRoad && trip.schedule.pausedAt) && (
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
                          {onTheRoad && nextLeg && (
                            <button
                              type="button"
                              className="trip-step-report"
                              disabled={busy}
                              onClick={() => {
                                setReportAt({ legId: nextLeg, place: trip.revision.legs.find((leg) => leg.id === nextLeg)?.destinationName ?? "this stop" });
                                setError("");
                              }}
                            >
                              Problem here? Report it
                            </button>
                          )}
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
