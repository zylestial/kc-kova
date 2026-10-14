"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TransportRequest } from "@/lib/kova-api";
import { flexibilityShort } from "@/lib/request-draft";
import { addDays } from "@/lib/timezone";
import { dateLabel } from "./format";

type Props = {
  pool: TransportRequest[];
  /** Requests with a stop on this route. */
  placedIds: string[];
  today: string;
  busy: boolean;
  onMove: (request: TransportRequest, day: string) => void;
};

/** Monday to Saturday of the week a request was asked for, from today on, other than the day it's on. */
function moveDays(request: TransportRequest, today: string) {
  const asked = request.group?.date ?? request.date;
  const monday = addDays(asked, -((new Date(asked + "T12:00:00").getDay() + 6) % 7));
  return Array.from({ length: 6 }, (_, index) => addDays(monday, index)).filter(
    (day) => day >= today && day !== request.date,
  );
}

/**
 * The day's requests as the requesters sent them: each stop's urgency (and
 * why), purpose, details, how flexible it is and its contact, in pool order.
 * An "any day that week" stop not yet on the route can move to another day
 * of its week; the requester is told (0053).
 */
export default function PoolPanel({ pool, placedIds, today, busy, onMove }: Props) {
  if (!pool.length) return null;
  return (
    <section className="editor-panel">
      <div className="section-heading">
        <h2>Requests for this day</h2>
        <span className="count">{pool.length}</span>
      </div>
      <ul className="planner-pool">
        {pool.map((request) => {
          const placed = placedIds.includes(request.id);
          const destination = request.destinations[0];
          const number = request.group ? `${request.group.number}-${request.stopLetter}` : "";
          const days = request.flexibility === "WEEK" && !placed ? moveDays(request, today) : [];
          return (
            <li key={request.id} className={request.requestType === "URGENT" ? "urgent" : ""}>
              <div className="planner-pool-top">
                {number && <b>{number}</b>}
                <span>{request.ownerName}</span>
                {request.requestType === "URGENT" && <span className="badge urgent">URGENT</span>}
                <span className={"status-pill " + (placed ? "scheduled" : "pending")}>{placed ? "On this route" : "Not placed"}</span>
              </div>
              <div>
                <b>{request.destinations.map((item) => item.destinationName).join(" → ")}</b>
                {" — "}
                {request.urgentReason ? `Urgent: ${request.urgentReason.name}` : destination?.purposeName}
              </div>
              {request.details && <small>{request.details}</small>}
              <small>
                {request.group ? flexibilityShort(request.group.date, request.flexibility, request.fixedTime ?? "") : "Any time"}
                {request.movedAt && " · moved here by a Scheduler"}
                {request.contact && ` · Contact: ${request.contact}`}
              </small>
              {days.length > 0 && (
                <label className="planner-pool-move">
                  <span>Move to another day that week</span>
                  <Select value="" disabled={busy} onValueChange={(day) => onMove(request, day)}>
                    <SelectTrigger aria-label={`Move ${number || request.ownerName} to another day`}>
                      <SelectValue placeholder="Pick a day" />
                    </SelectTrigger>
                    <SelectContent>
                      {days.map((day) => (
                        <SelectItem key={day} value={day}>
                          {dateLabel(day, { weekday: "short", month: "short", day: "numeric" })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <p className="helper">Urgent first, then fixed times, then any time that day, then any day that week.</p>
    </section>
  );
}
