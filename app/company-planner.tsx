"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Link2, Save, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createCompanyTrip,
  discardScheduleDraft,
  hydrateKovaData,
  moveRequestDay,
  saveScheduleDraft,
  sendBackRequests,
  submitSchedule,
  type Schedule,
  type TransportRequest,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { addDays, manilaToday } from "@/lib/timezone";
import { flexibilityShort } from "@/lib/request-draft";
import { openRevision, scheduleState, scheduleStateLabel, scheduleStatePill } from "@/lib/trip-record";
import {
  MAX_TRIP_LEGS,
  canShareTrip,
  companyStops,
  companyTripsOn,
  estimateLegs,
  legProblems,
  linkedRuns,
  overlaps,
  stopNumber,
  timelinePercent,
  toMinutes,
  toTime,
  tripInput,
  tripSpan,
  waitingStops,
  type TripLeg,
} from "@/lib/company-trips";
import { moveDays } from "./planner/pool-panel";
import { dateLabel, fullDate } from "./planner/format";

/** The trip being planned: a new one, or a saved one (its open version's row version, null to propose a revision). */
type Editor = { scheduleId?: string; rowVersion: number | null; legs: TripLeg[] };

const shortDay = (day: string) => dateLabel(day, { weekday: "short", month: "short", day: "numeric" });
const clock = (time: string) => {
  const minutes = toMinutes(time);
  return `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${minutes < 720 ? "AM" : "PM"}`;
};

/**
 * Company trip planner (Company Trip Flow prototype, "Plan"): a day's
 * Company Trip stops on the left, most urgent first, with 🔗 on stops
 * requested together; each company trip vehicle on the right with its
 * trips on a timeline. A trip takes the vehicle and Driver the requester
 * picked, starts at the starting point, and doesn't return to ANONANG.
 * Several trips a day may share a vehicle as long as their times don't
 * overlap; every rule is rechecked by the database (0054).
 */
