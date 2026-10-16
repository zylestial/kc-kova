"use client";
import type { TransportRequest } from "@/lib/kova-api";
import { hhmmLabel } from "@/lib/stop-times";
import { stopNumber } from "@/lib/scheduling";
import { dateLabel } from "../planner/format";

/** "Fixed 11:00 AM", "Any day (asked Wed)" or "Any time". */
export function whenText(stop: TransportRequest) {
  if (stop.flexibility === "FIXED") return `Fixed ${hhmmLabel(stop.fixedTime ?? "")}`;
  if (stop.flexibility === "WEEK") return `Any day (asked ${dateLabel(stop.group?.date ?? stop.date, { weekday: "short" })})`;
  return "Any time";
}

/** What the stop is for: the Urgent reason, or the purpose. */
export const whatText = (stop: TransportRequest) => stop.urgentReason?.name ?? stop.destinations[0]?.purposeName ?? "";

/**
 * One waiting stop in "To plan" (prototype stop card): number, Urgent,
 * requester, where, what and when. Tapping it opens its details and where
 * it can go; it can also be dragged onto a vehicle.
 */
export default function StopCard({
  stop,
  inGroup = false,
  onOpen,
  onDrag,
}: {
  stop: TransportRequest;
  /** In a place group, which already names the place. */
  inGroup?: boolean;
  onOpen: (ids: string[]) => void;
  /** Dragging starts (the stop ids) or ends (null). */
  onDrag?: (ids: string[] | null) => void;
}) {
  const urgent = stop.requestType === "URGENT";
  return (
    <button
      type="button"
      className={"sc-stop" + (urgent ? " urgent" : stop.flexibility === "FIXED" ? " fixed-time" : "")}
      onClick={() => onOpen([stop.id])}
      draggable={!!onDrag}
      onDragStart={(event) => {
        // Inside a group, only this stop moves.
        event.stopPropagation();
        event.dataTransfer.setData("text/plain", stop.id);
        event.dataTransfer.effectAllowed = "move";
        onDrag?.([stop.id]);
      }}
      onDragEnd={() => onDrag?.(null)}
    >
      <span className="sc-stop-top">
        <span>
          <b className="sc-id">{stopNumber(stop) || "Request"}</b>
          {urgent && <span className="sc-tag error">Urgent</span>}
          {stop.group?.form === "COMPANY" && <span className="sc-tag info">Company · {stop.group.vehiclePlate}</span>}
        </span>
        <span className="sc-who">{stop.ownerName}</span>
      </span>
      {!inGroup && <span className="sc-dest">{stop.destinations.map((item) => item.destinationName).join(" → ")}</span>}
      <span className="sc-meta">
        {whatText(stop)} · {whenText(stop)}
      </span>
      <span className="sc-meta">{stop.projectName}</span>
    </button>
  );
}
