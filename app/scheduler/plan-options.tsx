"use client";
import { Button } from "@/components/ui/button";
import { hhmmLabel } from "@/lib/stop-times";
import type { PlanOption } from "@/lib/scheduling-plan";
import type { TransportRequest } from "@/lib/kova-api";
import { stopNumber } from "@/lib/scheduling";

/** After this the trip runs past the Driver's day (prototype WORK_END). */
const DAY_END = "18:00";

/**
 * Where the stops in the sheet can go (prototype "Best options first"):
 * each vehicle with when it would get there and how it fits, the best one
 * first, and an Add button. Vehicles that can't take it say why.
 */
export default function PlanOptions({
  options,
  stops,
  busy,
  onAdd,
}: {
  options: PlanOption[];
  stops: TransportRequest[];
  busy: boolean;
  onAdd: (option: PlanOption) => void;
}) {
  const urgent = stops.some((stop) => stop.requestType === "URGENT");
  const name = (id: string) => {
    const stop = stops.find((item) => item.id === id);
    return stop ? stopNumber(stop) || stop.ownerName : id;
  };
  return (
    <div>
      <div className="sc-section">{urgent ? "Fastest options first" : "Best options first"}</div>
      {options.map((option, index) => {
        const best = index === 0 && !option.blocked;
        return (
          <div key={option.row.vehicle.plate} className={"sc-option" + (best ? " best" : "")}>
            <div>
              <b>
                {option.row.vehicle.name}
                {option.arrive && ` · arrives ~${hhmmLabel(option.arrive)}`}
              </b>
              {option.label && (
                <span>
                  {option.label}
                  {option.trip && ` · +${option.extra} min`}
                </span>
              )}
              {option.blocked && <span className="sc-late">{option.blocked}</span>}
              {option.end > DAY_END && <span className="sc-late">Ends {hhmmLabel(option.end)} (after 6 PM)</span>}
              {option.late.length > 0 && <span className="sc-late">Late: {option.late.map(name).join(", ")}</span>}
              {option.needsAdmin && <span className="sc-muted">Approved trip: goes into draft changes, then you submit</span>}
            </div>
            <Button
              size="sm"
              className={best ? "primary" : ""}
              variant={best ? "default" : "outline"}
              disabled={busy || !!option.blocked}
              onClick={() => onAdd(option)}
            >
              Add
            </Button>
          </div>
        );
      })}
    </div>
  );
}
