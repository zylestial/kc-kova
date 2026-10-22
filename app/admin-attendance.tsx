"use client";
import { useMemo, useState } from "react";
import { Download, MapPin } from "lucide-react";
import { downloadCsv, toCsv } from "@/lib/csv";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AttendanceTap } from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import {
  attendanceStatusLabel,
  buildAttendanceRows,
  coordinatesLabel,
  mapUrl,
  tapFlagLabel,
  tapFlags,
  tapPlaceLabel,
  tapTimeLabel,
  type AttendanceRow,
  type AttendanceStatus,
} from "@/lib/attendance";
import { anyDate, inDateFilter, type DateFilter } from "@/lib/date-range";
import { manilaToday } from "@/lib/timezone";
import { sortRows, type Sort } from "@/lib/table-sort";
import DateRangeFilter from "./date-range-filter";
import FilterFold from "./filter-fold";
import FormFilter, { formMatches, type FormFilterValue } from "./form-filter";
import { SortableHead, SortSelect, type SortColumn } from "./sortable-head";
import OlderRecordsNotice from "./older-records-notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { atStop, legTimes, placeResolver, type LegTimes } from "@/lib/stop-times";
import StopTimesTable from "./stop-times-table";

/** The Arrived/Leaving taps of a trip (not Start/End): how many were made and how many are flagged. */
function stopSummary(times: LegTimes[]) {
  const stops = times.flatMap((item) => [item.out, item.in]).filter((time) => "legId" in time.source);
  const taps = stops.flatMap((time) => (time.tap ? [time.tap] : []));
  return {
    expected: stops.length,
    tapped: taps.length,
    away: taps.filter((tap) => atStop(tap.location) === false).length,
    noLocation: taps.filter((tap) => !tap.location).length,
    // Has a position, but the place has no saved location to check it against.
    unchecked: taps.filter((tap) => tap.location && tap.location.distanceM === null).length,
  };
}

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const statusPill: Record<AttendanceStatus, string> = { COMPLETE: "scheduled", STARTED: "pending", MISSING: "rejected" };
const statusOrder: AttendanceStatus[] = ["MISSING", "STARTED", "COMPLETE"];

/** A tap's Manila time of day as "HH:MM", so sorting by Start or End finds the earliest and latest taps. */
const tapTimeLabel24 = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false });

type AttendanceFilters = { dates: DateFilter; form: FormFilterValue; driver: string; status: string };
const noFilters: AttendanceFilters = { dates: anyDate, form: "all", driver: "all", status: "all" };

type AttendanceSortKey = "date" | "driver" | "plate" | "start" | "end" | "status";
const columns: SortColumn<AttendanceSortKey>[] = [
  { label: "DATE", key: "date" },
  { label: "DRIVER", key: "driver" },
  { label: "PLATE NUMBER", key: "plate" },
  { label: "START", key: "start" },
  { label: "END", key: "end" },
  { label: "STOPS" },
  { label: "STATUS", key: "status" },
];

