"use client";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getBookings, getRecords, type VehicleRecord } from "@/lib/kova-api";

export default function AdminFinishedTrips({
  onOpen,
}: {
  onOpen: (recordId: string) => void;
}) {
  const [records, setRecords] = useState<VehicleRecord[]>([]);
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [date, setDate] = useState("");
  const [driver, setDriver] = useState("all");
  const [vehicle, setVehicle] = useState("all");
  const [status, setStatus] = useState("all");
  useEffect(() => {
    function refresh() {
      const bookings = getBookings(),
        byId = Object.fromEntries(bookings.map((b) => [b.id, b.destination]));
      setDestinations(byId);
      setRecords(
        getRecords()
          .filter(
            (r) =>
              r.submittedAt &&
              r.bookingId &&
              bookings.some((b) => b.id === r.bookingId),
          )
          .sort(
            (a, b) =>
              b.date.localeCompare(a.date) ||
              String(b.submittedAt).localeCompare(String(a.submittedAt)),
          ),
      );
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, []);
  const drivers = [...new Set(records.map((r) => r.driver))].sort();
  const vehicles = [...new Set(records.map((r) => r.plate))].sort();
  const visible = records.filter(
    (r) =>
      (!date || r.date === date) &&
      (driver === "all" || r.driver === driver) &&
      (vehicle === "all" || r.plate === vehicle) &&
      (status === "all" ||
        (status === "done" ? r.status === "DONE" : r.status !== "DONE")),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>
            Finished Trips<span className="title-dot">.</span>
          </h1>
          <p>Driver-submitted trip records.</p>
        </div>
      </div>
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <CheckCircle2 size={20} />
            <h2>Submitted records</h2>
            <span className="count">{visible.length}</span>
          </div>
        </div>
        <div className="admin-trip-filters">
          <label className="field">
            <span>Date</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Driver</span>
            <Select value={driver} onValueChange={setDriver}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Drivers</SelectItem>
                {drivers.map((v) => (
                  <SelectItem value={v} key={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>Vehicle</span>
            <Select value={vehicle} onValueChange={setVehicle}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vehicles</SelectItem>
                {vehicles.map((v) => (
                  <SelectItem value={v} key={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>Status</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="submitted">Submitted for Review</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        {visible.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {[
                    "DATE",
                    "VEHICLE",
                    "PLATE NUMBER",
                    "DRIVER",
                    "DESTINATION",
                    "PROJECT / DEPARTMENT",
                    "STATUS",
                    "",
                  ].map((v, i) => (
                    <th key={i}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} onClick={() => onOpen(r.id)}>
                    <td>{r.date}</td>
                    <td>{r.vehicle}</td>
                    <td>{r.plate}</td>
                    <td>{r.driver}</td>
                    <td>{destinations[r.bookingId || ""] || "—"}</td>
                    <td>{String(r.project || "—")}</td>
                    <td>
                      <span
                        className={
                          "badge " + (r.status === "DONE" ? "complete" : "")
                        }
                      >
                        {r.status === "DONE" ? "Done" : "Submitted for Review"}
                      </span>
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r.id);
                        }}
                      >
                        Open record
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>No matching finished trips</h3>
            <p>
              {records.length
                ? "Try another filter."
                : "Driver-submitted trips will appear here."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
