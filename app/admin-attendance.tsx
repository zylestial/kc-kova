"use client";
import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AttendanceTap } from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import {
  attendanceStatusLabel,
  buildAttendanceRows,
  mapUrl,
  tapFlagLabel,
  tapFlags,
  tapNearLabel,
  tapPlaceLabel,
  tapTimeLabel,
  type AttendanceRow,
  type AttendanceStatus,
} from "@/lib/attendance";
import { anyDate, inDateFilter, type DateFilter } from "@/lib/date-range";
import { manilaToday } from "@/lib/timezone";
import DateRangeFilter from "./date-range-filter";
import OlderRecordsNotice from "./older-records-notice";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const statusPill: Record<AttendanceStatus, string> = { COMPLETE: "scheduled", STARTED: "pending", MISSING: "rejected" };

/** One Start or End tap: its time, where it was (linked to a map), its flags and who tapped if not the Driver. */
function TapCell({ row, tap, nameOf }: { row: AttendanceRow; tap?: AttendanceTap; nameOf: (id: string) => string }) {
  if (!tap) return <>—</>;
  return (
    <div className="attendance-tap">
      <b>{tapTimeLabel(tap.at)}</b>
      {tap.location && (
        <a href={mapUrl(tap.location.lat, tap.location.lng)} target="_blank" rel="noreferrer">
          <MapPin size={13} /> {tapPlaceLabel(tap)}
        </a>
      )}
      {tapNearLabel(tap) && <small>{tapNearLabel(tap)}</small>}
      {tapFlags(tap, row.schedule.date).map((flag) => (
        <small className="attendance-flag" key={flag}>
          {tapFlagLabel[flag]}
        </small>
      ))}
      {tap.recordedByAccountId !== row.revision.driverId && <small>Tapped by {nameOf(tap.recordedByAccountId)}</small>}
    </div>
  );
}

/**
 * Admin Attendance: each Driver's Start and End taps at ANONANG, one row per
 * published trip up to today. A tap away from base, without a location or on
 * a later day is flagged, not refused, so the Admin judges it here.
 */
export default function AdminAttendance() {
  const { schedules, attendance, accounts } = useKovaData();
  const today = manilaToday();
  const rows = useMemo(() => buildAttendanceRows(schedules, attendance, today), [schedules, attendance, today]);
  const [dates, setDates] = useState<DateFilter>(anyDate);
  const [driver, setDriver] = useState("all");
  const [status, setStatus] = useState("all");

  const drivers = [...new Set(rows.map((row) => row.revision.driverName))].sort();
  const visible = rows.filter(
    (row) =>
      inDateFilter(row.schedule.date, dates, today) &&
      (driver === "all" || row.revision.driverName === driver) &&
      (status === "all" || (status === "flagged" ? row.flags.length > 0 : row.status === status)),
  );
  const nameOf = (id: string) => accounts.find((item) => item.id === id)?.name ?? "someone else";

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>
            Attendance<span className="title-dot">.</span>
          </h1>
          <p>When each Driver started and ended their trip at ANONANG. Taps away from base or without a location are flagged.</p>
        </div>
      </div>
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <MapPin size={20} />
            <h2>Driver attendance</h2>
            <span className="count">{visible.length}</span>
          </div>
        </div>
        <OlderRecordsNotice />
        <div className="admin-trip-filters">
          <DateRangeFilter value={dates} onChange={setDates} />
          <label className="field">
            <span>Driver</span>
            <Select value={driver} onValueChange={setDriver}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Drivers</SelectItem>
                {drivers.map((name) => (
                  <SelectItem value={name} key={name}>
                    {name}
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
                <SelectItem value="all">All</SelectItem>
                {(Object.keys(attendanceStatusLabel) as AttendanceStatus[]).map((value) => (
                  <SelectItem value={value} key={value}>
                    {attendanceStatusLabel[value]}
                  </SelectItem>
                ))}
                <SelectItem value="flagged">Flagged</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        {visible.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {["DATE", "DRIVER", "PLATE NUMBER", "START", "END", "STATUS"].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.schedule.id}>
                    <td>{dateLabel(row.schedule.date)}</td>
                    <td>{row.revision.driverName}</td>
                    <td>{row.revision.plate}</td>
                    <td>
                      <TapCell row={row} tap={row.attendance?.start} nameOf={nameOf} />
                    </td>
                    <td>
                      <TapCell row={row} tap={row.attendance?.end} nameOf={nameOf} />
                    </td>
                    <td>
                      {row.status === "MISSING" && row.schedule.date === today ? (
                        <span className="status-pill pending">Not started yet</span>
                      ) : (
                        <span className={"status-pill " + statusPill[row.status]}>{attendanceStatusLabel[row.status]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <MapPin size={30} />
            </div>
            <h3>{rows.length ? "No matching attendance" : "No trips yet"}</h3>
            <p>{rows.length ? "Try another filter." : "Approved trips appear here from their date, with the Driver's Start and End taps."}</p>
          </div>
        )}
        <div className="panel-foot">
          <span>
            Addresses are approximate, from{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              © OpenStreetMap contributors
            </a>
            .
          </span>
        </div>
      </section>
    </>
  );
}
