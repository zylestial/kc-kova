"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Account, BookingOption, BookingOptions, OptionGroup, RequestForm as FormType, StopFlexibility, Vehicle } from "@/lib/kova-api";
import { addDays, manilaToday, requestDateError } from "@/lib/timezone";
import { stillNeeded } from "@/lib/missing-fields";
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
  tripErrors,
  type TripField,
  weekLabel,
  whenText,
  withForm,
  type RequestDraft,
  type StopDraft,
} from "@/lib/request-draft";

const OTHER = "__other__";
const NONE = "__none__";

/** Choices an edit already uses stay offered after they're made Inactive (the server lets an edit keep them). */
export type KeptChoices = Partial<Record<OptionGroup, Array<{ id: string; name: string }>>> & {
  vehicle?: { id: string; name: string };
  driver?: { id: string; name: string };
};

const FORMS: Record<FormType, { label: string; hint: string }> = {
  DAILY: { label: "Daily Vehicle Trip", hint: "Regular transport for site and office runs. A Scheduler picks the vehicle." },
  COMPANY: { label: "Company Trip", hint: "You pick a vehicle that can be requested for company trips, and its Driver." },
};

function choices(list: BookingOption[], kept: Array<{ id: string; name: string }> = []) {
  const active = list.filter((item) => item.status === "Active").map((item) => ({ id: item.id, name: item.name }));
  for (const item of kept)
    if (item.id && !active.some((option) => option.id === item.id)) active.push({ id: item.id, name: `${item.name} (inactive)` });
  return active;
}

