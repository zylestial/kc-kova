"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createCompanyTrip,
  createSchedule,
  discardScheduleDraft,
  getSchedules,
  hydrateKovaData,
  moveRequestDay,
  saveScheduleDraft,
  submitSchedule,
  type TransportRequest,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { useAutoClear } from "@/lib/use-auto-clear";
import { planOn, planOptions, type PlanContext, type PlanOption } from "@/lib/scheduling-plan";
import { undoEntry, undoStep, type UndoEntry } from "@/lib/scheduling-undo";
import { currentRevision, openRevision } from "@/lib/trip-record";
import { addDays, manilaToday } from "@/lib/timezone";
import { manilaHhmm } from "@/lib/stop-times";
import {
  dayCounts,
  isWaiting,
  placeGroups,
  stopNumber,
  toPlan,
  tripState,
  vehicleRows,
  weekStops,
  type TripKind,
} from "@/lib/scheduling";
import { dateLabel, fullDate } from "./planner/format";
import StopCard, { whatText } from "./scheduler/stop-card";
import StopSheet from "./scheduler/stop-sheet";
import PlanOptions from "./scheduler/plan-options";
import VehicleCard from "./scheduler/vehicle-card";
import TripEditor from "./scheduler/trip-editor";

const shortDay = (day: string) => dateLabel(day, { weekday: "short", month: "short", day: "numeric" });

/** Days in the date strip, from its first day. */
const STRIP_DAYS = 14;

const KINDS: Record<TripKind, string> = { DAILY: "Daily trips", COMPANY: "Company trips" };

/**
 * Scheduling (prototype "KOVA Scheduler"): the day strip, then Daily trips
 * or Company trips, then that kind's Urgent banners, what's still to plan
 * (Urgent first, grouped by place, plus the week's "any day" stops) and its
 * vehicles. Stops are dragged onto a vehicle, or tapped for the options.
 */
