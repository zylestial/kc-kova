"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  approveSchedule,
  cancelSchedule,
  getAccounts,
  getRequests,
  getSchedules,
  getVehicles,
  returnSchedule,
  type Schedule,
} from "@/lib/kova-api";
import { addDays, manilaToday } from "@/lib/timezone";
import {
  currentRevision,
  openRevision,
  publishedRevision,
  scheduleState,
  scheduleStateLabel,
  scheduleStatePill,
  stopsFor,
  tripWindow,
  type ScheduleState,
} from "@/lib/trip-record";
import CancellationRequests from "./cancellation-requests";
import { scheduleStateMeaning } from "@/lib/status-text";
import TripRecordView from "./trip-record-view";

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", options);
/** Monday of the week containing a date. */
const weekStart = (value: string) => addDays(value, -((new Date(value + "T12:00:00").getDay() + 6) % 7));

const readData = () => ({
  schedules: getSchedules(),
  requests: getRequests(),
  vehicles: getVehicles(),
  accounts: getAccounts(),
});

/**
 * Schedules: every schedule by day or week, filtered by vehicle, Driver
 * and status, for weekly planning. A Scheduler opens a draft or returned
 * schedule to keep editing it, or proposes a revision of an approved one;
 * an Admin approves or returns a submitted one; anything else is read-only.
 */