/** A list plus the saved choice if it has dropped out of it (made Inactive). */
function withKept(list: Array<{ id: string; name: string }>, kept?: { id: string; name: string }) {
  return kept && !list.some((item) => item.id === kept.id) ? [...list, { id: kept.id, name: `${kept.name} (inactive)` }] : list;
}

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", options);
const fullDate = (value: string) => dateLabel(value, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** A dropdown that can switch to typing a new name ("Other…") when allowOther is set. */
function ChoiceField({
  label,
  placeholder,
  list,
  id,
  other,
  otherMode,
  allowOther,
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
  allowOther: boolean;
  error?: string;
  disabled?: boolean;
  /** An optional field: this first choice clears it. */
  noneLabel?: string;
  hint?: string;
  onPick: (change: { id: string; other: string; otherMode: boolean }) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {otherMode ? (
        <div className="field-other">
          <Input
            aria-label={label}
            aria-invalid={!!error}
            placeholder={`New ${label.toLowerCase()} (added to the list)`}
            value={other}
            maxLength={120}
            disabled={disabled}
            autoFocus
            onChange={(event) => onPick({ id: "", other: event.target.value, otherMode: true })}
          />
          <button
            type="button"
            className="field-other-back"
            disabled={disabled}
            onClick={() => onPick({ id: "", other: "", otherMode: false })}
          >
            Choose from list
          </button>
        </div>
      ) : (
        <Select
          value={id || (noneLabel ? NONE : "")}
          disabled={disabled}
          onValueChange={(value) =>
            onPick(
              value === OTHER
                ? { id: "", other: "", otherMode: true }
                : { id: value === NONE ? "" : value, other: "", otherMode: false },
            )
          }
        >
          <SelectTrigger aria-label={label} aria-invalid={!!error}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
            {list.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
            {allowOther && <SelectItem value={OTHER}>Other…</SelectItem>}
          </SelectContent>
        </Select>
      )}
      {hint && <small className="field-note">{hint}</small>}
      {error && <small className="field-hint">{error}</small>}
    </label>
  );
}

/**
 * The New request form (New Request prototype): the date, one or several
 * projects, then a card per stop, with a live summary beside it. Used to
 * create a request and to edit one (stops that are being scheduled are
 * shown but locked).
 */
export default function RequestForm({
  draft,
  onChange,
  options,
  isAdmin,
  requestedBy,
  forms,
  vehicles,
  accounts,
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
  /** The requester's Position, printed on a Company Trip Form. */
  /** The forms this account may use; a choice shows when there are two. */
  forms: FormType[];
  vehicles: Vehicle[];
  accounts: Account[];
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
  const allowOther = draft.form === "DAILY";
  const projects = choices(options.projects, kept.projects);
  // Fuel/errand stops are for the Scheduler to add, never a requester's destination.
  const destinations = choices(options.destinations.filter((item) => !item.isOtherStop), kept.destinations);
  const purposes = choices(options.purposes, kept.purposes);
  const urgentReasons = choices(options.urgent_reasons, kept.urgent_reasons);
  const company = draft.form === "COMPANY";
  const suppliers = choices(options.suppliers, kept.suppliers);
  const startingPoints = choices(options.starting_points, kept.starting_points);
  const supervisors = choices(options.supervisors, kept.supervisors);
  const heads = choices(options.heads, kept.heads);
  // Only vehicles that can be requested for company trips, and Company car Drivers (never Truck drivers).
  const tripVehicles = withKept(
    vehicles.filter((item) => item.status === "Active" && item.companyTrips).map((item) => ({ id: item.plate, name: `${item.name} · ${item.plate}` })),
    kept.vehicle,
  );
  const tripDrivers = withKept(
    accounts
      .filter((item) => item.role === "Driver" && item.status === "Active" && item.driverType === "Company car")
      .map((item) => ({ id: item.id, name: item.name })),
    kept.driver,
  );
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
  /** One of a Company Trip's own pickers (list choices only). */
  const tripChoice = (
    field: TripField,
    key: "startingPointId" | "vehiclePlate" | "driverId" | "supervisorId" | "headId",
    label: string,
    list: Array<{ id: string; name: string }>,
    hint?: string,
  ) => (
    <ChoiceField
      key={key}
      label={label}
      placeholder="Choose…"
      list={list}
      id={draft[key]}
      other=""
      otherMode={false}
      allowOther={false}
      hint={hint}
      error={showErrors ? tripErrors(draft)[field] : undefined}
      disabled={dateLocked}
      onPick={(pick) => onChange({ ...draft, [key]: pick.id })}
    />
  );

  function send() {
    setShowErrors(true);
    if (missing.length || dateError) {
      // Bring the first field that needs something into view.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".request-form [aria-invalid=true]")?.focus());
      return;
    }
    onSubmit();
  }

  return (
    <div className="request-form">
      <div className="request-form-grid">
        <div className="request-form-main">
          {forms.length > 1 && (
            <section className="request-panel">
              <h2>Which form is this for?</h2>
              <div className="request-choice-cards" role="radiogroup" aria-label="Form">
                {forms.map((value) => (
                  <label key={value} className={draft.form === value ? "checked" : ""}>
                    <input
                      type="radio"
                      name="request-form"
                      checked={draft.form === value}
                      onChange={() => onChange(withForm(draft, value))}
                    />
                    <span>
                      {FORMS[value].label}
                      <small>{FORMS[value].hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}
          <section className="request-panel">
            <div className="request-step">Step 1</div>
            <h2>Choose date</h2>
            <p>The day you need the vehicle. Each stop then says if it&apos;s any time that day, a fixed time, or any day that week.</p>
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
                {isAdmin && <p className="request-note">As an Admin you can also pick a past date, for a trip that already happened.</p>}
              </>
            )}
          </section>

          <section className="request-panel">
            <div className="request-step">Step 2</div>
            <h2>{company ? "Project / Site, vehicle and Driver" : "Is this for one project/site or several?"}</h2>
            {/* A Company Trip is for one Project / Site, which is also its Department / Site (0058). */}
            {!company && (
              <div className="request-choice-cards" role="radiogroup" aria-label="Projects or sites">
                {(
                  [
                    ["one", "Single project/site", "Every destination is for the same project or site."],
                    ["multi", "Multiple projects/sites", "Pick the project or site for each destination."],
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
            )}
            {draft.projectMode === "one" && (
              <div className={company ? "request-trip-fields" : "request-project"}>
                <ChoiceField
                  label="Project / Site"
                  placeholder="Choose…"
                  list={projects}
                  id={draft.projectId}
                  other={draft.projectOther}
                  otherMode={draft.projectOtherMode}
                  allowOther={allowOther}
                  error={showErrors && missing.includes("Project / Site") ? "Pick the project or site." : undefined}
                  onPick={(pick) => onChange({ ...draft, projectId: pick.id, projectOther: pick.other, projectOtherMode: pick.otherMode })}
                />
                {company && tripChoice("vehicle", "vehiclePlate", "Vehicle", tripVehicles)}
                {company && tripChoice("driver", "driverId", "Driver", tripDrivers)}
              </div>
            )}
          </section>

          <section className="request-panel">
            <div className="request-step">Step 3</div>
            <h2>Where should the vehicle go?</h2>
            <p>Add each destination. For each one, pick {draft.projectMode === "multi" ? "its project, " : ""}when you need it, and whether it&apos;s urgent.</p>
            {/* A Company Trip starts at its starting point: always first, never moved. */}
            {company && (
              <div className="request-stop request-start">
                <div className="request-stop-head">
                  <b>Start</b>
                </div>
                {tripChoice("startingPoint", "startingPointId", "Starting point", startingPoints, "Leg 1 starts here.")}
              </div>
            )}
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
                        placeholder="Choose a reason…"
                        list={urgentReasons}
                        id={stop.urgentReasonId}
                        other=""
                        otherMode={false}
                        allowOther={false}
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
                      placeholder="Choose…"
                      list={projects}
                      id={stop.projectId}
                      other={stop.projectOther}
                      otherMode={stop.projectOtherMode}
                      allowOther={allowOther}
                      error={errors.project}
                      disabled={locked}
                      onPick={(pick) => setStop(stop.key, { projectId: pick.id, projectOther: pick.other, projectOtherMode: pick.otherMode })}
                    />
                  )}

                  <div className="request-stop-row">
                    <ChoiceField
                      label="Destination"
                      placeholder="Choose…"
                      list={destinations}
                      id={stop.destinationId}
                      other={stop.destinationOther}
                      otherMode={stop.destinationOtherMode}
                      allowOther={allowOther}
                      error={errors.destination}
                      disabled={locked}
                      onPick={(pick) =>
                        setStop(stop.key, { destinationId: pick.id, destinationOther: pick.other, destinationOtherMode: pick.otherMode })
                      }
                    />
                    {!stop.urgent && (
                      <ChoiceField
                        label="Purpose"
                        placeholder="Choose…"
                        list={purposes}
                        id={stop.purposeId}
                        other={stop.purposeOther}
                        otherMode={stop.purposeOtherMode}
                        allowOther={allowOther}
                        error={errors.purpose}
                        disabled={locked}
                        onPick={(pick) => setStop(stop.key, { purposeId: pick.id, purposeOther: pick.other, purposeOtherMode: pick.otherMode })}
                      />
                    )}
                  </div>

                  <label className="field">
                    <span>Details {needsDetails(stop, options) ? "(required)" : "(optional)"}</span>
                    <Textarea
                      value={stop.details}
                      maxLength={DETAILS_MAX}
                      aria-invalid={!!errors.details}
                      disabled={locked}
                      placeholder="e.g. 20 bags cement to Block 3, foreman Edgar receives"
                      onChange={(event) => setStop(stop.key, { details: event.target.value })}
                    />
                    <small className="field-note">
                      {stop.details.length}/{DETAILS_MAX}
                    </small>
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

                  {company && (
                    <ChoiceField
                      label="Supplier / Location (optional)"
                      placeholder="None"
                      noneLabel="None"
                      list={suppliers}
                      id={stop.supplierId}
                      other=""
                      otherMode={false}
                      allowOther={false}
                      disabled={locked}
                      onPick={(pick) => setStop(stop.key, { supplierId: pick.id })}
                    />
                  )}

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

          {company && (
            <section className="request-panel">
              <div className="request-step">Step 4</div>
              <h2>Trip details</h2>
              <p>Printed on the Company Trip Form.</p>
              {dateLocked && (
                <p className="request-locked-note">Part of this request is being scheduled, so its trip details can no longer change.</p>
              )}
              <div className="request-trip-fields">
                {(
                  [
                    ["supervisor", "supervisorId", "Immediate Supervisor", supervisors, undefined],
                    ["head", "headId", "Project Manager / Construction Manager / Dept. Head", heads, undefined],
                  ] as const
                ).map(([field, key, label, list, hint]) => tripChoice(field, key, label, list, hint))}
                <label className="field">
                  <span>Site Officer / Supplier (optional)</span>
                  <Input
                    value={draft.siteOfficer}
                    maxLength={100}
                    placeholder="Who will confirm you at the site"
                    onChange={(event) => onChange({ ...draft, siteOfficer: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Company / Site (optional)</span>
                  <Input
                    value={draft.siteCompany}
                    maxLength={100}
                    onChange={(event) => onChange({ ...draft, siteCompany: event.target.value })}
                  />
                  <small className="field-note">Leave these blank if you don&apos;t know yet. They can be written on the printed form.</small>
                </label>
              </div>
            </section>
          )}

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
          {company && (
            <p>
              Company trip · {nameOf(tripVehicles, draft.vehiclePlate) || "No vehicle yet"} · Driver{" "}
              {nameOf(tripDrivers, draft.driverId) || "not picked yet"}
            </p>
          )}
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
            Each destination becomes its own stop ({prefix || "41-"}A, {prefix || "41-"}B…), so the Scheduler can plan them on different
            vehicles or combine them with other trips to the same place.
          </p>
        </aside>
      </div>
    </div>
  );
}

const nameOf = (list: Array<{ id: string; name: string }>, id: string) => list.find((item) => item.id === id)?.name ?? "";
