"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createRequest, currentAccount, getBookingOptions } from "@/lib/kova-api";
import { addDays, manilaToday, requestDateError } from "@/lib/timezone";
import { requestDraftHasContent, useUnsavedChanges } from "@/lib/unsaved-changes";
import { requestDraftMissing, stillNeeded } from "@/lib/missing-fields";
import RequestFields, {
  draftComplete,
  draftToInput,
  emptyDraft,
  optionName,
  type RequestDraft,
} from "./request-fields";

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", options);
const fullDate = (value: string) =>
  dateLabel(value, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** The type a date allows, or null for the 2-6 day gap (and past, for non-Admins). */
function typeFor(date: string, isAdmin: boolean): RequestDraft["requestType"] | null {
  if (!requestDateError(date, "REGULAR", isAdmin)) return "REGULAR";
  if (!requestDateError(date, "URGENT", isAdmin)) return "URGENT";
  return null;
}

/** Why a date card is greyed out, for its tooltip and screen-reader label. */
function unavailableReason(date: string, today: string): string {
  return date < today
    ? "This date has passed."
    : "Dates 2 to 6 days away can't be requested: Regular needs 7 days' notice and Urgent is for today or tomorrow.";
}

export default function RequestFlow({ onSubmitted }: { onSubmitted: () => void }) {
  const account = currentAccount();
  const isAdmin = account?.role === "Admin";
  const today = manilaToday();
  const [step, setStep] = useState(1);
  const [anchor, setAnchor] = useState(today);
  const [draft, setDraft] = useState<RequestDraft>(() => emptyDraft(today, "URGENT"));
  const [options, setOptions] = useState(() => getBookingOptions());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A half-filled request is lost if the Requester leaves.
  useUnsavedChanges("new-request", step === 2 && requestDraftHasContent(draft));

  useEffect(() => {
    const load = () => setOptions(getBookingOptions());
    window.addEventListener("kova-data-update", load);
    return () => window.removeEventListener("kova-data-update", load);
  }, []);

  const days = Array.from({ length: 14 }, (_, index) => addDays(anchor, index));
  const months = [...new Set([days[0], days.at(-1)!].map((day) => dateLabel(day, { month: "long", year: "numeric" })))];
  const dateHint = requestDateError(draft.date, draft.requestType, isAdmin);

  function pickDate(date: string) {
    const allowed = typeFor(date, isAdmin);
    if (!allowed) return;
    // Keep the chosen type if the new date still allows it.
    setDraft({
      ...draft,
      date,
      requestType: requestDateError(date, draft.requestType, isAdmin) ? allowed : draft.requestType,
    });
    setError("");
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await createRequest(draftToInput(draft));
      setReviewOpen(false);
      onSubmitted();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="booking-flow">
      <div className="booking-steps">
        <span className={step === 1 ? "current" : ""}>
          1 <b>Choose date</b>
        </span>
        <i />
        <span className={step === 2 ? "current" : ""}>
          2 <b>Request details</b>
        </span>
        <i />
        <span className={reviewOpen ? "current" : ""}>
          3 <b>Review</b>
        </span>
      </div>
      {step > 1 && (
        <Button variant="ghost" onClick={() => setStep(1)} className="booking-back">
          <ArrowLeft size={16} /> Back
        </Button>
      )}
      <div className="booking-heading">
        <div>
          <h1>{step === 1 ? "When do you need transport?" : "Request details"}</h1>
          <p>
            {step === 1
              ? "Regular requests need at least 7 days' notice. Urgent requests are for today or tomorrow."
              : "Add each destination with its own purpose. A Scheduler assigns the vehicle, Driver and times."}
          </p>
        </div>
        {step > 1 && <b>{dateLabel(draft.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</b>}
      </div>

      {step === 1 && (
        <>
          <div className="request-month" aria-live="polite">
            {months.join(" – ")}
          </div>
          <div className="date-strip-wrap">
            <Button variant="outline" size="icon" aria-label="Previous dates" onClick={() => setAnchor(addDays(anchor, -7))}>
              <ChevronLeft size={18} />
            </Button>
            <div className="date-strip">
              {days.map((day) => {
                const allowed = typeFor(day, isAdmin);
                return (
                  <button
                    key={day}
                    className={"date-card " + (draft.date === day ? "selected" : "")}
                    onClick={() => pickDate(day)}
                    aria-pressed={draft.date === day}
                    aria-label={allowed ? fullDate(day) : `${fullDate(day)}, not available. ${unavailableReason(day, today)}`}
                    title={allowed ? undefined : unavailableReason(day, today)}
                    disabled={!allowed}
                  >
                    <span>{dateLabel(day, { weekday: "short" })}</span>
                    <b>{dateLabel(day, { day: "numeric" })}</b>
                    <small>{allowed === "URGENT" ? "URGENT" : allowed === "REGULAR" ? (day < today ? "PAST" : "●") : "—"}</small>
                  </button>
                );
              })}
            </div>
            <Button variant="outline" size="icon" aria-label="Next dates" onClick={() => setAnchor(addDays(anchor, 7))}>
              <ChevronRight size={18} />
            </Button>
          </div>
          <p className="date-legend">
            <b>URGENT</b> today or tomorrow · <b>●</b> Regular, at least 7 days ahead · <b>—</b> can&apos;t be requested
            (in the past, or 2 to 6 days away){isAdmin && <> · <b>PAST</b> already happened (Admin only)</>}
          </p>
          <div className="date-other">
            <label>
              Jump to date{" "}
              <Input
                type="date"
                value={draft.date}
                min={isAdmin ? undefined : today}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  setAnchor(value);
                  if (typeFor(value, isAdmin)) pickDate(value);
                  else setError("That date isn't available: dates 2 to 6 days away can't be requested.");
                }}
              />
            </label>
          </div>
          {isAdmin && (
            <p className="helper">As an Admin you can also request a past date, for a trip that already happened.</p>
          )}
        </>
      )}

      {step === 2 && (
        <section className="availability-card">
          <RequestFields
            draft={draft}
            onChange={setDraft}
            options={options}
            requestedBy={account?.name ?? ""}
            dateHint={dateHint}
          />
          <p className="helper">Only active choices appear. No vehicle, Driver or time is chosen at this stage.</p>
        </section>
      )}

      {error && !reviewOpen && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}

      <div className="booking-bottom">
        <div>
          <span>{fullDate(draft.date)}</span>
          {step === 2 && (
            <span>
              {draft.requestType === "URGENT" ? "Urgent" : "Regular"} · {draft.destinations.length}{" "}
              {draft.destinations.length === 1 ? "destination" : "destinations"}
            </span>
          )}
          {step === 2 && (
            <span role="status">{stillNeeded(requestDraftMissing(draft)) || dateHint}</span>
          )}
        </div>
        <Button
          className="booking-continue"
          disabled={busy || (step === 1 ? !typeFor(draft.date, isAdmin) : !draftComplete(draft) || !!dateHint)}
          onClick={() => {
            setError("");
            if (step === 1) setStep(2);
            else setReviewOpen(true);
          }}
        >
          {step === 1 ? "Continue — " + dateLabel(draft.date, { weekday: "short", month: "short", day: "numeric" }) : "Review request"}
        </Button>
      </div>

      <Dialog open={reviewOpen} onOpenChange={(open) => !busy && setReviewOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review request</DialogTitle>
            <DialogDescription>{fullDate(draft.date)}</DialogDescription>
          </DialogHeader>
          <div className="booking-details">
            <p>
              <b>Type:</b> {draft.requestType === "URGENT" ? "Urgent" : "Regular"}
            </p>
            <p>
              <b>Requested by:</b> {account?.name}
            </p>
            <p>
              <b>Project / Site:</b>{" "}
              {draft.projectOtherMode ? draft.projectOther.trim() : optionName(options.projects, draft.projectId) || "None"}
            </p>
            <ol className="request-review-list">
              {draft.destinations.map((item) => (
                <li key={item.key}>
                  <b>{optionName(options.destinations, item.destinationId)}</b> —{" "}
                  {optionName(options.purposes, item.purposeId)}
                </li>
              ))}
            </ol>
          </div>
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="booking-dialog-actions">
            <Button variant="outline" disabled={busy} onClick={() => setReviewOpen(false)}>
              Go back
            </Button>
            <Button className="primary" disabled={busy} onClick={submit}>
              {busy ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
