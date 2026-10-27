"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { anyDate, inDateFilter, type DateFilter } from "@/lib/date-range";
import OlderRecordsNotice from "./older-records-notice";
import DateRangeFilter from "./date-range-filter";
import FilterFold from "./filter-fold";
import FormFilter, { formMatches, type FormFilterValue } from "./form-filter";
import { kindOf } from "@/lib/scheduling";
import {
  currentAccount,
  cancelRequest,
  hydrateKovaData,
  moveSentBackStop,
  requestCancellation,
  updateRequest,
  type RequestProgress,
  type TransportRequest,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { requestScheduledBy } from "@/lib/scheduled-by";
import { manilaToday, requestDateError, requestTypeFor } from "@/lib/timezone";
import RequestFields, {
  draftComplete,
  draftFromRequest,
  draftToInput,
  keptOptions,
  type RequestDraft,
} from "./request-fields";
import { requestProgressLabel, requestProgressMeaning } from "@/lib/status-text";
import { requestDraftMissing, stillNeeded } from "@/lib/missing-fields";
import { flexibilityShort, whenText } from "@/lib/request-draft";

// Reuses the existing status-pill colours.
const progressPill: Record<RequestProgress, string> = {
  NOT_YET_SCHEDULED: "pending",
  SENT_BACK: "rejected",
  SCHEDULING: "pending",
  PENDING_APPROVAL: "pending",
  APPROVED: "scheduled",
  COMPLETED: "scheduled",
  DONE: "scheduled",
  CANCELLED: "cancelled",
};
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const submittedLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const projectText = (request: TransportRequest) => request.projectName || "—";
/** "52-A" for a stop of a request group; "" for a request made before groups. */
const stopNumber = (request: TransportRequest) => (request.group ? `${request.group.number}-${request.stopLetter}` : "");
const destinationsText = (request: TransportRequest) =>
  request.destinations.map((item) => item.destinationName).join(" → ");

/** No schedule holds it: never planned, or sent back to pick another day. */
const unscheduled = (request: TransportRequest) => request.progress === "NOT_YET_SCHEDULED" || request.progress === "SENT_BACK";

/** Only the owner's unscheduled, active requests can be edited. */
const editable = (request: TransportRequest) => request.status === "ACTIVE" && unscheduled(request);

/** Cancellable until the Driver submits the trip; after that it's a finished record. */
const canCancel = (request: TransportRequest) =>
  request.status === "ACTIVE" && !request.cancellationPending && !["COMPLETED", "DONE"].includes(request.progress);

export default function MyRequests({
  notice,
  openRequestId,
  initialProgress,
}: {
  notice?: string;
  openRequestId?: string;
  /** A progress to filter by from the start, e.g. from a Dashboard tile. */
  initialProgress?: RequestProgress;
}) {
  const router = useRouter();
  const account = currentAccount();
  const isAdmin = account?.role === "Admin";
  const { requests: allRequests, options, cancellations, schedules, accounts } = useKovaData();
  const requests = useMemo(
    () =>
      allRequests
        .filter((item) => item.ownerAccountId === account?.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [allRequests, account?.id],
  );
  const [selected, setSelected] = useState<TransportRequest | null>(null);
  // The request as it was when Edit was opened: its rowVersion is what the
  // save is checked against, so a form left open can't overwrite a newer
  // change or a request that has since been scheduled.
  const [editing, setEditing] = useState<TransportRequest | null>(null);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  // Cancelling asks for a confirmation first. An unscheduled request is
  // cancelled on the spot; one a schedule holds goes to an Admin.
  const [cancelling, setCancelling] = useState<TransportRequest | null>(null);
  const [reason, setReason] = useState("");
  const [newDay, setNewDay] = useState("");
  const [moved, setMoved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dates, setDates] = useState<DateFilter>(anyDate);
  const [progress, setProgress] = useState<"all" | RequestProgress>(initialProgress ?? "all");
  const [type, setType] = useState<"all" | TransportRequest["requestType"]>("all");
  const [form, setForm] = useState<FormFilterValue>("all");

  // Opens straight into a specific request when arriving from a notification.
  useEffect(() => {
    if (!openRequestId) return;
    const match = requests.find((item) => item.id === openRequestId);
    if (match) queueMicrotask(() => setSelected(match));
    // Only re-run when the target id changes or the list first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestId, requests.length]);

  const today = manilaToday();
  const visible = requests.filter(
    (request) =>
      inDateFilter(request.date, dates, today) &&
      (progress === "all" || request.progress === progress) &&
      (type === "all" || request.requestType === type) &&
      formMatches(form, kindOf(request)),
  );

  // Keep the details modal showing the latest copy after a refresh.
  const shown = selected ? requests.find((item) => item.id === selected.id) ?? selected : null;
  const shownBy = shown && requestScheduledBy(shown.id, schedules, accounts);
  // A sent-back stop whose request is partly being scheduled can't change
  // the request's date, so it can go on another day as a request of its own (0081).
  const canMoveDay =
    !!shown?.group &&
    shown.status === "ACTIVE" &&
    shown.progress === "SENT_BACK" &&
    requests.some((item) => item.group?.id === shown.group!.id && item.id !== shown.id && item.status === "ACTIVE" && !unscheduled(item));

  async function moveToNewDay() {
    if (!shown || !newDay) return;
    setBusy(true);
    setError("");
    try {
      await moveSentBackStop(shown.id, newDay);
      setMoved(`Stop ${stopNumber(shown)} is now a request of its own on ${dateLabel(newDay)}, back with the Scheduler.`);
      setSelected(null);
      setNewDay("");
    } catch (caught) {
      setError((caught as Error).message);
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  function openEdit(request: TransportRequest) {
    // A request made on the new form opens there, with all its stops.
    if (request.group) {
      router.push("/requests/new?edit=" + encodeURIComponent(request.group.id));
      return;
    }
    setEditing(request);
    setDraft(draftFromRequest(request));
    setSelected(null);
    setError("");
  }

  async function save() {
    if (!editing || !draft) return;
    setBusy(true);
    setError("");
    try {
      await updateRequest(editing.id, editing.rowVersion, draftToInput(draft));
      setEditing(null);
      setDraft(null);
    } catch (caught) {
      setError((caught as Error).message);
      // Pull the current state so the list shows why (e.g. now Scheduling).
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setBusy(true);
    setError("");
    try {
      if (unscheduled(cancelling)) await cancelRequest(cancelling.id);
      else await requestCancellation(cancelling.id, reason.trim());
      setCancelling(null);
      setReason("");
    } catch (caught) {
      setError((caught as Error).message);
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const declined = shown
    ? cancellations
        .filter((item) => item.requestId === shown.id && item.status === "DECLINED")
        .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0]
    : undefined;

  // The type follows the date, but only once the date changes (as the server does).
  const dateChanged = !!editing && !!draft && draft.date !== editing.date;
  const dateHint = draft && dateChanged ? requestDateError(draft.date, isAdmin) : "";
  const editType = draft && dateChanged ? requestTypeFor(draft.date) : (editing?.requestType ?? "REGULAR");

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{account?.role.toUpperCase()}</div>
          <h1>
            My requests<span className="title-dot">.</span>
          </h1>
          <p>Every transport request you&apos;ve submitted, and how far along it is.</p>
        </div>
        {/* New request lives here and on Home, not in the menu. */}
        <Button className="primary" onClick={() => router.push("/requests/new")}>
          <FilePlus2 size={16} /> New request
        </Button>
      </div>
      {(moved || notice) && (
        <div className="notice success" role="status">
          {moved || notice}
        </div>
      )}
      {error && !editing && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <ClipboardList size={20} />
            <h2>Your requests</h2>
            <span className="count">{visible.length}</span>
          </div>
        </div>
        <OlderRecordsNotice />
        {requests.length > 0 && (
          <FilterFold active={(dates.preset !== "any" ? 1 : 0) + [progress, type, form].filter((value) => value !== "all").length}>
            <DateRangeFilter value={dates} onChange={setDates} />
            {requests.some((request) => kindOf(request) === "COMPANY") && <FormFilter value={form} onChange={setForm} />}
            <label className="field">
              <span>Progress</span>
              <Select value={progress} onValueChange={(value) => setProgress(value as typeof progress)}>
                <SelectTrigger aria-label="Progress filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(Object.keys(requestProgressLabel) as RequestProgress[]).map((item) => (
                    <SelectItem key={item} value={item}>
                      {requestProgressLabel[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="field">
              <span>Type</span>
              <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                <SelectTrigger aria-label="Type filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                  <SelectItem value="REGULAR">Regular</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </FilterFold>
        )}
        {visible.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {["REQUEST", "DATE", "TYPE", "PROJECT / SITE", "DESTINATIONS", "PROGRESS", "SUBMITTED", ""].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((request) => (
                  <tr key={request.id} onClick={() => { setSelected(request); setError(""); }}>
                    <td>
                      {stopNumber(request) || "—"}
                      {request.group?.form === "COMPANY" && <small>Company trip</small>}
                    </td>
                    <td>
                      {dateLabel(request.date)}
                      {request.group && <small>{flexibilityShort(request.date, request.flexibility, request.fixedTime ?? "")}</small>}
                    </td>
                    <td>
                      <span className={"badge " + (request.requestType === "URGENT" ? "urgent" : "")}>{request.requestType}</span>
                    </td>
                    <td>{projectText(request)}</td>
                    <td>{destinationsText(request)}</td>
                    <td>
                      <span className={"status-pill " + progressPill[request.progress]}>{requestProgressLabel[request.progress]}</span>
                      {request.cancellationPending && <small>Cancellation requested</small>}
                      {request.status === "ACTIVE" && request.progress === "SENT_BACK" && <small>Fix it and save to resend</small>}
                    </td>
                    <td>{submittedLabel(request.createdAt)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(request);
                          setError("");
                        }}
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <ClipboardList size={30} />
            </div>
            <h3>{requests.length ? "No matching requests" : "No requests yet"}</h3>
            <p>{requests.length ? "Try another filter." : "Transport you request will appear here."}</p>
          </div>
        )}
      </section>

      <Dialog open={!!shown} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request details</DialogTitle>
            <DialogDescription className="dialog-context">
              {shown && (stopNumber(shown) ? `Request ${stopNumber(shown)} · ` : "") + dateLabel(shown.date)}
            </DialogDescription>
          </DialogHeader>
          {shown && (
            <>
              <div className="driver-trip-details">
                {[
                  ["Type", shown.urgentReason ? `Urgent: ${shown.urgentReason.name}` : shown.requestType === "URGENT" ? "Urgent" : "Regular"],
                  ...(shown.group ? [["When", whenText(shown.date, shown.flexibility, shown.fixedTime ?? "")]] : []),
                  ...(shown.group?.form === "COMPANY"
                    ? [
                        ["Form", "Company Trip"],
                        ["Vehicle", shown.group.vehiclePlate ?? "—"],
                        ["Driver", shown.group.driver?.name ?? "—"],
                        ["Starting point", shown.group.startingPoint?.name ?? "—"],
                        ["Department / Site", shown.group.department?.name ?? "—"],
                      ]
                    : []),
                  ["Requested by", shown.ownerName],
                  ["Project / Site", projectText(shown)],
                  ["Progress", requestProgressLabel[shown.progress]],
                  ...(shownBy ? [[shownBy.label, shownBy.name]] : []),
                  ["Submitted", submittedLabel(shown.createdAt)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="helper">{requestProgressMeaning[shown.progress]}</p>
              {shown.progress === "SENT_BACK" && shown.sentBack?.reason && (
                <p className="helper">
                  <b>Scheduler&apos;s note:</b> {shown.sentBack.reason}
                </p>
              )}
              {canMoveDay && (
                <div className="move-day">
                  <p className="helper">
                    The rest of request {shown.group!.number} is being scheduled, so its date can&apos;t change. To ask for this
                    stop on another day, pick the day: it becomes a request of its own and goes back to the Scheduler.
                  </p>
                  <label className="field">
                    <span>New day</span>
                    <Input type="date" min={today} value={newDay} onChange={(event) => setNewDay(event.target.value)} />
                  </label>
                  {error && (
                    <p className="modal-error" role="alert">
                      {error}
                    </p>
                  )}
                  <Button className="primary" disabled={busy || !newDay || (newDay < today && !isAdmin)} onClick={moveToNewDay}>
                    {busy ? "Moving…" : "Move to this day"}
                  </Button>
                </div>
              )}
              <span className="summary-label">Destinations</span>
              <ol className="request-review-list">
                {shown.destinations.map((item) => (
                  <li key={item.id}>
                    <b>{item.destinationName}</b> — {item.purposeName}
                  </li>
                ))}
              </ol>
              {shown.details && (
                <p className="helper">
                  <b>Details:</b> {shown.details}
                </p>
              )}
              {shown.supplier && (
                <p className="helper">
                  <b>Supplier:</b> {shown.supplier.name}
                </p>
              )}
              {shown.contact && (
                <p className="helper">
                  <b>Contact:</b> {shown.contact}
                </p>
              )}
              {!editable(shown) && shown.status === "ACTIVE" && (
                <p className="helper">This request is being scheduled, so it can no longer be edited.</p>
              )}
              {shown.cancellationPending && (
                <p className="helper">You asked to cancel this request. An Admin will confirm or decline it; the trip stays as planned until then.</p>
              )}
              {declined && !shown.cancellationPending && (
                <p className="helper">Your cancellation request was declined: {declined.decisionNote}</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Close
                </Button>
                {canCancel(shown) && (
                  <Button
                    variant="outline"
                    className="danger-outline"
                    onClick={() => {
                      setCancelling(shown);
                      setSelected(null);
                      setReason("");
                      setError("");
                    }}
                  >
                    {unscheduled(shown) ? "Cancel request" : "Request cancellation"}
                  </Button>
                )}
                {editable(shown) && (
                  <Button className="primary" onClick={() => openEdit(shown)}>
                    Edit
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!cancelling}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setCancelling(null);
            setError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cancelling && unscheduled(cancelling) ? "Cancel this request?" : "Ask to cancel this request?"}</DialogTitle>
            <DialogDescription>
              {cancelling && dateLabel(cancelling.date)} — {cancelling && destinationsText(cancelling)}
            </DialogDescription>
          </DialogHeader>
          {cancelling && unscheduled(cancelling) ? (
            <p className="helper">The request is cancelled right away. It stays in your list as Cancelled.</p>
          ) : (
            <>
              <p className="helper">
                This request is already in a schedule. The trip stays as planned until an Admin confirms the cancellation.
              </p>
              <label className="field">
                <span>Reason (optional)</span>
                <Textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
              </label>
            </>
          )}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => { setCancelling(null); setError(""); }}>
              Keep request
            </Button>
            <Button
              className={cancelling && unscheduled(cancelling) ? "danger" : "primary"}
              disabled={busy}
              onClick={confirmCancel}
            >
              {busy ? "Working…" : cancelling && unscheduled(cancelling) ? "Cancel request" : "Send to Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setEditing(null);
            setDraft(null);
            setError("");
          }
        }}
      >
        <DialogContent className="edit-booking-modal">
          <DialogHeader>
            <DialogTitle>Edit request</DialogTitle>
            <DialogDescription>Changes are saved only if nobody has started scheduling this request. A new date sets the type again: Urgent for today up to 6 days ahead, Regular for 7 or more days ahead.</DialogDescription>
          </DialogHeader>
          {editing && draft && (
            <>
              {editing.progress === "SENT_BACK" && (
                <p className="helper" role="status">
                  {draft.date < manilaToday()
                    ? "That day has passed. Choose a new date to send it to the Scheduler again."
                    : "Saving sends the request back to the Scheduler's pool."}
                </p>
              )}
              <label className="field">
                <span>Date *</span>
                <Input
                  type="date"
                  value={draft.date}
                  onChange={(event) => event.target.value && setDraft({ ...draft, date: event.target.value })}
                />
              </label>
              <RequestFields
                draft={draft}
                onChange={setDraft}
                options={options}
                requestedBy={editing.ownerName}
                requestType={editType}
                kept={keptOptions(editing)}
                dateHint={dateHint}
              />
            </>
          )}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          {draft && stillNeeded(requestDraftMissing(draft)) && (
            <p className="helper" role="status">
              {stillNeeded(requestDraftMissing(draft))}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setDraft(null);
                setError("");
              }}
            >
              Go back
            </Button>
            <Button className="primary" disabled={busy || !draft || !draftComplete(draft) || !!dateHint} onClick={save}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