export default function Scheduling({
  initialDate,
  initialKind,
  initialTripId,
  onChange,
}: {
  initialDate?: string;
  initialKind?: TripKind;
  /** A trip to show: its vehicle opens, scrolls into view and is highlighted for a moment. */
  initialTripId?: string;
  /** Keeps the address in step, so a refresh or a link opens the same day and kind. */
  onChange: (date: string, kind: TripKind) => void;
}) {
  const { requests, schedules, vehicles, accounts, attendance, companyRuns, stopTaps, options } = useKovaData();
  const today = manilaToday();
  const [day, setDay] = useState(initialDate && initialDate >= today ? initialDate : today);
  const [kind, setKind] = useState<TripKind>(initialKind ?? "DAILY");
  // The strip's first day: today, or the chosen day when it's further out.
  const [anchor, setAnchor] = useState(() => (day >= addDays(today, STRIP_DAYS) ? day : today));
  // The vehicle of the trip a link (a notification, Edit) asked for.
  const [flashPlate, setFlashPlate] = useState(() => {
    const trip = schedules.find((schedule) => schedule.id === initialTripId);
    return trip ? currentRevision(trip)?.plate : undefined;
  });
  // Vehicle cards start folded; one opens on a click, when something is added to it, or when a link names its trip.
  const [openPlates, setOpenPlates] = useState<Set<string>>(() => new Set(flashPlate ? [flashPlate] : []));
  const [sheetIds, setSheetIds] = useState<string[]>([]);
  // The stops being dragged onto a vehicle.
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Changes that can be undone, the last one last.
  const [undos, setUndos] = useState<UndoEntry[]>([]);
  useAutoClear(notice, setNotice);
  const strip = useRef<HTMLDivElement>(null);
  // On phones the strip scrolls; keep the chosen day in view.
  useEffect(() => {
    strip.current?.querySelector(".date-card.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [day]);
  useEffect(() => {
    if (!flashPlate) return;
    document.querySelector(`.sc-vehicle[data-plate="${CSS.escape(flashPlate)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFlashPlate(undefined), 2500);
    return () => clearTimeout(timer);
  }, [flashPlate]);

  const days = Array.from({ length: STRIP_DAYS }, (_, index) => addDays(anchor, index));
  // "October 2026", or "October 2026 – November 2026" when the strip runs into the next month.
  const months = [...new Set(days.map((item) => dateLabel(item, { month: "long", year: "numeric" })))];
  const rows = vehicleRows(vehicles, accounts, schedules, day).filter((row) => row.kind === kind);
  const stops = toPlan(requests, day, kind);
  const week = weekStops(requests, day, kind);
  const urgent = stops.filter((stop) => stop.requestType === "URGENT");
  const trips = rows.flatMap((row) => row.trips);
  const started = (scheduleId: string) =>
    attendance.some((item) => item.scheduleId === scheduleId && item.start) || companyRuns.some((run) => run.scheduleId === scheduleId);
  const waitingForAdmin = trips.filter((trip) => isWaiting(tripState(trip.schedule, started(trip.schedule.id))));
  const tripsOfKind = (of: TripKind) =>
    schedules.filter((schedule) => schedule.status === "ACTIVE" && schedule.date === day && schedule.kind === of).length;
  const vehicleName = (plate: string) => vehicles.find((vehicle) => vehicle.plate === plate)?.name ?? plate;
  // Days outside this week that still have stops waiting.
  const otherDays = [
    ...new Set(
      requests
        .filter((request) => request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED" && request.date >= today)
        .map((request) => request.date),
    ),
  ]
    .filter((other) => !days.includes(other))
    .sort();
  const stopsOf = (ids: string[]) => ids.flatMap((id) => requests.filter((request) => request.id === id));
  const sheetStops = stopsOf(sheetIds);
  const dragStops = dragIds ? stopsOf(dragIds) : [];
  const now = manilaHhmm(new Date().toISOString());
  const context: PlanContext = { requests, destinations: options.destinations, day, isToday: day === today, now, started };

  /**
   * Saves the stops onto a vehicle as the option says: a new trip, or the
   * trip it joins (draft changes for an approved one). An "any day that
   * week" stop asked for another day moves to this day first, and its
   * requester is told (0053).
   */
  async function add(option: PlanOption, stops: TransportRequest[]) {
    const name = option.row.vehicle.name;
    if (option.blocked) {
      setError(`Can't add to ${name}: ${option.blocked}.`);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const moved = stops.filter((stop) => stop.date !== day);
      const moves = moved.map((stop) => ({ id: stop.id, from: stop.date }));
      for (const stop of moved) await moveRequestDay(stop.id, day);
      if (option.trip) {
        const before = undoEntry(option.trip.schedule, kind, moves);
        await saveScheduleDraft(option.trip.schedule.id, option.rowVersion, option.input);
        setUndos((list) => [...list, before]);
      } else {
        const created = await (kind === "COMPANY" ? createCompanyTrip(option.input) : createSchedule(option.input));
        setUndos((list) => [...list, { scheduleId: created.id, kind, input: null, submitted: false, moves }]);
      }
      setSheetIds([]);
      setOpenPlates((plates) => new Set([...plates, option.row.vehicle.plate]));
      setNotice(
        `Added to ${name}.` +
          (moved.length ? " Requester notified of the new day." : "") +
          (option.needsAdmin ? " Saved as draft changes. Resubmit when ready." : "") +
          (option.takesBack ? " Taken back from the Admin. Resubmit when ready." : "") +
          (option.late.length ? ` ${option.late.length === 1 ? "1 stop" : `${option.late.length} stops`} will be late; change the times.` : ""),
      );
    } catch (caught) {
      setError((caught as Error).message);
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Runs a change to a trip, showing its message when it works and the
   * reason when it doesn't. `undo` is how the trip was before, for Undo;
   * "clear" for a change Undo can't take back (Submit, sent back).
   */
  async function run(action: () => Promise<string>, undo?: UndoEntry | "clear") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      if (undo === "clear") setUndos([]);
      else if (undo) setUndos((list) => [...list, undo]);
    } catch (caught) {
      setError((caught as Error).message);
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  /** Undo: puts the last changed trip back as it was, and moved stops back on their day. */
  function undoLast() {
    const entry = undos.at(-1);
    if (!entry) return;
    setUndos(undos.slice(0, -1));
    void run(async () => {
      const step = undoStep(
        entry,
        getSchedules().find((schedule) => schedule.id === entry.scheduleId),
      );
      if (step.action === "discard") await discardScheduleDraft(step.id, step.rowVersion);
      else if (step.action === "save") {
        const saved = await saveScheduleDraft(step.id, step.rowVersion, step.input);
        // The change took it back from the Admin: send it back to them.
        const open = entry.submitted ? openRevision(saved) : undefined;
        if (open) await submitSchedule(saved.id, open.rowVersion);
      }
      else if (step.action === "create") {
        // Made again under a new id: earlier entries for the trip follow it.
        const created = await (step.kind === "COMPANY" ? createCompanyTrip(step.input) : createSchedule(step.input));
        setUndos((list) => list.map((item) => (item.scheduleId === entry.scheduleId ? { ...item, scheduleId: created.id } : item)));
      }
      for (const move of entry.moves) await moveRequestDay(move.id, move.from);
      return "Undone." + (entry.moves.length ? " Requester notified of the day." : "");
    });
  }
  const fuel = options.destinations.filter((option) => option.isOtherStop && option.status === "Active");

  function pickDay(next: string) {
    if (next < anchor || next >= addDays(anchor, STRIP_DAYS)) setAnchor(next);
    setDay(next);
    onChange(next, kind);
  }
  function pickKind(next: TripKind) {
    setKind(next);
    setSheetIds([]);
    setError("");
    onChange(day, next);
  }
  function toggle(plate: string) {
    const next = new Set(openPlates);
    if (next.has(plate)) next.delete(plate);
    else next.add(plate);
    setOpenPlates(next);
  }

  return (
    <div className="scheduling">
      <div className="page-heading">
        <div>
          <h1>
            Scheduling<span className="title-dot">.</span>
          </h1>
        </div>
      </div>

      <div className="sc-month" aria-live="polite">
        {months.join(" – ")}
      </div>
      <div className="date-strip-wrap sc-strip">
        {anchor > today && (
          <Button
            variant="outline"
            size="icon"
            aria-label="Earlier dates"
            onClick={() => setAnchor(addDays(anchor, -7) < today ? today : addDays(anchor, -7))}
          >
            <ChevronLeft size={18} />
          </Button>
        )}
        <div className="date-strip" ref={strip}>
          {days.map((item) => {
            const counts = dayCounts(requests, item, kind);
            return (
              <button
                key={item}
                type="button"
                className={"date-card" + (item === day ? " selected" : "")}
                aria-pressed={item === day}
                aria-label={`${fullDate(item)}, ${counts.toPlan} waiting${counts.urgent ? `, ${counts.urgent} urgent` : ""}`}
                onClick={() => pickDay(item)}
              >
                <span>{dateLabel(item, { weekday: "short" })}</span>
                <b>{dateLabel(item, { day: "numeric" })}</b>
                <small>{counts.toPlan ? `${counts.toPlan} waiting` : "none"}</small>
                {counts.urgent > 0 && <small className="date-card-urgent">{counts.urgent} urgent</small>}
              </button>
            );
          })}
        </div>
        <Button variant="outline" size="icon" aria-label="Later dates" onClick={() => setAnchor(addDays(anchor, 7))}>
          <ChevronRight size={18} />
        </Button>
      </div>
      {otherDays.length > 0 && (
        <div className="date-waiting-elsewhere">
          <span>Also waiting:</span>
          {otherDays.slice(0, 5).map((other) => (
            <Button key={other} variant="outline" size="sm" onClick={() => pickDay(other)}>
              {shortDay(other)}
            </Button>
          ))}
        </div>
      )}

      <div className="sc-kinds" role="tablist" aria-label="Trip type">
        {(Object.keys(KINDS) as TripKind[]).map((value) => {
          const counts = dayCounts(requests, day, value);
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              className={"sc-kind" + (kind === value ? " on" : "")}
              onClick={() => pickKind(value)}
            >
              <b>{KINDS[value]}</b>
              <span>
                {counts.toPlan ? `${counts.toPlan} to plan` : "All planned"}
                {counts.urgent > 0 && <span className="sc-urgent-count"> · {counts.urgent} urgent</span>}
                {` · ${tripsOfKind(value)} ${tripsOfKind(value) === 1 ? "trip" : "trips"}`}
              </span>
            </button>
          );
        })}
      </div>

      {urgent.map((stop) => (
        <div key={stop.id} className="sc-banner">
          <span>
            <b>Urgent {stopNumber(stop)}</b> · {whatText(stop)} · {stop.destinations[0]?.destinationName}
            {stop.details && ` · ${stop.details}`} · {stop.projectName}
          </span>
          <Button className="danger" onClick={() => setSheetIds([stop.id])}>
            Fit it in
          </Button>
        </div>
      ))}
      {waitingForAdmin.map((trip) => (
        <div key={trip.schedule.id} className="sc-banner wait">
          <span>
            <b>{vehicleName(trip.revision.plate)}</b>: waiting for Admin
          </span>
        </div>
      ))}
      <div className="sc-banner info">
        <span>
          <b>{shortDay(day)}:</b> {trips.length} {trips.length === 1 ? "trip" : "trips"}
          {stops.length > urgent.length ? ` · ${stops.length - urgent.length} to plan` : " · all planned"}
        </span>
        {undos.length > 0 && (
          <Button size="sm" variant="outline" disabled={busy} onClick={undoLast}>
            Undo
          </Button>
        )}
      </div>
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

      <div className="sc-columns">
        <section className="sc-panel">
          <h2>
            To plan · {day === today ? "today" : shortDay(day)} <span className="count">{stops.length}</span>
          </h2>
          <div className="sc-list">
            {placeGroups(stops).map((group) =>
              group.length > 1 ? (
                <div
                  key={group[0].id}
                  className="sc-group"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", group.map((stop) => stop.id).join(","));
                    event.dataTransfer.effectAllowed = "move";
                    setDragIds(group.map((stop) => stop.id));
                  }}
                  onDragEnd={() => setDragIds(null)}
                >
                  <div className="sc-group-head">
                    <b>
                      {group[0].destinations[0]?.destinationName} · {group.length} stops
                    </b>
                    <Button size="sm" className="primary" onClick={() => setSheetIds(group.map((stop) => stop.id))}>
                      Plan together
                    </Button>
                  </div>
                  {group.map((stop) => (
                    <StopCard key={stop.id} stop={stop} inGroup onOpen={setSheetIds} onDrag={setDragIds} />
                  ))}
                </div>
              ) : (
                <StopCard key={group[0].id} stop={group[0]} onOpen={setSheetIds} onDrag={setDragIds} />
              ),
            )}
            {!stops.length && <p className="sc-empty">All planned.</p>}
          </div>
          <div className="sc-section">Any day this week ({week.length})</div>
          <div className="sc-list">
            {week.map((stop) => (
              <StopCard key={stop.id} stop={stop} onOpen={setSheetIds} onDrag={setDragIds} />
            ))}
            {!week.length && <p className="sc-empty">None.</p>}
          </div>
        </section>

        <section className="sc-vehicles" aria-label="Vehicles">
          <p className="sc-hint">
            Drag a request onto a vehicle to add it, or tap it to see the options. Drag a leg by ⠿ onto another leg to reorder.
          </p>
          {rows.map((row) => (
            <VehicleCard
              key={row.vehicle.plate}
              row={row}
              open={openPlates.has(row.vehicle.plate)}
              flash={row.vehicle.plate === flashPlate}
              onToggle={() => toggle(row.vehicle.plate)}
              started={started}
              renderTrip={(trip, state) => (
                <TripEditor
                  trip={trip}
                  state={state}
                  kind={kind}
                  day={day}
                  context={context}
                  waiting={[...stops, ...week]}
                  fuel={fuel}
                  busy={busy}
                  run={run}
                  doneLeg={(legId, isLast) =>
                    stopTaps.some((tap) => tap.legId === legId && tap.kind === "ARRIVE") ||
                    (isLast &&
                      (attendance.some((item) => item.scheduleId === trip.schedule.id && item.end) ||
                        companyRuns.some((item) => item.scheduleId === trip.schedule.id && item.endAt)))
                  }
                />
              )}
              drop={
                dragStops.length && !busy
                  ? (() => {
                      const option = planOn(dragStops, row, context);
                      return { blocked: option.blocked, onDrop: () => add(option, dragStops) };
                    })()
                  : undefined
              }
            />
          ))}
          {!rows.length && (
            <p className="sc-empty">
              {kind === "COMPANY" ? "No vehicle can be requested for company trips yet." : "No vehicles for Daily trips."}
            </p>
          )}
        </section>
      </div>

      <StopSheet stops={sheetStops} onClose={() => setSheetIds([])}>
        {sheetStops.length > 0 && (
          <>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <PlanOptions options={planOptions(sheetStops, rows, context)} stops={sheetStops} requests={requests} busy={busy} onAdd={(option) => add(option, sheetStops)} />
          </>
        )}
      </StopSheet>
    </div>
  );
}