export default function CompanyPlanner({ initialDate, openTripId }: { initialDate?: string; openTripId?: string }) {
  const { requests, schedules, vehicles, accounts } = useKovaData();
  const today = manilaToday();
  const opened = openTripId ? schedules.find((item) => item.id === openTripId) : undefined;
  const [date, setDate] = useState(() => initialDate ?? opened?.date ?? today);
  const [editor, setEditor] = useState<Editor | null>(() => (opened ? editorFor(opened) : null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);
  const [sendingBack, setSendingBack] = useState<{ id: string; reason: string } | null>(null);
  useUnsavedChanges("company-planner", !!editor && !editor.scheduleId && editor.legs.length > 0);

  const stops = companyStops(requests, date);
  const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
  const inEditor = new Set(editor?.legs.map((leg) => leg.requestId));
  const waiting = waitingStops(stops).filter((stop) => !inEditor.has(stop.id));
  const trips = companyTripsOn(schedules, date);
  const plates = [
    ...new Set([
      ...vehicles.filter((vehicle) => vehicle.status === "Active" && vehicle.companyTrips).map((vehicle) => vehicle.plate),
      ...trips.map((trip) => trip.revision.plate),
      ...stops.map((stop) => stop.group?.vehiclePlate ?? ""),
    ]),
  ].filter(Boolean);
  const otherDays = [
    ...new Set(
      requests
        .filter(
          (request) =>
            request.group?.form === "COMPANY" &&
            request.status === "ACTIVE" &&
            request.progress === "NOT_YET_SCHEDULED" &&
            request.date >= today &&
            request.date !== date,
        )
        .map((request) => request.date),
    ),
  ].sort();

  const editorStops = editor?.legs.map((leg) => stopsById.get(leg.requestId)).filter((stop): stop is TransportRequest => !!stop) ?? [];
  const first = editorStops[0];
  const editorPlate = first?.group?.vehiclePlate ?? "";
  // More stops this trip could take: waiting ones with the same vehicle, Driver, department and starting point.
  const candidates = first ? waiting.filter((stop) => canShareTrip(first, stop)) : [];
  const span = editor ? tripSpan(editor.legs) : null;
  const clashes =
    editor && span
      ? trips.filter((trip) => {
          const other = tripSpan(trip.revision.legs);
          return trip.schedule.id !== editor.scheduleId && trip.revision.plate === editorPlate && other && overlaps(span, other);
        })
      : [];
  const problems = editor
    ? [
        ...legProblems(editor.legs, editorStops),
        ...clashes.map((trip) => {
          const other = tripSpan(trip.revision.legs)!;
          return `${editorPlate} already has a trip ${clock(other.start)}–${clock(other.end)}. Change the times.`;
        }),
      ]
    : [];

  function editorFor(schedule: Schedule): Editor | null {
    const open = openRevision(schedule);
    if (open?.status === "SUBMITTED") return null;
    const revision = open ?? schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
    if (!revision) return null;
    // One leg per stop: find each leg's request by its stop.
    const requestOf = new Map(
      requests.flatMap((request) => request.destinations.map((destination) => [destination.id, request.id] as const)),
    );
    return {
      scheduleId: schedule.id,
      rowVersion: open ? open.rowVersion : null,
      legs: revision.legs
        .filter((leg) => leg.stops.length)
        .map((leg) => ({ requestId: requestOf.get(leg.stops[0]) ?? "", plannedTimeOut: leg.plannedTimeOut, plannedTimeIn: leg.plannedTimeIn }))
        .filter((leg) => leg.requestId),
    };
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  function pickDate(day: string) {
    setDate(day);
    setEditor(null);
    setError("");
    setSendingBack(null);
  }

  // Starts a trip with this stop and any waiting stops requested together with it that can share it.
  function plan(stop: TransportRequest) {
    const together = waiting.filter((other) => other.group?.id === stop.group?.id && canShareTrip(stop, other));
    const picked = together.length ? [stop, ...together.filter((other) => other.id !== stop.id)] : [stop];
    setEditor({ rowVersion: null, legs: estimateLegs(picked) });
    setError("");
  }

  function setLeg(index: number, patch: Partial<TripLeg>) {
    if (!editor) return;
    setEditor({ ...editor, legs: editor.legs.map((leg, position) => (position === index ? { ...leg, ...patch } : leg)) });
  }

  function addStop(stop: TransportRequest) {
    if (!editor) return;
    const last = editor.legs.at(-1);
    const out = last?.plannedTimeIn ? toMinutes(last.plannedTimeIn) + 30 : 8 * 60;
    setEditor({ ...editor, legs: [...editor.legs, { requestId: stop.id, plannedTimeOut: toTime(out), plannedTimeIn: toTime(out + 30) }] });
  }

  function moveLeg(index: number, by: number) {
    if (!editor) return;
    const legs = [...editor.legs];
    [legs[index], legs[index + by]] = [legs[index + by], legs[index]];
    setEditor({ ...editor, legs });
  }

  // Saves the trip as a draft; returns its id and open version's row version.
  async function saveTrip() {
    if (!editor) throw Error("Nothing to save.");
    const input = tripInput(date, editorPlate, editorStops, editor.legs);
    const saved = editor.scheduleId
      ? await saveScheduleDraft(editor.scheduleId, editor.rowVersion, input)
      : await createCompanyTrip(input);
    const open = openRevision(saved);
    if (!open) throw Error("The trip was saved, but couldn't be reloaded. Open it again from Schedules.");
    setEditor({ ...editor, scheduleId: saved.id, rowVersion: open.rowVersion });
    return { id: saved.id, rowVersion: open.rowVersion };
  }

  const save = () =>
    run(async () => {
      await saveTrip();
      setNotice("Trip saved as a draft. Its stops and time on the vehicle are held until you submit or discard it.");
    });
  const submit = () =>
    run(async () => {
      const saved = await saveTrip();
      await submitSchedule(saved.id, saved.rowVersion);
      setEditor(null);
      setNotice("Trip submitted. An Admin will review and approve it.");
    });
  const submitSaved = (schedule: Schedule) =>
    run(async () => {
      const open = openRevision(schedule);
      if (!open) return;
      await submitSchedule(schedule.id, open.rowVersion);
      setNotice("Trip submitted. An Admin will review and approve it.");
    });
  const discard = (schedule: Schedule) =>
    run(async () => {
      const open = openRevision(schedule);
      if (!open) return;
      await discardScheduleDraft(schedule.id, open.rowVersion);
      if (editor?.scheduleId === schedule.id) setEditor(null);
      setNotice(schedule.publishedRevisionId ? "Changes discarded. The approved trip stays as it was." : "Trip discarded. Its stops are waiting again.");
    });
  const sendBack = () =>
    run(async () => {
      if (!sendingBack) return;
      await sendBackRequests([sendingBack.id], sendingBack.reason.trim());
      const stop = stopsById.get(sendingBack.id);
      setSendingBack(null);
      setNotice(`${stop ? stopNumber(stop) : "The stop"} was sent back to ${stop?.ownerName ?? "its requester"} to pick another day.`);
    });
  const move = (stop: TransportRequest, day: string) =>
    run(async () => {
      await moveRequestDay(stop.id, day);
      setNotice(`${stopNumber(stop)} moved to ${shortDay(day)}. ${stop.ownerName} was told.`);
    });

  const vehicleName = (plate: string) => vehicles.find((vehicle) => vehicle.plate === plate)?.name ?? plate;
  const positionOf = (accountId: string) => accounts.find((account) => account.id === accountId)?.position ?? "";
  const purposeOf = (stop: TransportRequest) =>
    stop.urgentReason ? `Urgent: ${stop.urgentReason.name}` : (stop.destinations[0]?.purposeName ?? "");

  function stopCard(stop: TransportRequest) {
    const days = stop.flexibility === "WEEK" ? moveDays(stop, today) : [];
    const backing = sendingBack?.id === stop.id;
    return (
      <div key={stop.id} className={"cp-card" + (stop.requestType === "URGENT" ? " urgent" : "")}>
        <div className="cp-card-top">
          <b>{stopNumber(stop)}</b>
          <span>{stop.ownerName}</span>
          {stop.requestType === "URGENT" && <span className="badge urgent">URGENT</span>}
        </div>
        <small>
          {stop.group?.department?.name} · {positionOf(stop.ownerAccountId) || "—"}
        </small>
        <div>
          From {stop.group?.startingPoint?.name ?? "—"} → <b>{stop.destinations[0]?.destinationName}</b>
        </div>
        <small>
          {purposeOf(stop)}
          {stop.details && ` – ${stop.details}`}
        </small>
        <small>
          <span className={"status-pill " + (stop.flexibility === "FIXED" ? "pending" : "info")}>
            {flexibilityShort(stop.group?.date ?? stop.date, stop.flexibility, stop.fixedTime ?? "")}
          </span>{" "}
          {vehicleName(stop.group?.vehiclePlate ?? "")} · Driver {stop.group?.driver?.name ?? "—"}
        </small>
        {stop.supplier && <small>Supplier: {stop.supplier.name}</small>}
        {backing ? (
          <div className="cp-send-back">
            <Input
              aria-label={`Why ${stopNumber(stop)} is sent back`}
              placeholder="e.g. The Mirage is fully booked that day"
              maxLength={500}
              value={sendingBack.reason}
              onChange={(event) => setSendingBack({ id: stop.id, reason: event.target.value })}
            />
            <div className="cp-actions">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setSendingBack(null)}>
                Cancel
              </Button>
              <Button size="sm" className="danger" disabled={busy} onClick={sendBack}>
                Send back
              </Button>
            </div>
          </div>
        ) : (
          <div className="cp-actions">
            {days.length > 0 && (
              <Select value="" disabled={busy} onValueChange={(day) => move(stop, day)}>
                <SelectTrigger size="sm" aria-label={`Move ${stopNumber(stop)} to another day`} className="cp-move">
                  <SelectValue placeholder="Move to…" />
                </SelectTrigger>
                <SelectContent>
                  {days.map((day) => (
                    <SelectItem key={day} value={day}>
                      {shortDay(day)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setSendingBack({ id: stop.id, reason: "" })}>
              Send back
            </Button>
            {editor && first && canShareTrip(first, stop) ? (
              <Button size="sm" className="primary" disabled={busy || editor.legs.length >= MAX_TRIP_LEGS} onClick={() => addStop(stop)}>
                Add to this trip
              </Button>
            ) : (
              <Button size="sm" className="primary" disabled={busy || !!editor} onClick={() => plan(stop)}>
                Plan
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="company-planner">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SCHEDULER</div>
          <h1>
            Company trips<span className="title-dot">.</span>
          </h1>
          <p>
            Each trip uses the vehicle and Driver the requester picked, starts at their starting point and ends at the last stop.
            A vehicle can make several trips a day, one department per trip, as long as the times don&apos;t overlap.
          </p>
        </div>
      </div>

      <div className="cp-day">
        <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => pickDate(addDays(date, -1))}>
          <ChevronLeft size={18} />
        </Button>
        <b>{fullDate(date)}</b>
        <Button variant="outline" size="icon" aria-label="Next day" onClick={() => pickDate(addDays(date, 1))}>
          <ChevronRight size={18} />
        </Button>
        <label className="cp-jump">
          Jump to date{" "}
          <Input type="date" value={date} onChange={(event) => event.target.value && pickDate(event.target.value)} />
        </label>
      </div>
      {otherDays.length > 0 && (
        <div className="date-waiting-elsewhere">
          <span>Also waiting:</span>
          {otherDays.slice(0, 5).map((day) => (
            <Button key={day} variant="outline" size="sm" onClick={() => pickDate(day)}>
              {shortDay(day)}
            </Button>
          ))}
        </div>
      )}

      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      <div className="cp-columns">
        <section className="cp-panel">
          <h2>
            To plan <span className="count">{waiting.length}</span>
          </h2>
          <p className="cp-hint">Most urgent first. 🔗 marks stops requested together.</p>
          <div className="cp-list">
            {linkedRuns(waiting).map((run) =>
              run.length > 1 ? (
                <div key={run[0].id} className="cp-linked">
                  <span className="cp-linked-label">
                    <Link2 size={14} /> Requested together · {run[0].ownerName} · #{run[0].group?.number}
                  </span>
                  {run.map(stopCard)}
                </div>
              ) : (
                stopCard(run[0])
              ),
            )}
            {!waiting.length && <p className="cp-hint">Nothing waiting for this day.</p>}
          </div>
        </section>

        <div className="cp-vehicles">
          {editor && (
            <section className="cp-panel cp-editor">
              <div className="cp-editor-head">
                <h2>{editor.scheduleId ? "Edit trip" : "New trip"}</h2>
                <Button variant="ghost" size="icon" aria-label="Close" disabled={busy} onClick={() => setEditor(null)}>
                  <X size={16} />
                </Button>
              </div>
              {first && (
                <p className="cp-hint">
                  {vehicleName(editorPlate)} · {editorPlate} · Driver {first.group?.driver?.name} · {first.group?.department?.name} ·
                  from {first.group?.startingPoint?.name}
                </p>
              )}
              <ol className="cp-legs">
                {editor.legs.map((leg, index) => {
                  const stop = stopsById.get(leg.requestId);
                  const origin = index ? stopsById.get(editor.legs[index - 1].requestId)?.destinations[0]?.destinationName : first?.group?.startingPoint?.name;
                  return (
                    <li key={leg.requestId}>
                      <div className="cp-leg-head">
                        <b>
                          Leg {index + 1}: {origin ?? "—"} → {stop?.destinations[0]?.destinationName}
                        </b>
                        <span>
                          <Button variant="ghost" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => moveLeg(index, -1)}>
                            <ArrowUp size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Move down" disabled={index === editor.legs.length - 1} onClick={() => moveLeg(index, 1)}>
                            <ArrowDown size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Take ${stop ? stopNumber(stop) : "this stop"} off the trip`}
                            disabled={editor.legs.length === 1}
                            onClick={() => setEditor({ ...editor, legs: editor.legs.filter((_, position) => position !== index) })}
                          >
                            <X size={14} />
                          </Button>
                        </span>
                      </div>
                      {stop && (
                        <small>
                          {stopNumber(stop)} · {purposeOf(stop)}
                          {stop.details && ` – ${stop.details}`} ·{" "}
                          {flexibilityShort(stop.group?.date ?? stop.date, stop.flexibility, stop.fixedTime ?? "")}
                        </small>
                      )}
                      <div className="cp-times">
                        <label className="field">
                          <span>Time Out</span>
                          <Input type="time" step={300} value={leg.plannedTimeOut} onChange={(event) => setLeg(index, { plannedTimeOut: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Time In</span>
                          <Input type="time" step={300} value={leg.plannedTimeIn} onChange={(event) => setLeg(index, { plannedTimeIn: event.target.value })} />
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {candidates.length > 0 && (
                <div className="leg-stops">
                  <span className="summary-label">Other stops this trip could take</span>
                  {candidates.map((stop) => (
                    <label key={stop.id}>
                      <Checkbox checked={false} disabled={editor.legs.length >= MAX_TRIP_LEGS} onCheckedChange={() => addStop(stop)} />
                      <span>
                        {stopNumber(stop)} · <b>{stop.ownerName}</b> — {stop.destinations[0]?.destinationName}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {problems.length > 0 && (
                <ul className="leg-warnings">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
              <div className="cp-actions">
                <Button variant="outline" disabled={busy || problems.length > 0} onClick={save}>
                  <Save size={16} /> Save draft
                </Button>
                <Button className="primary" disabled={busy || problems.length > 0} onClick={submit}>
                  <Send size={16} /> Submit for approval
                </Button>
              </div>
            </section>
          )}

          {plates.map((plate) => {
            const own = trips
              .filter((trip) => trip.revision.plate === plate)
              .sort((a, b) => (tripSpan(a.revision.legs)?.start ?? "").localeCompare(tripSpan(b.revision.legs)?.start ?? ""));
            return (
              <section key={plate} className="cp-panel">
                <div className="cp-vehicle-head">
                  <b>{vehicleName(plate)}</b> <span className="cp-plate">{plate}</span>
                  <span className="count">
                    {own.length} {own.length === 1 ? "trip" : "trips"}
                  </span>
                </div>
                <div className="cp-timeline" aria-hidden="true">
                  {own.map((trip) => {
                    const tripTime = tripSpan(trip.revision.legs);
                    if (!tripTime) return null;
                    const clash = own.some((other) => {
                      const otherTime = tripSpan(other.revision.legs);
                      return other !== trip && otherTime && overlaps(tripTime, otherTime);
                    });
                    return (
                      <i
                        key={trip.schedule.id}
                        className={clash ? "clash" : ""}
                        style={{ left: `${timelinePercent(tripTime.start)}%`, width: `${timelinePercent(tripTime.end) - timelinePercent(tripTime.start)}%` }}
                      />
                    );
                  })}
                  {editor && editorPlate === plate && span && (
                    <i
                      className="draft"
                      style={{ left: `${timelinePercent(span.start)}%`, width: `${timelinePercent(span.end) - timelinePercent(span.start)}%` }}
                    />
                  )}
                </div>
                <div className="cp-scale">
                  <span>6 AM</span>
                  <span>9</span>
                  <span>12 PM</span>
                  <span>3</span>
                  <span>7 PM</span>
                </div>
                <div className="cp-trips">
                  {own.map((trip, index) => {
                    const state = scheduleState(trip.schedule);
                    const tripTime = tripSpan(trip.revision.legs);
                    const firstStop = requests.find((request) => trip.revision.requestIds.includes(request.id));
                    const canEdit = state === "DRAFT" || state === "RETURNED" || state === "APPROVED";
                    return (
                      <div key={trip.schedule.id} className="cp-trip">
                        <div className="cp-card-top">
                          <b>
                            Trip {index + 1} · {firstStop?.group?.department?.name ?? "—"}
                          </b>
                          <span className={"status-pill " + scheduleStatePill[state]}>{scheduleStateLabel[state]}</span>
                        </div>
                        <small>
                          {tripTime ? `${clock(tripTime.start)}–${clock(tripTime.end)}` : "No times yet"} · Driver {trip.revision.driverName}
                        </small>
                        <ol className="cp-trip-legs">
                          {trip.revision.legs.map((leg) => (
                            <li key={leg.id}>
                              {leg.origin} → {leg.destinationName}
                            </li>
                          ))}
                        </ol>
                        {state === "RETURNED" && openRevision(trip.schedule)?.decisionComment && (
                          <small>
                            <b>Returned by Admin:</b> {openRevision(trip.schedule)?.decisionComment}
                          </small>
                        )}
                        <div className="cp-actions">
                          {(state === "DRAFT" || state === "RETURNED") && (
                            <Button variant="outline" size="sm" className="danger-outline" disabled={busy} onClick={() => discard(trip.schedule)}>
                              <Trash2 size={14} /> Discard
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy || !!editor}
                              onClick={() => {
                                setEditor(editorFor(trip.schedule));
                                setError("");
                              }}
                            >
                              {state === "APPROVED" ? "Propose a change" : "Edit"}
                            </Button>
                          )}
                          {(state === "DRAFT" || state === "RETURNED") && (
                            <Button size="sm" className="primary" disabled={busy} onClick={() => submitSaved(trip.schedule)}>
                              Submit
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {!own.length && <p className="cp-hint">No trips yet.</p>}
                </div>
              </section>
            );
          })}
          {!plates.length && (
            <p className="helper">No vehicle can be requested for company trips yet. An Admin ticks it in Settings, under Vehicles.</p>
          )}
        </div>
      </div>
    </div>
  );
}
