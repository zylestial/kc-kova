"use client";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TransportRequest } from "@/lib/kova-api";

type Props = {
  pool: TransportRequest[];
  servedStopIds: Set<string>;
  unplacedIds: string[];
  heldElsewhere: number;
  sentBackCount: number;
  busy: boolean;
  setSendingBack: (ids: string[] | null) => void;
};

export default function RequestPool({
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
          <h2>Request pool</h2>
          {(heldElsewhere > 0 || sentBackCount > 0) && (
            <p>
              {heldElsewhere > 0 && `${heldElsewhere} more ${heldElsewhere === 1 ? "is" : "are"} in another schedule.`}
              {sentBackCount > 0 && ` ${sentBackCount} sent back.`}
            </p>
          )}
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
