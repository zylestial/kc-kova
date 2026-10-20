"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useState } from "react";
import { CalendarClock, CalendarDays, Car, ChevronLeft, ChevronRight, User } from "lucide-react";
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
  returnSchedule,
  type Schedule,
  type ScheduleRevision,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { scheduledBy } from "@/lib/scheduled-by";
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
import { compareSchedules, finishState } from "@/lib/trip-finish";
import FilterFold from "./filter-fold";
import FormFilter, { formMatches, type FormFilterValue } from "./form-filter";
import OlderRecordsNotice from "./older-records-notice";
import TripRecordView from "./trip-record-view";
import { SortSelect, type SortColumn } from "./sortable-head";
import { sortRows, type Sort } from "@/lib/table-sort";

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", options);
/** Monday of the week containing a date. */
const weekStart = (value: string) => addDays(value, -((new Date(value + "T12:00:00").getDay() + 6) % 7));

export type ScheduleView = "day" | "week" | "all";

// Cards, not a table: one Sort by picker on every screen size. The Week
// view keeps its days and sorts within each.
type ScheduleSortKey = "date" | "vehicle" | "driver" | "status";
const sortColumns: SortColumn<ScheduleSortKey>[] = [
  { label: "DATE", key: "date" },
  { label: "VEHICLE", key: "vehicle" },
  { label: "DRIVER", key: "driver" },
  { label: "STATUS", key: "status" },
];
export const scheduleViews: ScheduleView[] = ["day", "week", "all"];

/**
 * Schedules: every schedule by day, by week or across all dates, filtered
 * by vehicle, Driver and status, for weekly planning. A Scheduler opens a
 * draft or returned schedule to keep editing it, or proposes a revision of an approved one;
 * an Admin approves or returns a submitted one; anything else is read-only.
 */
