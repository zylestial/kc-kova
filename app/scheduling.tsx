"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKovaData } from "@/lib/use-kova-data";
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
} from "@/lib/scheduling";
import { dateLabel } from "./planner/format";
import StopCard, { whatText } from "./scheduler/stop-card";
import StopSheet from "./scheduler/stop-sheet";
import VehicleCard from "./scheduler/vehicle-card";

const shortDay = (day: string) => dateLabel(day, { weekday: "short", month: "short", day: "numeric" });

/**
 * Scheduling (prototype "KOVA Scheduler"): one page per day. The day strip
 * shows what's left to plan each day; Urgent stops get a banner; "To plan"
 * lists the day's waiting stops (grouped by place) and the week's "any day"
 * stops; every vehicle has a card with its trips that day. Daily and
 * Company trips are planned here alike.
 */
export default function Scheduling({ initialDate }: { initialDate?: string }) {
  const { requests, schedules, vehicles, accounts, attendance, companyRuns } = useKovaData();
  const today = manilaToday();
  const [day, setDay] = useState(initialDate && initialDate >= today ? initialDate : today);
  const [openPlates, setOpenPlates] = useState<Set<string>>(new Set());
  const [sheetIds, setSheetIds] = useState<string[]>([]);
  const strip = useRef<HTMLDivElement>(null);
  // On phones the strip scrolls; keep the chosen day in view.
  useEffect(() => {
    strip.current?.querySelector(".sc-day.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [day]);

  const days = weekDays(day);
  const stops = toPlan(requests, day);
  const week = weekStops(requests, day).filter((stop) => !stops.includes(stop));
  const urgent = stops.filter((stop) => stop.requestType === "URGENT");
  const rows = vehicleRows(vehicles, accounts, schedules, day);
  const trips = rows.flatMap((row) => row.trips);
  const started = (scheduleId: string) =>
    attendance.some((item) => item.scheduleId === scheduleId && item.start) || companyRuns.some((run) => run.scheduleId === scheduleId);
  const waitingForAdmin = trips.filter((trip) => isLocked(tripState(trip.schedule, started(trip.schedule.id))));
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
  const sheetStops = sheetIds.flatMap((id) => requests.filter((request) => request.id === id));

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
          <div className="eyebrow">SCHEDULER</div>
          <h1>
            Scheduling<span className="title-dot">.</span>
          </h1>
        </div>
      </div>

      <div className="sc-days" ref={strip}>
        <Button variant="outline" size="icon" aria-label="Previous week" disabled={days[0] <= today} onClick={() => setDay(addDays(days[0], -7) < today ? today : addDays(days[0], -7))}>
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
          Jump to date <Input type="date" min={today} value={day} onChange={(event) => event.target.value >= today && setDay(event.target.value)} />
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

      <div className="sc-columns">
        <section className="sc-panel">
          <h2>
            To plan · {day === today ? "today" : shortDay(day)} <span className="count">{stops.length}</span>
          </h2>
          <div className="sc-list">
            {placeGroups(stops).map((group) =>
              group.length > 1 ? (
                <div key={group[0].id} className="sc-group">
                  <div className="sc-group-head">
                    <b>
                      {group[0].destinations[0]?.destinationName} · {group.length} stops
                    </b>
                    <Button size="sm" className="primary" onClick={() => setSheetIds(group.map((stop) => stop.id))}>
                      Plan together
                    </Button>
                  </div>
                  {group.map((stop) => (
                    <StopCard key={stop.id} stop={stop} inGroup onOpen={setSheetIds} />
                  ))}
                </div>
              ) : (
                <StopCard key={group[0].id} stop={group[0]} onOpen={setSheetIds} />
              ),
            )}
            {!stops.length && <p className="sc-empty">All planned.</p>}
          </div>
          <div className="sc-section">Any day this week ({week.length})</div>
          <div className="sc-list">
            {week.map((stop) => (
              <StopCard key={stop.id} stop={stop} onOpen={setSheetIds} />
            ))}
            {!week.length && <p className="sc-empty">None.</p>}
          </div>
        </section>

        <section className="sc-vehicles" aria-label="Vehicles">
          {rows.map((row) => (
            <VehicleCard
              key={row.vehicle.plate}
              row={row}
              open={openPlates.has(row.vehicle.plate)}
              onToggle={() => toggle(row.vehicle.plate)}
              isToday={day === today}
              now={manilaHhmm(new Date().toISOString())}
              requests={requests}
              started={started}
            />
          ))}
        </section>
      </div>

      <StopSheet stops={sheetStops} onClose={() => setSheetIds([])} />
    </div>
  );
}