/** One Start or End tap: its time, where it was (linked to a map), its flags and who tapped if not the Driver. */
function TapCell({ row, tap, nameOf }: { row: AttendanceRow; tap?: AttendanceTap; nameOf: (id: string) => string }) {
  if (!tap) return <>—</>;
  const company = row.schedule.kind === "COMPANY";
  return (
    <div className="attendance-tap">
      <b>{tapTimeLabel(tap.at)}</b>
      {tap.location && (
        <a href={mapUrl(tap.location.lat, tap.location.lng)} target="_blank" rel="noreferrer">
          <MapPin size={13} /> {tapPlaceLabel(tap, company)}
        </a>
      )}
      {tap.location && <small className="attendance-coordinates">{coordinatesLabel(tap.location)}</small>}
      {tapFlags(tap, row.schedule.date, company).map((flag) => (
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
 * a later day is flagged, not refused, so the Admin judges it here. Finance
 * sees the same screen (`eyebrow` names whose it is); it has no actions.
 */
export default function AdminAttendance({ eyebrow = "ADMIN" }: { eyebrow?: string } = {}) {
  const { schedules, attendance, companyRuns, stopTaps, timeCorrections, accounts, options } = useKovaData();
  const placeOf = placeResolver(options.destinations);
  const today = manilaToday();
  const rows = useMemo(() => buildAttendanceRows(schedules, attendance, today, companyRuns), [schedules, attendance, today, companyRuns]);
  const [filters, setFilters] = useState<AttendanceFilters>(noFilters);
  /** The Download CSV dialog's own filters, starting from the screen's; null while it's closed. */
  const [exportFilters, setExportFilters] = useState<AttendanceFilters | null>(null);
  const [sort, setSort] = useState<Sort<AttendanceSortKey>>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const timesFor = (row: AttendanceRow) =>
    legTimes(
      row.revision.legs,
      row.attendance ?? undefined,
      stopTaps.filter((item) => item.scheduleId === row.schedule.id),
      timeCorrections.filter((item) => item.scheduleId === row.schedule.id),
      placeOf,
    );
  const stopFlagged = (row: AttendanceRow) => {
    const summary = stopSummary(timesFor(row));
    return summary.away + summary.noLocation + summary.unchecked > 0;
  };
  const stopUnchecked = (row: AttendanceRow) => stopSummary(timesFor(row)).unchecked > 0;

  const drivers = [...new Set(rows.map((row) => row.revision.driverName))].sort();
  /** The rows a set of filters lets through, in the screen's sort order. */
  const filtered = (f: AttendanceFilters) =>
    sortRows(
      rows.filter(
        (row) =>
          inDateFilter(row.schedule.date, f.dates, today) &&
          formMatches(f.form, row.schedule.kind) &&
          (f.driver === "all" || row.revision.driverName === f.driver) &&
          (f.status === "all" ||
            (f.status === "flagged"
              ? row.flags.length > 0 || stopFlagged(row)
              : f.status === "unchecked"
                ? stopUnchecked(row)
                : row.status === f.status)),
      ),
      sort,
      {
        date: (row) => row.schedule.date,
        driver: (row) => row.revision.driverName,
        plate: (row) => row.revision.plate,
        // A tap's time of day; rows without one go to the end when ascending.
        start: (row) => (row.attendance ? tapTimeLabel24(row.attendance.start.at) : "99:99"),
        end: (row) => (row.attendance?.end ? tapTimeLabel24(row.attendance.end.at) : "99:99"),
        status: (row) => statusOrder.indexOf(row.status),
      },
    );
  const visible = filtered(filters);
  const exportRows = exportFilters ? filtered(exportFilters) : [];
  const nameOf = (id: string) => accounts.find((item) => item.id === id)?.name ?? "someone else";

  /** The filter fields, for the screen and for the Download CSV dialog. */
  const filterFields = (f: AttendanceFilters, set: (next: AttendanceFilters) => void) => (
    <>
      <DateRangeFilter value={f.dates} onChange={(dates) => set({ ...f, dates })} />
      {/* Company trips are in Attendance too (0079); this leaves them out. */}
      <FormFilter value={f.form} onChange={(form) => set({ ...f, form })} />
      <label className="field">
        <span>Driver</span>
        <Select value={f.driver} onValueChange={(driver) => set({ ...f, driver })}>
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
        <Select value={f.status} onValueChange={(status) => set({ ...f, status })}>
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
            <SelectItem value="unchecked">Stops not checked</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </>
  );

  /** The dialog's rows, in the screen's order: each tap with its place, and every flag in words. */
  function downloadRows() {
    const lines = exportRows.map((row) => {
      const { start, end } = row.attendance ?? {};
      const company = row.schedule.kind === "COMPANY";
      const summary = stopSummary(timesFor(row));
      const flags = [
        ...(start ? tapFlags(start, row.schedule.date, company).map((flag) => `Start: ${tapFlagLabel[flag]}`) : []),
        ...(end ? tapFlags(end, row.schedule.date, company).map((flag) => `End: ${tapFlagLabel[flag]}`) : []),
        summary.away ? `${summary.away} stop taps away from the stop` : "",
        summary.noLocation ? `${summary.noLocation} stop taps without a location` : "",
        summary.unchecked ? `${summary.unchecked} stop taps not checked` : "",
      ].filter(Boolean);
      return [
        row.schedule.date,
        company ? "Company Trip" : "Daily Vehicle Trip",
        row.revision.driverName,
        row.revision.plate,
        start ? tapTimeLabel(start.at) : null,
        start ? tapPlaceLabel(start, company) : null,
        end ? tapTimeLabel(end.at) : null,
        end ? tapPlaceLabel(end, company) : null,
        summary.expected ? `${summary.tapped} of ${summary.expected}` : null,
        flags.join("; "),
        attendanceStatusLabel[row.status],
      ];
    });
    const header = ["DATE", "FORM", "DRIVER", "VEHICLE", "START", "START PLACE", "END", "END PLACE", "STOPS TAPPED", "FLAGS", "STATUS"];
    downloadCsv(`kova-attendance-${today}.csv`, toCsv(header, lines));
    setExportFilters(null);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>
            Attendance<span className="title-dot">.</span>
          </h1>
          <p>When each Driver started and ended their trip, at ANONANG for Daily trips, and their taps at each stop. Taps away from the place or without a location are flagged.</p>
        </div>
      </div>
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <MapPin size={20} />
            <h2>Driver attendance</h2>
            <span className="count">{visible.length}</span>
          </div>
          <Button variant="outline" disabled={!rows.length} onClick={() => setExportFilters(filters)}>
            <Download size={16} /> Download CSV
          </Button>
        </div>
        <OlderRecordsNotice />
        <FilterFold
          active={
            (filters.dates.preset !== "any" ? 1 : 0) +
            [filters.form, filters.driver, filters.status].filter((value) => value !== "all").length +
            (sort ? 1 : 0)
          }
        >
          {filterFields(filters, setFilters)}
          <SortSelect columns={columns} sort={sort} onSort={setSort} />
        </FilterFold>
        {visible.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <SortableHead columns={columns} sort={sort} onSort={setSort} />
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
                      {(() => {
                        const summary = stopSummary(timesFor(row));
                        if (!summary.expected) return <>—</>;
                        return (
                          <div className="attendance-tap">
                            <b>
                              {summary.tapped} of {summary.expected} tapped
                            </b>
                            {summary.away > 0 && <small className="attendance-flag">{summary.away} away from the stop</small>}
                            {summary.noLocation > 0 && <small className="attendance-flag">{summary.noLocation} without a location</small>}
                            {summary.unchecked > 0 && <small className="attendance-flag">{summary.unchecked} not checked (no place location)</small>}
                            {row.attendance && (
                              <Button variant="outline" size="sm" onClick={() => setOpenId(row.schedule.id)}>
                                View
                              </Button>
                            )}
                          </div>
                        );
                      })()}
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
          <span>Coordinates are exactly as the phone reported them; ± is the phone&apos;s own accuracy.</span>
        </div>
      </section>
      {(() => {
        const row = rows.find((item) => item.schedule.id === openId);
        return (
          <Dialog open={!!row} onOpenChange={(open) => !open && setOpenId(null)}>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Stop times</DialogTitle>
                <DialogDescription className="dialog-context">
                  {row && `${dateLabel(row.schedule.date)} — ${row.revision.plate} — ${row.revision.driverName}`}
                </DialogDescription>
              </DialogHeader>
              {row && <StopTimesTable times={timesFor(row)} driverId={row.revision.driverId} nameOf={nameOf} />}
              <p className="helper">Missing times are filled in on Finished Trips once the Driver submits the trip.</p>
            </DialogContent>
          </Dialog>
        );
      })()}
      <Dialog open={!!exportFilters} onOpenChange={(open) => { if (!open) setExportFilters(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Download Attendance</DialogTitle>
            <DialogDescription>Starts from what the screen shows. Choose which rows to save, then download.</DialogDescription>
          </DialogHeader>
          {exportFilters && <div className="modal-fields">{filterFields(exportFilters, setExportFilters)}</div>}
          <DialogFooter>
            <span className="helper" role="status">
              {exportRows.length} {exportRows.length === 1 ? "row" : "rows"}
            </span>
            <Button variant="outline" onClick={() => setExportFilters(null)}>
              Cancel
            </Button>
            <Button className="primary" disabled={!exportRows.length} onClick={downloadRows}>
              <Download size={16} /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
