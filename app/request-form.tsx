"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addBookingOption, type BookingOption, type BookingOptions, type OptionGroup, type StopFlexibility } from "@/lib/kova-api";
import { SearchSelect } from "@/app/search-select";
import RequestConfirmDialog from "@/app/request-confirm-dialog";
import { addDays, manilaToday, requestDateError } from "@/lib/timezone";
import { stillNeeded } from "@/lib/missing-fields";
import { destinationChoices } from "@/lib/choice-lists";
import {
  DETAILS_MAX,
  FLEXIBILITY,
  STOPS_MAX,
  draftMissing,
  emptyStop,
  needsDetails,
  stopErrors,
  stopLetter,
  stopPurpose,
  weekLabel,
  whenText,
  type RequestDraft,
  type StopDraft,
} from "@/lib/request-draft";

/** Choices an edit already uses stay offered after they're made Inactive (the server lets an edit keep them). */
export type KeptChoices = Partial<Record<OptionGroup, Array<{ id: string; name: string }>>> & {
  vehicle?: { id: string; name: string };
  driver?: { id: string; name: string };
};

function choices(list: BookingOption[], kept: Array<{ id: string; name: string }> = []) {
  const active = list.filter((item) => item.status === "Active").map((item) => ({ id: item.id, name: item.name }));
  for (const item of kept)
    if (item.id && !active.some((option) => option.id === item.id)) active.push({ id: item.id, name: `${item.name} (inactive)` });
  return active;
}

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", options);
const fullDate = (value: string) => dateLabel(value, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** A name typed under the old "Other…" on a saved request, shown as its choice. */
const TYPED = "__typed__";

/**
 * A list choice you type into (app/search-select.tsx). With addTo, a name
 * that isn't on the list can be added to it for everyone (0098).
 */
function ChoiceField({
  label,
  placeholder,
  list,
  id,
  other,
  otherMode,
  addTo,
  error,
  disabled,
  noneLabel,
  hint,
  onPick,
}: {
  label: string;
  placeholder: string;
  list: Array<{ id: string; name: string }>;
  id: string;
  other: string;
  otherMode: boolean;
  addTo?: "destinations" | "purposes";
  error?: string;
  disabled?: boolean;
  /** An optional field: this first choice clears it. */
  noneLabel?: string;
  hint?: string;
  onPick: (change: { id: string; other: string; otherMode: boolean }) => void;
}) {
  const typed = otherMode && other.trim() ? [{ id: TYPED, name: other.trim() }] : [];
  return (
    <div className="field">
      <span>{label}</span>
      <SearchSelect
        label={label}
        value={otherMode ? TYPED : id}
        options={[...typed, ...list]}
        placeholder={placeholder}
        noneLabel={noneLabel}
        disabled={disabled}
        invalid={!!error}
        onPick={(value) => value !== TYPED && onPick({ id: value, other: "", otherMode: false })}
        onAdd={addTo ? (name) => addBookingOption(addTo, name) : undefined}
      />
      {hint && <small className="field-note">{hint}</small>}
      {error && <small className="field-hint">{error}</small>}
    </div>
  );
}

/**
 * The Daily Vehicle Trip form (New Request prototype): the date, one or
 * several projects, then a card per stop, with a live summary beside it.
 * Used to create a request and to edit one (stops that are being scheduled
 * are shown but locked). Company trips have their own form
 * (company-trip-form.tsx).
 */
export default function RequestForm({
  draft,
  onChange,
  options,
  isAdmin,
  requestedBy,
  kept = {},
  usedLetters = 0,
  dateLocked = false,
  number,
  busy,
  error,
  submitLabel,
  onSubmit,
  onCancel,
  cancelLabel,
}: {
  draft: RequestDraft;
  onChange: (draft: RequestDraft) => void;
  options: BookingOptions;
  isAdmin: boolean;
  requestedBy: string;
  kept?: KeptChoices;
  /** How many stops the saved request has had, cancelled ones included, so new stops get the next letters. */
  usedLetters?: number;
  /** Part of the request is being scheduled: its date and trip details can't change. */
  dateLocked?: boolean;
  /** The saved request's number, when editing. */
  number?: number;
  busy: boolean;
  error: string;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const today = manilaToday();
  const [anchor, setAnchor] = useState(() => (draft.date < today && !isAdmin ? today : draft.date));
  // Errors show under each field only after the first Send, as in the prototype.
  const [showErrors, setShowErrors] = useState(false);
  // Send asks first, listing what is being sent.
  const [confirming, setConfirming] = useState(false);
  const projects = choices(options.projects, kept.projects);
  const destinations = destinationChoices(options.destinations, kept.destinations);
  const purposes = choices(options.purposes, kept.purposes);
  const urgentReasons = choices(options.urgent_reasons, kept.urgent_reasons);
  const missing = draftMissing(draft, options, usedLetters);
  const dateError = requestDateError(draft.date, isAdmin);
  const days = Array.from({ length: 14 }, (_, index) => addDays(anchor, index));
  const months = [...new Set([days[0], days.at(-1)!].map((day) => dateLabel(day, { month: "long", year: "numeric" })))];
  const letter = (index: number) => stopLetter(draft, index, usedLetters);
  const prefix = number ? `${number}-` : "";

  const setStop = (key: string, change: Partial<StopDraft>) =>
    onChange({ ...draft, stops: draft.stops.map((stop) => (stop.key === key ? { ...stop, ...change } : stop)) });
  const moveStop = (index: number, by: number) => {
    const stops = [...draft.stops];
    [stops[index], stops[index + by]] = [stops[index + by], stops[index]];
    onChange({ ...draft, stops });
  };
  const projectName = (from: { projectId: string; projectOther: string; projectOtherMode: boolean }) =>
    from.projectOtherMode ? from.projectOther.trim() : (projects.find((item) => item.id === from.projectId)?.name ?? "");
  const stopProjectName = (stop: StopDraft) => projectName(draft.projectMode === "one" ? draft : stop);
  const stopDestination = (stop: StopDraft) =>
    stop.destinationOtherMode ? stop.destinationOther.trim() : (destinations.find((item) => item.id === stop.destinationId)?.name ?? "");
  const summaryProjects = [...new Set(draft.stops.map(stopProjectName).filter(Boolean))].join(", ");
  function send() {
    setShowErrors(true);
    if (missing.length || dateError) {
      // Bring the first field that needs something into view.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".request-form [aria-invalid=true]")?.focus());
      return;
    }
    setConfirming(true);
  }
  const confirmRows = [
    { label: "Date", value: draft.date ? fullDate(draft.date) : "" },
    { label: draft.projectMode === "one" ? "Project / Site" : "Projects / Sites", value: summaryProjects },
    ...draft.stops.map((stop, index) => {
      const urgent = stop.urgent ? `Urgent: ${urgentReasons.find((item) => item.id === stop.urgentReasonId)?.name ?? ""}` : "Regular";
      const what = [stopDestination(stop), stop.urgent ? "" : stopPurpose(stop, options), urgent, whenText(draft.date, stop.flexibility, stop.fixedTime)];
      return { label: `Stop ${letter(index)}`, value: what.filter(Boolean).join(" · ") };
    }),
  ];

  return (
    <div className="request-form">
      <div className="request-form-grid">
        <div className="request-form-main">
          <section className="request-panel">
            <div className="request-step">Step 1</div>
            <h2>Choose date</h2>
            <p>Select the date the vehicle is needed.</p>
            {dateLocked ? (
              <p className="request-locked-note">
                <b>{fullDate(draft.date)}</b>. Part of this request is being scheduled, so its date can no longer change.
              </p>
            ) : (
              <>
                <div className="request-month" aria-live="polite">
                  {months.join(" – ")}
                </div>
                <div className="date-strip-wrap">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous dates"
                    disabled={!isAdmin && anchor <= today}
                    onClick={() => {
                      const back = addDays(anchor, -7);
                      setAnchor(isAdmin || back > today ? back : today);
                    }}
                  >
                    <ChevronLeft size={18} />
                  </Button>
                  <div className="date-strip">
                    {days.map((day) => {
                      const passed = !!requestDateError(day, isAdmin);
                      return (
                        <button
                          key={day}
                          type="button"
                          className={"date-card " + (draft.date === day ? "selected" : "")}
                          onClick={() => onChange({ ...draft, date: day })}
                          aria-pressed={draft.date === day}
                          aria-label={passed ? `${fullDate(day)}, not available. This date has passed.` : fullDate(day)}
                          title={passed ? "This date has passed." : undefined}
                          disabled={passed}
                        >
                          <span>{dateLabel(day, { weekday: "short" })}</span>
                          <b>{dateLabel(day, { day: "numeric" })}</b>
                          {day < today && <small>PAST</small>}
                        </button>
                      );
                    })}
                  </div>
                  <Button variant="outline" size="icon" aria-label="Next dates" onClick={() => setAnchor(addDays(anchor, 7))}>
                    <ChevronRight size={18} />
                  </Button>
                </div>
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
                        onChange({ ...draft, date: value });
                      }}
                    />
                  </label>
                </div>
                {dateError && <small className="field-hint">{dateError}</small>}
                {isAdmin && <p className="request-note">Admins may select a past date to record a completed trip.</p>}
              </>
            )}
          </section>

          <section className="request-panel">
            <div className="request-step">Step 2</div>
            <h2>Is this for one project/site or several?</h2>
            <div className="request-choice-cards" role="radiogroup" aria-label="Projects or sites">
                {(
                  [
                    ["one", "Single project/site", "Every destination is for the same project or site."],
                    ["multi", "Multiple projects/sites", "Select the project or site for each destination."],
                  ] as const
                ).map(([value, title, hint]) => (
                  <label key={value} className={draft.projectMode === value ? "checked" : ""}>
                    <input
                      type="radio"
                      name="project-mode"
                      value={value}
                      checked={draft.projectMode === value}
                      onChange={() => {
                        // Going to Multiple starts every stop on the single project, so nothing is lost.
                        if (value === "multi" && draft.projectMode === "one")
                          onChange({
                            ...draft,
                            projectMode: "multi",
                            stops: draft.stops.map((stop) =>
                              stop.locked || stop.projectId || stop.projectOther
                                ? stop
                                : { ...stop, projectId: draft.projectId, projectOther: draft.projectOther, projectOtherMode: draft.projectOtherMode },
                            ),
                          });
                        else onChange({ ...draft, projectMode: value });
                      }}
                    />
                    <span>
                      {title}
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            {draft.projectMode === "one" && (
              <div className="request-project">
                <ChoiceField
                  label="Project / Site"
                  placeholder="Select"
                  list={projects}
                  id={draft.projectId}
                  other={draft.projectOther}
                  otherMode={draft.projectOtherMode}
                  error={showErrors && missing.includes("Project / Site") ? "Select the project or site." : undefined}
                  onPick={(pick) => onChange({ ...draft, projectId: pick.id, projectOther: pick.other, projectOtherMode: pick.otherMode })}
                />
              </div>
            )}
          </section>

          <section className="request-panel">
            <div className="request-step">Step 3</div>
            <h2>Where should the vehicle go?</h2>
            <p>Add each destination with {draft.projectMode === "multi" ? "its project, " : ""}the required time and priority.</p>
            {draft.stops.map((stop, index) => {
              const errors = showErrors ? stopErrors(draft, stop, options) : {};
              const name = `Stop ${letter(index)}`;
              const locked = stop.locked;
              return (
                <div key={stop.key} className={"request-stop" + (stop.urgent ? " urgent" : "") + (locked ? " locked" : "")}>
                  <div className="request-stop-head">
                    <b>{name}</b>
                    <span className="request-priority" role="radiogroup" aria-label={`Priority for ${name}`}>
                      {(
                        [
                          [false, "Regular"],
                          [true, "Urgent"],
                        ] as const
                      ).map(([urgent, label]) => (
                        <label key={label} className={(stop.urgent === urgent ? "checked " : "") + (urgent ? "urgent" : "")}>
                          <input
                            type="radio"
                            name={`priority-${stop.key}`}
                            checked={stop.urgent === urgent}
                            disabled={locked}
                            onChange={() => setStop(stop.key, { urgent })}
                          />
                          {label}
                        </label>
                      ))}
                    </span>
                    <span className="request-stop-gap" />
                    {draft.stops.length > 1 && (
                      <>
                        <Button variant="ghost" size="icon" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => moveStop(index, -1)}>
                          <ArrowUp size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move ${name} down`}
                          disabled={index === draft.stops.length - 1}
                          onClick={() => moveStop(index, 1)}
                        >
                          <ArrowDown size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${name}`}
                          disabled={locked}
                          onClick={() => onChange({ ...draft, stops: draft.stops.filter((item) => item.key !== stop.key) })}
                        >
                          <X size={16} />
                        </Button>
                      </>
                    )}
                  </div>
                  {locked && <p className="request-locked-note">This stop is being scheduled, so it can no longer be changed.</p>}

                  {stop.urgent && (
                    <div className="request-urgent-box">
                      <ChoiceField
                        label="Why is this stop urgent?"
                        placeholder="Select a reason"
                        list={urgentReasons}
                        id={stop.urgentReasonId}
                        other=""
                        otherMode={false}
                        error={errors.urgentReason}
                        disabled={locked}
                        onPick={(pick) => setStop(stop.key, { urgentReasonId: pick.id })}
                      />
                      <small>Only these reasons count as urgent. The Scheduler can change it to Regular if it doesn&apos;t fit.</small>
                    </div>
                  )}

                  {draft.projectMode === "multi" && (
                    <ChoiceField
                      label="Project / Site"
                      placeholder="Select"
                      list={projects}
                      id={stop.projectId}
                      other={stop.projectOther}
                      otherMode={stop.projectOtherMode}
                      error={errors.project}
                      disabled={locked}
                      onPick={(pick) => setStop(stop.key, { projectId: pick.id, projectOther: pick.other, projectOtherMode: pick.otherMode })}
                    />
                  )}

                  <div className="request-stop-row">
                    <ChoiceField
                      label="Destination"
                      placeholder="Select"
                      list={destinations}
                      id={stop.destinationId}
                      other={stop.destinationOther}
                      otherMode={stop.destinationOtherMode}
                      addTo="destinations"
                      error={errors.destination}
                      disabled={locked}
                      onPick={(pick) =>
                        setStop(stop.key, { destinationId: pick.id, destinationOther: pick.other, destinationOtherMode: pick.otherMode })
                      }
                    />
                    {!stop.urgent && (
                      <ChoiceField
                        label="Purpose"
                        placeholder="Select"
                        list={purposes}
                        id={stop.purposeId}
                        other={stop.purposeOther}
                        otherMode={stop.purposeOtherMode}
                        addTo="purposes"
                        error={errors.purpose}
                        disabled={locked}
                        onPick={(pick) => setStop(stop.key, { purposeId: pick.id, purposeOther: pick.other, purposeOtherMode: pick.otherMode })}
                      />
                    )}
                  </div>

                  <label className="field">
                    <span>Details{needsDetails(stop, options) ? " (required)" : ""}</span>
                    <Textarea
                      value={stop.details}
                      maxLength={DETAILS_MAX}
                      aria-invalid={!!errors.details}
                      disabled={locked}
                      placeholder="e.g. 20 bags cement to Block 3, foreman Edgar receives"
                      onChange={(event) => setStop(stop.key, { details: event.target.value })}
                    />
                    {/* The count only matters once the limit is near. */}
                    {stop.details.length >= DETAILS_MAX - 30 && (
                      <small className="field-note">
                        {stop.details.length}/{DETAILS_MAX}
                      </small>
                    )}
                    {errors.details && <small className="field-hint">{errors.details}</small>}
                  </label>

                  <div className="request-flex-label">How flexible is this stop?</div>
                  <div className="request-choice-cards" role="radiogroup" aria-label={`When for ${name}`}>
                    {(Object.keys(FLEXIBILITY) as StopFlexibility[]).map((value) => (
                      <label key={value} className={stop.flexibility === value ? "checked" : ""}>
                        <input
                          type="radio"
                          name={`when-${stop.key}`}
                          checked={stop.flexibility === value}
                          disabled={locked}
                          onChange={() => setStop(stop.key, { flexibility: value })}
                        />
                        <span>
                          {FLEXIBILITY[value].label}
                          <small>{FLEXIBILITY[value].hint}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {stop.flexibility === "FIXED" && (
                    <div className="request-stop-row">
                      <label className="field">
                        <span>Time</span>
                        <Input
                          type="time"
                          step={300}
                          value={stop.fixedTime}
                          aria-invalid={!!errors.fixedTime}
                          disabled={locked}
                          onChange={(event) => setStop(stop.key, { fixedTime: event.target.value })}
                        />
                        {errors.fixedTime && <small className="field-hint">{errors.fixedTime}</small>}
                      </label>
                    </div>
                  )}
                  {stop.flexibility === "WEEK" && draft.date && <p className="request-note">Any day {weekLabel(draft.date)}</p>}

                  <label className="field">
                    <span>Contact at this stop (optional)</span>
                    <Input
                      value={stop.contact}
                      maxLength={100}
                      disabled={locked}
                      placeholder="Name and number"
                      onChange={(event) => setStop(stop.key, { contact: event.target.value })}
                    />
                  </label>
                </div>
              );
            })}
            <Button
              variant="outline"
              className="request-add-stop"
              disabled={draft.stops.length >= STOPS_MAX}
              onClick={() => onChange({ ...draft, stops: [...draft.stops, emptyStop()] })}
            >
              <Plus size={16} /> Add another destination
            </Button>
          </section>

          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          {showErrors && missing.length > 0 && (
            <p className="request-note" role="status">
              {stillNeeded(missing)}
            </p>
          )}
          <div className="request-actions">
            <Button variant="outline" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button className="primary" disabled={busy} onClick={send}>
              {busy ? "Sending…" : submitLabel}
            </Button>
          </div>
        </div>

        <aside className="request-panel request-summary" aria-live="polite">
          <h2>Summary</h2>
          <p>
            {requestedBy} · {draft.date ? fullDate(draft.date) : "No date yet"}
          </p>
          <p>{summaryProjects || "No project yet"}</p>
          <ul>
            {draft.stops.map((stop, index) => (
              <li key={stop.key} className={stop.urgent ? "urgent" : ""}>
                <span>
                  <b>
                    {prefix}
                    {letter(index)}
                  </b>{" "}
                  · {stopDestination(stop) || "No destination yet"}
                </span>
                {draft.projectMode === "multi" && <small>{stopProjectName(stop) || "No project"}</small>}
                <span className="request-summary-tags">
                  <span className={"badge " + (stop.urgent ? "urgent" : "")}>
                    {stop.urgent ? "Urgent" + (stop.urgentReasonId ? ": " + (urgentReasons.find((item) => item.id === stop.urgentReasonId)?.name ?? "") : "") : "Regular"}
                  </span>
                  {!stop.urgent && stopPurpose(stop, options) && <span>{stopPurpose(stop, options)}</span>}
                </span>
                <small>{whenText(draft.date, stop.flexibility, stop.fixedTime)}</small>
              </li>
            ))}
          </ul>
          <p className="request-note">
            Each destination is scheduled as a separate stop ({prefix || "41-"}A, {prefix || "41-"}B…).
          </p>
        </aside>
      </div>
      <RequestConfirmDialog
        open={confirming}
        title={submitLabel === "Send request" ? "Send this request?" : `${submitLabel}?`}
        description="Please review the details before they are sent to the Scheduler."
        rows={confirmRows}
        confirmLabel={submitLabel}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onSubmit();
        }}
      />
    </div>
  );
}
