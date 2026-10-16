"use client";
import { Button } from "@/components/ui/button";
import { hhmmLabel } from "@/lib/stop-times";
import { DAY_END, type PlanOption } from "@/lib/scheduling-plan";
import type { TransportRequest } from "@/lib/kova-api";
import { stopNumber } from "@/lib/scheduling";

/**
 * Where the stops in the sheet can go (prototype "Best options first"):
 * each vehicle with when it would get there and how it fits, the best one
 * first, and an Add button. Vehicles that can't take it say why.
 */
export default function PlanOptions({
  options,
  stops,
  requests,
  busy,
  onAdd,
}: {
  options: PlanOption[];
  stops: TransportRequest[];
  /** Every request, to name a stop on the trip this would make late. */
  requests: TransportRequest[];
  busy: boolean;
  onAdd: (option: PlanOption) => void;
}) {
  const urgent = stops.some((stop) => stop.requestType === "URGENT");
  // "52-A asked for 1:00 PM, would arrive 1:30 PM"
  const lateText = (option: PlanOption, id: string) => {
    const request = requests.find((item) => item.id === id);
    if (!request) return id;
    const name = stopNumber(request) || request.ownerName;
    const leg = option.input.legs.find((item) => item.stops.includes(request.destinations[0]?.id ?? ""));
    return request.fixedTime && leg ? `${name} asked for ${hhmmLabel(request.fixedTime)}, would arrive ${hhmmLabel(leg.plannedTimeIn)}` : name;
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
              {option.end > DAY_END && <span className="sc-late">Ends {hhmmLabel(option.end)}, after the Driver&apos;s day ends at 6:00 PM</span>}
              {option.late.length > 0 && <span className="sc-late">Late: {option.late.map((id) => lateText(option, id)).join("; ")}</span>}
              {option.needsAdmin && <span className="sc-muted">Approved trip: goes into draft changes, then you resubmit</span>}
              {option.takesBack && <span className="sc-muted">Waiting for Admin: goes back to draft, then you resubmit</span>}
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
