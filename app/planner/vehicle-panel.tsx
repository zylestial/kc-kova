"use client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Account, Vehicle } from "@/lib/kova-api";
import { type Commitment } from "@/lib/trip-record";

type Props = {
  plate: string;
  setPlate: (plate: string) => void;
  vehicles: Vehicle[];
  driverFor: (plate: string) => Account | undefined;
  driver: Account | undefined;
  clashes: Commitment[];
};

export default function VehiclePanel({
  plate,
  setPlate,
  vehicles,
  driverFor,
  driver,
  clashes,
}: Props) {
  return (
    <section className="editor-panel">
      <span className="planner-step">Step 2</span>
      <h2>Vehicle and Driver</h2>
      <div className="fields planner-vehicle">
        <label className="field">
          <span>Vehicle *</span>
          <Select value={plate} onValueChange={setPlate}>
            <SelectTrigger aria-label="Vehicle">
              <SelectValue placeholder="Select a vehicle" />
            </SelectTrigger>
            <SelectContent>
              {vehicles
                .filter((vehicle) => vehicle.status === "Active")
                .map((vehicle) => (
                  <SelectItem key={vehicle.plate} value={vehicle.plate} disabled={!driverFor(vehicle.plate)}>
                    {vehicle.name} · {vehicle.plate}
                    {!driverFor(vehicle.plate) && " (no Driver assigned)"}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </label>
        <label className="field">
          <span>Driver (automatic)</span>
          <Input value={driver?.name ?? ""} placeholder="Follows the vehicle" readOnly />
        </label>
      </div>
      {!vehicles.some((vehicle) => vehicle.status === "Active") ? (
        <p className="helper">There are no active vehicles. An Admin adds them in Settings, under Vehicles.</p>
      ) : (
        vehicles.some((vehicle) => vehicle.status === "Active" && !driverFor(vehicle.plate)) && (
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