export default function Schedules({
  canEdit,
  canReview,
  onCreate,
  onEdit,
  notice,
  initialDate,
}: {
  canEdit?: boolean;
  /** Admin: approve or return a schedule that has been submitted. */
  canReview?: boolean;
  onCreate?: () => void;
  onEdit?: (scheduleId: string) => void;
  notice?: string;
  /** The day to open on, e.g. the one just planned; defaults to today. */
  initialDate?: string;
}) {
  const [data, setData] = useState(readData);
  const [view, setView] = useState<"day" | "week">("week");
  const [date, setDate] = useState(() => initialDate ?? manilaToday());
  const [vehicle, setVehicle] = useState("all");
  const [driver, setDriver] = useState("all");
  const [status, setStatus] = useState<"all" | ScheduleState>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decided, setDecided] = useState("");
  useAutoClear(decided, setDecided);

  useEffect(() => {
    const refresh = () => setData(readData());
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, []);

  const { schedules, requests, vehicles, accounts } = data;
  const stopsById = new Map(stopsFor(requests).map((stop) => [stop.id, stop]));
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const days = view === "day" ? [date] : Array.from({ length: 7 }, (_, index) => addDays(weekStart(date), index));
  const drivers = accounts.filter((account) => account.role === "Driver");

  const visible = schedules
    .filter((schedule) => days.includes(schedule.date))
    .filter((schedule) => {
      const revision = currentRevision(schedule);
      return (
        (vehicle === "all" || revision?.plate === vehicle) &&
        (driver === "all" || revision?.driverId === driver) &&
        (status === "all" || scheduleState(schedule) === status)
      );
    })
    .map((schedule) => ({ schedule, revision: currentRevision(schedule), time: tripWindow(currentRevision(schedule)?.legs ?? []) }))
    .sort((a, b) => a.schedule.date.localeCompare(b.schedule.date) || (a.time?.start ?? "").localeCompare(b.time?.start ?? ""));

  const selected = schedules.find((schedule) => schedule.id === selectedId);
  const selectedRevision = selected && currentRevision(selected);
  const editable = (schedule: Schedule) => canEdit && ["DRAFT", "RETURNED"].includes(scheduleState(schedule));
  const revisable = (schedule: Schedule) => canEdit && scheduleState(schedule) === "APPROVED";
  // Admin can cancel any schedule that is still in force and whose trip the
  // Driver hasn't submitted (the server enforces that part).
  const cancellable = (schedule: Schedule) => canReview && schedule.status === "ACTIVE";
  const reviewable = (schedule: Schedule) => canReview && scheduleState(schedule) === "SUBMITTED";

  // The approved route still lists a request that has since been cancelled.
  const needsUpdate = (schedule: Schedule) =>
    schedule.status === "ACTIVE" &&
    (publishedRevision(schedule)?.requestIds ?? []).some((id) => requestsById.get(id)?.status === "CANCELLED") &&
    !openRevision(schedule);

  function closeDialog() {
    setSelectedId(null);
    setReturning(false);
    setCancelling(false);
    setComment("");
    setError("");
  }

  // Approving or returning refreshes the shared data, so the list and the
  // open Trip Record update; a stale version comes back as a 409 message.
  async function decide(action: () => Promise<Schedule>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      closeDialog();
      setDecided(message);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const requesters = (requestIds: string[]) =>
    [...new Set(requestIds.map((id) => requestsById.get(id)?.ownerName).filter(Boolean))].join(", ");
  const vehicleName = (plate: string) => vehicles.find((item) => item.plate === plate)?.name ?? plate;

  const card = ({ schedule, revision, time }: (typeof visible)[number]) => (
    <button key={schedule.id} className="schedule-card" onClick={() => setSelectedId(schedule.id)}>
      <span className="schedule-card-top">
        <b>{time ? `${time.start}–${time.end}` : "No times yet"}</b>
        <span className={"status-pill " + scheduleStatePill[scheduleState(schedule)]}>
          {scheduleStateLabel[scheduleState(schedule)]}
        </span>
      </span>
      <span>
        {revision ? `${vehicleName(revision.plate)} · ${revision.plate}` : "—"}
      </span>
      <span>{revision?.driverName}</span>
      <small>{revision && requesters(revision.requestIds)}</small>
      {revision?.requestIds.some((id) => requestsById.get(id)?.cancellationPending) && <small>Cancellation requested</small>}
      {needsUpdate(schedule) && <small>Route needs updating</small>}
      <small>{revision?.legs.map((leg) => leg.destinationName).join(" → ")}</small>
    </button>
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SCHEDULES</div>
          <h1>
            Schedules<span className="title-dot">.</span>
          </h1>
          <p>Every schedule by day or week: drafts, those waiting for approval, and approved trips.</p>
        </div>
        {onCreate && (
          <Button className="primary" onClick={onCreate}>
            <FilePlus2 size={16} /> Create schedule
          </Button>
        )}
      </div>
      {(decided || notice) && (
        <div className="notice success" role="status">
          {decided || notice}
        </div>
      )}
      {canReview && <CancellationRequests />}
      <section className="schedule-panel">
        <div className="panel-toolbar schedules-toolbar">
          <div>
            <CalendarDays size={20} />
            <h2>
              {view === "day"
                ? dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
                : `Week of ${dateLabel(days[0], { month: "long", day: "numeric", year: "numeric" })}`}
            </h2>
            <span className="count">{visible.length}</span>
          </div>
          <div className="schedules-nav">
            <Button variant={view === "day" ? "default" : "outline"} aria-pressed={view === "day"} onClick={() => setView("day")}>
              Day
            </Button>
            <Button variant={view === "week" ? "default" : "outline"} aria-pressed={view === "week"} onClick={() => setView("week")}>
              Week
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={view === "day" ? "Previous day" : "Previous week"}
              onClick={() => setDate(addDays(date, view === "day" ? -1 : -7))}
            >
              <ChevronLeft size={18} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={view === "day" ? "Next day" : "Next week"}
              onClick={() => setDate(addDays(date, view === "day" ? 1 : 7))}
            >
              <ChevronRight size={18} />
            </Button>
          </div>
        </div>
        <div className="admin-trip-filters">
          <label className="field">
            <span>Date</span>
            <Input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Vehicle</span>
            <Select value={vehicle} onValueChange={setVehicle}>
              <SelectTrigger aria-label="Vehicle filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vehicles</SelectItem>
                {vehicles.map((item) => (
                  <SelectItem key={item.plate} value={item.plate}>
                    {item.name} · {item.plate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>Driver</span>
            <Select value={driver} onValueChange={setDriver}>
              <SelectTrigger aria-label="Driver filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Drivers</SelectItem>
                {drivers.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>Status</span>
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger aria-label="Status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {(Object.keys(scheduleStateLabel) as ScheduleState[]).map((state) => (
                  <SelectItem key={state} value={state}>
                    {scheduleStateLabel[state]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        {view === "week" ? (
          <div className="week-grid">
            {days.map((day) => {
              const dayItems = visible.filter((item) => item.schedule.date === day);
              return (
                <div key={day} className={"week-day " + (day === manilaToday() ? "today" : "")}>
                  <button className="week-day-label" onClick={() => { setDate(day); setView("day"); }}>
                    <span>{dateLabel(day, { weekday: "short" })}</span>
                    <b>{dateLabel(day, { month: "short", day: "numeric" })}</b>
                  </button>
                  {dayItems.length ? dayItems.map(card) : <small className="week-empty">No trips</small>}
                </div>
              );
            })}
          </div>
        ) : visible.length ? (
          <div className="day-list">{visible.map(card)}</div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <CalendarDays size={30} />
            </div>
            <h3>{schedules.length ? "No matching schedules" : "No schedules yet"}</h3>
            <p>{schedules.length ? "Nothing matches this day and these filters. Try another day or clear a filter." : "Schedules you create will appear here."}</p>
          </div>
        )}
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="review-trip-modal">
          <DialogHeader>
            <DialogTitle>Trip Record</DialogTitle>
            <DialogDescription>
              {selected && dateLabel(selected.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </DialogDescription>
          </DialogHeader>
          {selected && selectedRevision && (
            <>
              <div className="driver-trip-details">
                {[
                  ["Vehicle", `${vehicleName(selectedRevision.plate)} · ${selectedRevision.plate}`],
                  ["Driver", selectedRevision.driverName],
                  ["Status", scheduleStateLabel[scheduleState(selected)]],
                  ["Version", `v${selectedRevision.version}`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="helper">{scheduleStateMeaning[scheduleState(selected)]}</p>
              {selectedRevision.status === "RETURNED" && selectedRevision.decisionComment && (
                <p className="notice">
                  <b>Returned by Admin:</b> {selectedRevision.decisionComment}
                </p>
              )}
              {selected.status === "CANCELLED" && (
                <p className="notice">This schedule was cancelled. Its requests were released or cancelled with it.</p>
              )}
              {needsUpdate(selected) && (
                <p className="notice">
                  A request in this schedule was cancelled. The approved route still lists it until a new version is approved.
                </p>
              )}
              <TripRecordView legs={selectedRevision.legs} stopsById={stopsById} />
              {cancelling && (
                <label className="field">
                  <span>Why is this schedule being cancelled? *</span>
                  <Textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} />
                </label>
              )}
              {returning && (
                <label className="field">
                  <span>What needs to change?</span>
                  <Textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} />
                </label>
              )}
              {error && (
                <p className="modal-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={returning || cancelling ? () => { setReturning(false); setCancelling(false); setComment(""); setError(""); } : closeDialog}
            >
              {returning || cancelling ? "Back" : "Close"}
            </Button>
            {selected && selectedRevision && editable(selected) && (
              <Button className="primary" onClick={() => onEdit?.(selected.id)}>
                Edit draft
              </Button>
            )}
            {selected && revisable(selected) && (
              <Button className="primary" onClick={() => onEdit?.(selected.id)}>
                Propose revision
              </Button>
            )}
            {selected && cancellable(selected) && !returning && !cancelling && (
              <Button variant="outline" className="danger-outline" disabled={busy} onClick={() => { setCancelling(true); setComment(""); setError(""); }}>
                Cancel schedule
              </Button>
            )}
            {selected && cancelling && (
              <Button
                className="danger"
                disabled={busy || !comment.trim()}
                onClick={() => decide(() => cancelSchedule(selected.id, comment.trim()), "Schedule cancelled.")}
              >
                {busy ? "Cancelling…" : "Cancel schedule"}
              </Button>
            )}
            {selected && selectedRevision && reviewable(selected) && !returning && !cancelling && (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setReturning(true)}>
                  Return
                </Button>
                <Button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    decide(() => approveSchedule(selected.id, selectedRevision.rowVersion), "Schedule approved and published.")
                  }
                >
                  {busy ? "Approving…" : "Approve"}
                </Button>
              </>
            )}
            {selected && selectedRevision && reviewable(selected) && returning && (
              <Button
                className="primary"
                disabled={busy || !comment.trim()}
                onClick={() =>
                  decide(
                    () => returnSchedule(selected.id, selectedRevision.rowVersion, comment.trim()),
                    "Schedule returned to the Scheduler.",
                  )
                }
              >
                {busy ? "Returning…" : "Return to Scheduler"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
