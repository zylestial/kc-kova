"use client";
import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
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
import {
  currentAccount,
  cancelRequest,
  getBookingOptions,
  getCancellations,
  getMyRequests,
  hydrateKovaData,
  requestCancellation,
  updateRequest,
  type RequestProgress,
  type TransportRequest,
} from "@/lib/kova-api";
import { requestDateError } from "@/lib/timezone";
import RequestFields, {
  draftComplete,
  draftFromRequest,
  draftToInput,
  keptOptions,
  type RequestDraft,
} from "./request-fields";
import { requestProgressLabel, requestProgressMeaning } from "@/lib/status-text";
import { requestDraftMissing, stillNeeded } from "@/lib/missing-fields";

// Reuses the existing status-pill colours.
const progressPill: Record<RequestProgress, string> = {
  NOT_YET_SCHEDULED: "pending",
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
const destinationsText = (request: TransportRequest) =>
  request.destinations.map((item) => item.destinationName).join(" → ");

/** Only the owner's unscheduled, active requests can be edited. */
const editable = (request: TransportRequest) => request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED";

/** Cancellable until the Driver submits the trip; after that it's a finished record. */
const canCancel = (request: TransportRequest) =>
  request.status === "ACTIVE" && !request.cancellationPending && !["COMPLETED", "DONE"].includes(request.progress);

export default function MyRequests({ notice }: { notice?: string }) {
  const account = currentAccount();
  const isAdmin = account?.role === "Admin";
  const [requests, setRequests] = useState<TransportRequest[]>([]);
  const [options, setOptions] = useState(() => getBookingOptions());
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function refresh() {
      setRequests(
        getMyRequests(account?.id ?? "").sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      );
      setOptions(getBookingOptions());
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, [account?.id]);

  // Keep the details modal showing the latest copy after a refresh.
  const shown = selected ? requests.find((item) => item.id === selected.id) ?? selected : null;

  function openEdit(request: TransportRequest) {
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
      if (cancelling.progress === "NOT_YET_SCHEDULED") await cancelRequest(cancelling.id);
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
    ? getCancellations()
        .filter((item) => item.requestId === shown.id && item.status === "DECLINED")
        .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0]
    : undefined;

  const dateChanged = !!editing && !!draft && (draft.date !== editing.date || draft.requestType !== editing.requestType);
  const dateHint = draft && dateChanged ? requestDateError(draft.date, draft.requestType, isAdmin) : "";

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
      </div>
      {notice && (
        <div className="notice success" role="status">
          {notice}
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
            <span className="count">{requests.length}</span>
          </div>
        </div>
        {requests.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {["DATE", "TYPE", "PROJECT / SITE", "DESTINATIONS", "PROGRESS", "SUBMITTED", ""].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id} onClick={() => { setSelected(request); setError(""); }}>
                    <td>{dateLabel(request.date)}</td>
                    <td>
                      <span className={"badge " + (request.requestType === "URGENT" ? "urgent" : "")}>{request.requestType}</span>
                    </td>
                    <td>{projectText(request)}</td>
                    <td>{destinationsText(request)}</td>
                    <td>
                      <span className={"status-pill " + progressPill[request.progress]}>{requestProgressLabel[request.progress]}</span>
                      {request.cancellationPending && <small>Cancellation requested</small>}
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
            <h3>No requests yet</h3>
            <p>Transport you request will appear here.</p>
          </div>
        )}
      </section>

      <Dialog open={!!shown} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request details</DialogTitle>
            <DialogDescription>{shown && dateLabel(shown.date)}</DialogDescription>
          </DialogHeader>
          {shown && (
            <>
              <div className="driver-trip-details">
                {[
                  ["Type", shown.requestType === "URGENT" ? "Urgent" : "Regular"],
                  ["Requested by", shown.ownerName],
                  ["Project / Site", projectText(shown)],
                  ["Progress", requestProgressLabel[shown.progress]],
                  ["Submitted", submittedLabel(shown.createdAt)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="helper">{requestProgressMeaning[shown.progress]}</p>
              <span className="summary-label">Destinations</span>
              <ol className="request-review-list">
                {shown.destinations.map((item) => (
                  <li key={item.id}>
                    <b>{item.destinationName}</b> — {item.purposeName}
                  </li>
                ))}
              </ol>
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
                    {shown.progress === "NOT_YET_SCHEDULED" ? "Cancel request" : "Request cancellation"}
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
            <DialogTitle>{cancelling?.progress === "NOT_YET_SCHEDULED" ? "Cancel this request?" : "Ask to cancel this request?"}</DialogTitle>
            <DialogDescription>
              {cancelling && dateLabel(cancelling.date)} — {cancelling && destinationsText(cancelling)}
            </DialogDescription>
          </DialogHeader>
          {cancelling?.progress === "NOT_YET_SCHEDULED" ? (
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
              className={cancelling?.progress === "NOT_YET_SCHEDULED" ? "danger" : "primary"}
              disabled={busy}
              onClick={confirmCancel}
            >
              {busy ? "Working…" : cancelling?.progress === "NOT_YET_SCHEDULED" ? "Cancel request" : "Send to Admin"}
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
            <DialogDescription>Changes are saved only if nobody has started scheduling this request. The same notice rules apply: Regular requests need at least 7 days, Urgent requests are for today or tomorrow.</DialogDescription>
          </DialogHeader>
          {editing && draft && (
            <>
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
