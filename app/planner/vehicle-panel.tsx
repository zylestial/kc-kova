"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Account, Vehicle } from "@/lib/kova-api";
import { type Commitment } from "@/lib/trip-record";

type Props = {
  plate: string;
  setPlate: (plate: string) => void;
  vehicles: Vehicle[];
  driverFor: (plate: string) => Account | undefined;
  clashes: Commitment[];
  /** Vehicles already on another schedule that day (platesBookedOn); not offered. */
  booked: Set<string>;
};

export default function VehiclePanel({
  plate,
  setPlate,
  vehicles,
  driverFor,
  clashes,
  booked,
}: Props) {
  // A vehicle takes one schedule a day (0048); the one already chosen stays listed.
  const active = vehicles.filter((vehicle) => vehicle.status === "Active");
  const offered = active.filter((vehicle) => !booked.has(vehicle.plate) || vehicle.plate === plate);
  return (
    <section className="editor-panel">
      <h2>Vehicle</h2>
      <div className="fields planner-vehicle">
        <label className="field">
          <span>Vehicle *</span>
          <Select value={plate} onValueChange={setPlate}>
            <SelectTrigger aria-label="Vehicle">
              <SelectValue placeholder="Select a vehicle" />
            </SelectTrigger>
            <SelectContent>
              {offered.map((vehicle) => (
                <SelectItem key={vehicle.plate} value={vehicle.plate} disabled={!driverFor(vehicle.plate)}>
                  {vehicle.name} · {vehicle.plate}
                  {!driverFor(vehicle.plate) && " (no Driver assigned)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      {!active.length ? (
        <p className="helper">There are no active vehicles. An Admin adds them in Settings, under Vehicles.</p>
      ) : !offered.length ? (
        <p className="helper">Every vehicle already has a trip on this day.</p>
      ) : (
        offered.some((vehicle) => !driverFor(vehicle.plate)) && (
          <p className="helper">
            A vehicle marked &quot;no Driver assigned&quot; can&apos;t be used yet. An Admin assigns a Driver in Settings,
            under Vehicles.
          </p>
        )
      )}
      {clashes.length > 0 && (
        <p className="field-hint planner-clash" role="alert">
          {clashes
            .map((item) =>
              item.plate === plate
                ? `${item.plate} is already reserved ${item.start}–${item.end}.`
                : `${item.driverName} is already driving ${item.start}–${item.end}.`,
            )
            .join(" ")}
        </p>
      )}
    </section>
  );
}
