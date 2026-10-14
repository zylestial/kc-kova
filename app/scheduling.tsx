"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createCompanyTrip,
  createSchedule,
  getRequests,
  getSchedules,
  hydrateKovaData,
  moveRequestDay,
  saveScheduleDraft,
  type TransportRequest,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { useAutoClear } from "@/lib/use-auto-clear";
import { planOn, planOptions, type PlanContext, type PlanOption } from "@/lib/scheduling-plan";
import { manilaToday } from "@/lib/timezone";
import { manilaHhmm } from "@/lib/stop-times";
import {
  dayCounts,
  isLocked,
  placeGroups,
  stopNumber,
  toPlan,
  tripState,
  vehicleRows,
  weekDays,
  weekStops,
  type TripKind,
} from "@/lib/scheduling";
import { dateLabel } from "./planner/format";
import StopCard, { whatText } from "./scheduler/stop-card";
import StopSheet from "./scheduler/stop-sheet";
import PlanOptions from "./scheduler/plan-options";
import VehicleCard from "./scheduler/vehicle-card";
import TripEditor from "./scheduler/trip-editor";

const shortDay = (day: string) => dateLabel(day, { weekday: "short", month: "short", day: "numeric" });

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
  onChange,
}: {
  initialDate?: string;
  initialKind?: TripKind;
  /** Keeps the address in step, so a refresh or a link opens the same day and kind. */
  onChange: (date: string, kind: TripKind) => void;
}) {
  const { requests, schedules, vehicles, accounts, attendance, companyRuns, stopTaps, options } = useKovaData();
  const today = manilaToday();
  const [day, setDay] = useState(initialDate && initialDate >= today ? initialDate : today);
  const [kind, setKind] = useState<TripKind>(initialKind ?? "DAILY");
  // Vehicles with a trip start open, free ones folded; these were flipped by a click.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [sheetIds, setSheetIds] = useState<string[]>([]);
  // The stops being dragged onto a vehicle.
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useAutoClear(notice, setNotice);
  const strip = useRef<HTMLDivElement>(null);
  // On phones the strip scrolls; keep the chosen day in view.
  useEffect(() => {
    strip.current?.querySelector(".sc-day.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [day]);

  const days = weekDays(day);
  const rows = vehicleRows(vehicles, accounts, schedules, day).filter((row) => row.kind === kind);
  const stops = toPlan(requests, day, kind);
  const week = weekStops(requests, day, kind);
  const urgent = stops.filter((stop) => stop.requestType === "URGENT");
  const trips = rows.flatMap((row) => row.trips);
  const started = (scheduleId: string) =>
    attendance.some((item) => item.scheduleId === scheduleId && item.start) || companyRuns.some((run) => run.scheduleId === scheduleId);
  const waitingForAdmin = trips.filter((trip) => isLocked(tripState(trip.schedule, started(trip.schedule.id))));
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
      for (const stop of moved) await moveRequestDay(stop.id, day);
      if (option.trip) await saveScheduleDraft(option.trip.schedule.id, option.rowVersion, option.input);
      else if (kind === "COMPANY") await createCompanyTrip(option.input);
      else await createSchedule(option.input);
      setSheetIds([]);
      setNotice(
        `Added to ${name}.` +
          (moved.length ? " Requester notified of the new day." : "") +
          (option.needsAdmin ? " Saved in draft changes, not sent yet." : "") +
          (option.late.length ? ` ${option.late.length === 1 ? "1 stop" : `${option.late.length} stops`} will be late; change the times.` : ""),
      );
    } catch (caught) {
      setError((caught as Error).message);
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  /** Runs a change to a trip, showing its message when it works and the reason when it doesn't. */
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
    } catch (caught) {
      setError((caught as Error).message);
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  const fuel = options.destinations.filter((option) => option.isOtherStop && option.status === "Active");

  function pickDay(next: string) {
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
    const next = new Set(flipped);
    if (next.has(plate)) next.delete(plate);
    else next.add(plate);
    setFlipped(next);
  }

  /**
   * Plan for me: every stop still to plan this day goes on the best vehicle
   * that can take it (planOptions), Urgent and fixed times first, stops at
   * the same place together. Each is saved as a draft, so the Scheduler
   * checks the trips, changes what they like and submits.
   */
  const planForMe = () =>
    run(async () => {
      let placed = 0;
      const missed: string[] = [];
      for (const group of placeGroups(toPlan(getRequests(), day, kind))) {
        const fresh = getRequests();
        const waiting = group.flatMap((stop) => fresh.filter((item) => item.id === stop.id && item.progress === "NOT_YET_SCHEDULED"));
        if (!waiting.length) continue;
        const rowsNow = vehicleRows(vehicles, accounts, getSchedules(), day).filter((row) => row.kind === kind);
        const best = planOptions(waiting, rowsNow, { ...context, requests: fresh }).find((option) => !option.blocked);
        if (!best) {
          missed.push(...waiting.map((stop) => stopNumber(stop) || stop.ownerName));
          continue;
        }
        try {
          if (best.trip) await saveScheduleDraft(best.trip.schedule.id, best.rowVersion, best.input);
          else if (kind === "COMPANY") await createCompanyTrip(best.input);
          else await createSchedule(best.input);
          placed += waiting.length;
        } catch {
          missed.push(...waiting.map((stop) => stopNumber(stop) || stop.ownerName));
        }
      }
      return (
        `Planned ${placed} ${placed === 1 ? "stop" : "stops"} as drafts. Check the trips, then submit each one.` +
        (missed.length ? ` Couldn't fit ${missed.join(", ")}; drag ${missed.length === 1 ? "it" : "them"} onto a vehicle or send back.` : "")
      );
    });

  return (
    <div className="scheduling">
      <div className="page-heading">
        <div>
          <h1>
            Scheduling<span className="title-dot">.</span>
          </h1>
        </div>
      </div>

      <div className="sc-days" ref={strip}>
        {days.map((item) => {
          const counts = dayCounts(requests, item, kind);
          return (
            <button
              key={item}
              type="button"
              className={"sc-day" + (item === day ? " on" : "")}
              aria-pressed={item === day}
              disabled={item < today}
              onClick={() => pickDay(item)}
            >
              <b>{item === today ? `Today · ${dateLabel(item, { month: "short", day: "numeric" })}` : shortDay(item)}</b>
              <span>
                {counts.toPlan ? `${counts.toPlan} to plan` : "All planned"}
                {counts.urgent > 0 && <span className="sc-urgent-count"> · {counts.urgent} urgent</span>}
              </span>
            </button>
          );
        })}
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
            <Button size="sm" className="primary sc-plan-me" disabled={busy || !stops.length} onClick={planForMe}>
              <Sparkles size={14} /> {busy ? "Planning…" : "Plan for me"}
            </Button>
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
              open={(row.trips.length > 0) !== flipped.has(row.vehicle.plate)}
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
            <PlanOptions options={planOptions(sheetStops, rows, context)} stops={sheetStops} busy={busy} onAdd={(option) => add(option, sheetStops)} />
          </>
        )}
      </StopSheet>
    </div>
  );
}