export default function Schedules({
  viewerId,
  canEdit,
  canReview,
  onCreate,
  onEdit,
  notice,
  initialDate,
  initialOpenId,
  initialView,
  initialStatus,
  initialCancellationId,
}: {
  /** The signed-in account, so a Scheduler's own draft can say "you". */
  viewerId: string;
  canEdit?: boolean;
  /** Admin: approve or return a schedule that has been submitted. */
  canReview?: boolean;
  onCreate?: () => void;
  onEdit?: (scheduleId: string) => void;
  notice?: string;
  /** The day to open on, e.g. the one just planned; defaults to today. */
  initialDate?: string;
  /** A schedule to open the detail dialog for immediately, e.g. from a notification. */
  initialOpenId?: string;
  /** Defaults to the week view. */
  initialView?: ScheduleView;
  /** A status to filter by from the start, e.g. from a Dashboard tile. */
  initialStatus?: ScheduleState;
  /** A cancellation request to highlight (its request id), from a notification. */
  initialCancellationId?: string;
}) {
  const { schedules, requests, vehicles, accounts, completions } = useKovaData();
  const [view, setView] = useState<ScheduleView>(initialView ?? "week");
  const [date, setDate] = useState(() => initialDate ?? manilaToday());
  const [vehicle, setVehicle] = useState("all");
  const [driver, setDriver] = useState("all");
  const [requester, setRequester] = useState("all");
  const [form, setForm] = useState<FormFilterValue>("all");
  const [status, setStatus] = useState<"all" | ScheduleState>(initialStatus ?? "all");
  const [selectedId, setSelectedId] = useState<string | null>(() => initialOpenId ?? null);
  const [sort, setSort] = useState<Sort<ScheduleSortKey>>(null);
  const [returning, setReturning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decided, setDecided] = useState("");
  useAutoClear(decided, setDecided);

  const stopsById = new Map(stopsFor(requests).map((stop) => [stop.id, stop]));
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const days = view === "day" ? [date] : Array.from({ length: 7 }, (_, index) => addDays(weekStart(date), index));
  const drivers = accounts.filter((account) => account.role === "Driver");
  // Everyone who has asked for a trip, so a schedule can be found by whose request it carries.
  const requesterChoices = [...new Map(requests.map((request) => [request.ownerAccountId, request.ownerName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  // A trip the Admin has marked Done lives on Finished Trips only.
  const visible = schedules
    .filter((schedule) => view === "all" || days.includes(schedule.date))
    .filter((schedule) => finishState(schedule, completions, requestsById) !== "DONE")
    .filter((schedule) => {
      const revision = currentRevision(schedule);
      return (
        formMatches(form, schedule.kind) &&
        (vehicle === "all" || revision?.plate === vehicle) &&
        (driver === "all" || revision?.driverId === driver) &&
        (requester === "all" || (revision?.requestIds ?? []).some((id) => requestsById.get(id)?.ownerAccountId === requester)) &&
        (status === "all" || scheduleState(schedule) === status)
      );
    })
    .map((schedule) => ({ schedule, revision: currentRevision(schedule), time: tripWindow(currentRevision(schedule)?.legs ?? []) }))
    .sort((a, b) => compareSchedules(a.schedule, b.schedule));
  const sorted = sortRows(visible, sort, {
    date: (item) => item.schedule.date + " " + (item.time?.start ?? ""),
    vehicle: (item) => item.revision?.plate ?? "",
    driver: (item) => item.revision?.driverName ?? "",
    status: (item) => scheduleStateLabel[scheduleState(item.schedule)],
  });

  const selected = schedules.find((schedule) => schedule.id === selectedId);
  const selectedRevision = selected && currentRevision(selected);
  const selectedBy = selectedRevision ? scheduledBy(selectedRevision, accounts) : null;
  const editable = (schedule: Schedule) => canEdit && ["DRAFT", "RETURNED"].includes(scheduleState(schedule));
  const revisable = (schedule: Schedule) => canEdit && scheduleState(schedule) === "APPROVED";
  // Admin can cancel any schedule that is still in force and whose trip the
  // Driver hasn't submitted (the server enforces that part).
  const cancellable = (schedule: Schedule) => canReview && schedule.status === "ACTIVE";
  const reviewable = (schedule: Schedule) => canReview && scheduleState(schedule) === "SUBMITTED";

  // What the status means for whoever is looking. A draft only holds time
  // once every leg has times (0033).
  function meaning(schedule: Schedule, legs: { plannedTimeOut: string; plannedTimeIn: string }[]) {
    const state = scheduleState(schedule);
    const mine = canEdit && schedule.createdByAccountId === viewerId;
    if (state === "DRAFT")
      return `${mine ? "You're" : "A Scheduler is"} still planning this. ${tripWindow(legs) ? "Its time is reserved." : "No time is reserved until every leg has times."}`;
    if (state === "RETURNED" && mine) return "An Admin sent this back for changes. Fix it and submit it again.";
    return scheduleStateMeaning[state];
  }

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
  const byText = (revision?: ScheduleRevision) => {
    const by = scheduledBy(revision, accounts);
    return by ? `${by.label} ${by.name}` : "";
  };

  const card = ({ schedule, revision, time }: (typeof visible)[number]) => (
    <button key={schedule.id} className="schedule-card" onClick={() => setSelectedId(schedule.id)}>
      <span className="schedule-card-top">
        <b>
          {view === "all" && dateLabel(schedule.date, { weekday: "short", month: "short", day: "numeric" }) + " · "}
          {time ? `${time.start}–${time.end}` : "No times yet"}
        </b>
        <span className={"status-pill " + scheduleStatePill[scheduleState(schedule)]}>
          {scheduleStateLabel[scheduleState(schedule)]}
        </span>
      </span>
      <span className="schedule-card-vehicle">
        <Car size={13} />
        {/* The week view's narrow columns get the plate alone. */}
        {revision ? (view === "week" ? revision.plate : `${vehicleName(revision.plate)} · ${revision.plate}`) : "—"}
        <User size={13} />
        {revision?.driverName ?? "—"}
      </span>
      <small>{revision && requesters(revision.requestIds)}</small>
      {byText(revision) && <small>{byText(revision)}</small>}
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
          <p>Every schedule by day, by week or across all dates: drafts, those waiting for approval, and approved trips.</p>
        </div>
        {onCreate && (
          <Button className="primary" onClick={onCreate}>
            <CalendarClock size={16} /> Scheduling
          </Button>
        )}
      </div>
      {(decided || notice) && (
        <div className="notice success" role="status">
          {decided || notice}
        </div>
      )}
      {canReview && <CancellationRequests highlightRequestId={initialCancellationId} />}
      <section className="schedule-panel">
        <div className="panel-toolbar schedules-toolbar">
          <div>
            <CalendarDays size={20} />
            <h2>
              {view === "all"
                ? "All dates"
                : view === "day"
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
            <Button variant={view === "all" ? "default" : "outline"} aria-pressed={view === "all"} onClick={() => setView("all")}>
              All dates
            </Button>
            {view !== "all" && (
              <span className="schedules-step">
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
              </span>
            )}
          </div>
        </div>
        <OlderRecordsNotice />
        <FilterFold active={[form, vehicle, driver, requester, status].filter((value) => value !== "all").length + (sort ? 1 : 0)}>
          <label className="field">
            <span>Date</span>
            {/* Picking a date leaves All dates for that day. */}
            <Input
              type="date"
              value={date}
              onChange={(event) => {
                if (!event.target.value) return;
                setDate(event.target.value);
                if (view === "all") setView("day");
              }}
            />
          </label>
          <FormFilter value={form} onChange={setForm} />
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
            <span>Requester</span>
            <Select value={requester} onValueChange={setRequester}>
              <SelectTrigger aria-label="Requester filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Requesters</SelectItem>
                {requesterChoices.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
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
          <SortSelect columns={sortColumns} sort={sort} onSort={setSort} always />
        </FilterFold>
        {view === "week" ? (
          <div className="week-grid">
            {days.map((day) => {
              const dayItems = sorted.filter((item) => item.schedule.date === day);
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
          <div className="day-list">{sorted.map(card)}</div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <CalendarDays size={30} />
            </div>
            <h3>{schedules.length ? "No matching schedules" : "No schedules yet"}</h3>
            <p>
              {!schedules.length
                ? "Schedules you create will appear here."
                : view === "all"
                  ? "Nothing matches these filters. Try clearing a filter."
                  : "Nothing matches this day and these filters. Try another day or clear a filter."}
            </p>
          </div>
        )}
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="review-trip-modal">
          <DialogHeader>
            <DialogTitle>Trip Record</DialogTitle>
            <DialogDescription className="dialog-context">
              {selected && dateLabel(selected.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </DialogDescription>
          </DialogHeader>
          {selected && selectedRevision && (
            <>
              <div className="driver-trip-details">
                {[
                  ["Vehicle", `${vehicleName(selectedRevision.plate)} · ${selectedRevision.plate}`],
                  ["Driver", selectedRevision.driverName],
                  ["Status", scheduleStateLabel[scheduleState(selected)], selectedBy && `${selectedBy.label} ${selectedBy.name}`],
                  ["Version", `v${selectedRevision.version}`],
                ].map(([label, value, note]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    {note && <small className="detail-note">{note}</small>}
                  </div>
                ))}
              </div>
              <p className="helper">{meaning(selected, selectedRevision.legs)}</p>
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
