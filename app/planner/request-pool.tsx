"use client";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TransportRequest } from "@/lib/kova-api";
import { dateLabel } from "./format";

type Props = {
  date: string;
  pool: TransportRequest[];
  servedStopIds: Set<string>;
  unplacedIds: string[];
  heldElsewhere: number;
  sentBackCount: number;
  busy: boolean;
  setSendingBack: (ids: string[] | null) => void;
};

export default function RequestPool({
  date,
  pool,
  servedStopIds,
  unplacedIds,
  heldElsewhere,
  sentBackCount,
  busy,
  setSendingBack,
}: Props) {
  return (
    <section className="editor-panel">
      <div className="section-heading">
        <div>
          <span className="planner-step">Step 1</span>
          <h2>Request pool</h2>
          <p>
            Requests for {dateLabel(date, { month: "short", day: "numeric" })}, Urgent first, then grouped by who asked. A
            destination is ticked off once it&apos;s on the route below — use &quot;Add stop&quot; there, not here.
            {heldElsewhere > 0 && ` ${heldElsewhere} more ${heldElsewhere === 1 ? "is" : "are"} already in another schedule.`}
            {sentBackCount > 0 && ` ${sentBackCount} ${sentBackCount === 1 ? "was sent back to its requester" : "were sent back to their requesters"}.`}
            {" "}If a request won&apos;t fit, send it back so the requester can pick another day.
          </p>
        </div>
      </div>
      {pool.length ? (
        <ul className="planner-pool">
          {pool.map((request) => (
            <li key={request.id}>
              <span className="planner-pool-owner">
                <b>{request.ownerName}</b>
                {request.requestType === "URGENT" && <span className="badge urgent">URGENT</span>}
                {request.projectName && <small>{request.projectName}</small>}
                {unplacedIds.includes(request.id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="planner-pool-send-back"
                    disabled={busy}
                    aria-label={`Send ${request.ownerName}'s request back`}
                    onClick={() => setSendingBack([request.id])}
                  >
                    <Undo2 size={14} /> Send back
                  </Button>
                )}
              </span>
              <ul className="planner-pool-stops">
                {request.destinations.map((item) => (
                  <li key={item.id} className={servedStopIds.has(item.id) ? "done" : ""}>
                    <span aria-hidden="true">{servedStopIds.has(item.id) ? "✓" : "○"}</span>
                    <span>
                      <span className="sr-only">{servedStopIds.has(item.id) ? "On the route: " : "Waiting: "}</span>
                      {item.destinationName} — {item.purposeName}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="helper">No requests are waiting for this day.</p>
      )}
      {unplacedIds.length > 1 && (
        <Button
          variant="outline"
          size="sm"
          className="planner-pool-send-back-all"
          disabled={busy}
          onClick={() => setSendingBack(unplacedIds)}
        >
          <Undo2 size={14} /> Send back all unplaced ({unplacedIds.length})
        </Button>
      )}
    </section>
  );
}
