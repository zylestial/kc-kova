"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCompanyTrip, createSchedule, hydrateKovaData, moveRequestDay, saveScheduleDraft, type TransportRequest } from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { useAutoClear } from "@/lib/use-auto-clear";
import { planOn, planOptions, type PlanContext, type PlanOption } from "@/lib/scheduling-plan";
import { addDays, manilaToday } from "@/lib/timezone";
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
import { dateLabel, fullDate } from "./planner/format";
import StopCard, { whatText } from "./scheduler/stop-card";
import StopSheet from "./scheduler/stop-sheet";
import PlanOptions from "./scheduler/plan-options";
import VehicleCard from "./scheduler/vehicle-card";

const shortDay = (day: string) => dateLabel(day, { weekday: "short", month: "short", day: "numeric" });

const KINDS: Record<TripKind, { label: string; hint: string }> = {
  DAILY: { label: "Daily trips", hint: "Vehicles with their own Driver; each trip starts and ends at ANONANG." },
  COMPANY: {
    label: "Company trips",
    hint: "Vehicles that can be requested for company trips, with the Driver each requester picked.",
  },
};

/**
 * Scheduling (prototype "KOVA Scheduler"), in three steps: pick the day,
 * pick Daily or Company trips, then plan. The planner lists what's still
 * to plan on the left (Urgent first, grouped by place, plus the week's "any
 * day" stops) and that kind's vehicles on the right.
 */
export default function Scheduling({
  initialDate,
  initialKind,
  onStep,
}: {
  initialDate?: string;
  initialKind?: TripKind;
  /** Keeps the address in step, so a refresh or a link opens the same place. */
  onStep: (date: string, kind?: TripKind) => void;
}) {
  const { requests, schedules, vehicles, accounts, attendance, companyRuns, options } = useKovaData();
  const today = manilaToday();
  const [day, setDay] = useState(initialDate && initialDate >= today ? initialDate : today);
  const [kind, setKind] = useState<TripKind | undefined>(initialKind);
  const [step, setStep] = useState(initialDate && initialKind ? 3 : 1);
  const [openPlates, setOpenPlates] = useState<Set<string>>(new Set());
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
  }, [day, step]);

  const days = weekDays(day);
  const rows = vehicleRows(vehicles, accounts, schedules, day).filter((row) => row.kind === kind);
  const stops = kind ? toPlan(requests, day, kind) : [];
  const week = kind ? weekStops(requests, day, kind) : [];
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
      setOpenPlates(new Set([...openPlates, option.row.vehicle.plate]));
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

  function goTo(next: number, nextDay = day, nextKind = kind) {
    setStep(next);
    onStep(nextDay, next === 3 ? nextKind : undefined);
  }
  function toggle(plate: string) {
    const next = new Set(openPlates);
    if (next.has(plate)) next.delete(plate);
    else next.add(plate);
    setOpenPlates(next);
  }

  return (
    <div className="scheduling">
      <div className="booking-steps">
        {["Choose day", "Daily or Company", "Plan"].map((label, index) => (
          <Fragment key={label}>
            {index > 0 && <i />}
            <span className={step === index + 1 ? "current" : ""}>
              {index + 1} <b>{label}</b>
            </span>
          </Fragment>
        ))}
      </div>
      {step > 1 && (
        // Not "Back": on phones the top bar has its own Back, which leaves the screen.
        <Button variant="ghost" className="booking-back" onClick={() => goTo(step - 1)}>
          <ArrowLeft size={16} /> {step === 2 ? "Change day" : "Change type"}
        </Button>
      )}
      <div className="page-heading">
        <div>
          <div className="eyebrow">SCHEDULER</div>
          <h1>
            {step === 1 ? "Which day are you planning?" : step === 2 ? "What are you planning?" : KINDS[kind!].label}
            <span className="title-dot">.</span>
          </h1>
          {step > 1 && <p>{fullDate(day)}</p>}
        </div>
      </div>

      {step === 1 && (
        <>
          <div className="sc-days" ref={strip}>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              disabled={days[0] <= today}
              onClick={() => setDay(addDays(days[0], -7) < today ? today : addDays(days[0], -7))}
            >
              <ChevronLeft size={18} />
            </Button>
            {days.map((item) => {
              const counts = dayCounts(requests, item);
              return (
                <button
                  key={item}
                  type="button"
                  className={"sc-day" + (item === day ? " on" : "")}
                  aria-pressed={item === day}
                  disabled={item < today}
                  onClick={() => setDay(item)}
                >
                  <b>{item === today ? `Today · ${dateLabel(item, { month: "short", day: "numeric" })}` : shortDay(item)}</b>
                  <span>
                    {counts.toPlan ? `${counts.toPlan} to plan` : "All planned"}
                    {counts.urgent > 0 && <span className="sc-urgent-count"> · {counts.urgent} urgent</span>}
                  </span>
                </button>
              );
            })}
            <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setDay(addDays(days[0], 7))}>
              <ChevronRight size={18} />
            </Button>
            <label className="sc-jump">
              Jump to date{" "}
              <Input type="date" min={today} value={day} onChange={(event) => event.target.value >= today && setDay(event.target.value)} />
            </label>
          </div>
          {otherDays.length > 0 && (
            <div className="date-waiting-elsewhere">
              <span>Also waiting:</span>
              {otherDays.slice(0, 5).map((other) => (
                <Button key={other} variant="outline" size="sm" onClick={() => setDay(other)}>
                  {shortDay(other)}
                </Button>
              ))}
            </div>
          )}
          <div className="sc-continue">
            <Button className="primary" onClick={() => goTo(2)}>
              Continue — {shortDay(day)}
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="request-choice-cards sc-kinds" role="radiogroup" aria-label="Trip type">
            {(Object.keys(KINDS) as TripKind[]).map((value) => {
              const counts = dayCounts(requests, day, value);
              const week = weekStops(requests, day, value).length;
              const planned = tripsOfKind(value);
              return (
                <label key={value} className={kind === value ? "checked" : ""}>
                  <input type="radio" name="trip-kind" checked={kind === value} onChange={() => setKind(value)} />
                  <span>
                    {KINDS[value].label}
                    <small>{KINDS[value].hint}</small>
                    <small className="sc-kind-counts">
                      {counts.toPlan ? `${counts.toPlan} to plan` : "Nothing waiting this day"}
                      {counts.urgent > 0 && <span className="sc-urgent-count"> · {counts.urgent} urgent</span>}
                      {week > 0 && ` · ${week} any day this week`}
                      {` · ${planned} ${planned === 1 ? "trip" : "trips"} planned`}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="sc-continue">
            <Button className="primary" disabled={!kind} onClick={() => goTo(3)}>
              Continue{kind ? ` — ${KINDS[kind].label}` : ""}
            </Button>
          </div>
        </>
      )}

      {step === 3 && kind && (
        <>
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
              {stops.length ? ` · ${stops.length} to plan` : " · all planned"}
            </span>
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
              <p className="sc-hint">Drag a request onto a vehicle to add it, or tap it to see the options.</p>
              {rows.map((row) => (
                <VehicleCard
                  key={row.vehicle.plate}
                  row={row}
                  open={openPlates.has(row.vehicle.plate)}
                  onToggle={() => toggle(row.vehicle.plate)}
                  isToday={day === today}
                  now={now}
                  requests={requests}
                  started={started}
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
        </>
      )}

      <StopSheet stops={sheetStops} onClose={() => setSheetIds([])}>
        {kind && sheetStops.length > 0 && (
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
