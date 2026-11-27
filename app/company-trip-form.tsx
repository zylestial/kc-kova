"use client";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { companyTripBookings, type Account, type BookingOptions, type CompanyTripBooking, type Vehicle } from "@/lib/kova-api";
import { destinationChoices } from "@/lib/choice-lists";
import { canDriveCompany } from "@/lib/request-access";
import { manilaToday, requestDateError } from "@/lib/timezone";
import { stillNeeded } from "@/lib/missing-fields";
import {
  COMPANY_STOPS_MAX,
  PASSENGERS_MAX,
  PURPOSE_MAX,
  clock,
  companyTripErrors,
  companyTripMissing,
  emptyCompanyStop,
  personBusy,
  vehicleClashes,
  type CompanyStopDraft,
  type CompanyTripDraft,
} from "@/lib/company-trip-draft";

type Choice = { id: string; name: string };

/** Choices an edit already uses stay offered after they're made Inactive (the server lets an edit keep them). */
export type CompanyKept = { department?: Choice; urgentReason?: Choice; destinations?: Choice[]; vehicle?: Choice };

const active = (list: Array<{ id: string; name: string; status: string }>, kept?: Choice) => {
  const shown = list.filter((item) => item.status === "Active").map(({ id, name }) => ({ id, name }));
  if (kept?.id && !shown.some((item) => item.id === kept.id)) shown.push({ id: kept.id, name: `${kept.name} (inactive)` });
  return shown;
};

const fullDate = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** A list choice with its label, hint and error. */
function Pick({
  label,
  value,
  list,
  placeholder = "Choose…",
  hint,
  error,
  disabled,
  onPick,
}: {
  label: string;
  value: string;
  list: Choice[];
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Select value={value} disabled={disabled} onValueChange={onPick}>
        <SelectTrigger aria-label={label} aria-invalid={!!error}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {list.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <small className="field-note">{hint}</small>}
      {error && <small className="field-hint">{error}</small>}
    </label>
  );
}

function TimeField({ label, value, hint, error, onChange }: { label: string; value: string; hint?: string; error?: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <Input type="time" step={300} value={value} aria-invalid={!!error} onChange={(event) => onChange(event.target.value)} />
      {hint && <small className="field-note">{hint}</small>}
      {error && <small className="field-hint">{error}</small>}
    </label>
  );
}

const DAY_START = 6 * 60;
const DAY_END = 19 * 60;
const at = (time: string) => {
  const [hours, mins] = time.split(":").map(Number);
  const clamped = Math.min(Math.max(hours * 60 + mins, DAY_START), DAY_END);
  return ((clamped - DAY_START) / (DAY_END - DAY_START)) * 100;
};

/** The chosen vehicle's day, 6 AM to 7 PM: other trips grey, this one blue (red when it overlaps). */
function DayBar({ bookings, timeOut, timeIn, overlaps }: { bookings: CompanyTripBooking[]; timeOut: string; timeIn: string; overlaps: boolean }) {
  const mine = timeOut && timeIn && timeIn > timeOut;
  return (
    <div className="trip-daybar-wrap">
      <div className="trip-daybar" aria-hidden="true">
        {bookings.map((item) => (
          <i key={item.scheduleId} style={{ left: `${at(item.startsAt)}%`, width: `${at(item.endsAt) - at(item.startsAt)}%` }}>
            {item.ownerName.split(" ")[0]}
          </i>
        ))}
        {mine && (
          <i className={"mine" + (overlaps ? " overlap" : "")} style={{ left: `${at(timeOut)}%`, width: `${at(timeIn) - at(timeOut)}%` }}>
            You
          </i>
        )}
      </div>
      <div className="trip-daybar-axis" aria-hidden="true">
        <span>6 AM</span>
        <span>9</span>
        <span>12 PM</span>
        <span>3</span>
        <span>7 PM</span>
      </div>
      {bookings.map((item) => (
        <small key={item.scheduleId} className="field-note">
          Booked {clock(item.startsAt)}–{clock(item.endsAt)}: {item.ownerName}
        </small>
      ))}
    </div>
  );
}

/**
 * The Company trip form (Company trip v2): the requester books the trip.
 * They pick the vehicle (a company trip vehicle, or their own) and who
 * drives, enter Time Out, the times at each destination and Time In, one
 * Purpose, the Fleet Card, and any passengers. Sending it goes straight to
 * the Admin (0094).
 */
export default function CompanyTripForm({
  draft,
  onChange,
  me,
  isAdmin,
  options,
  vehicles,
  accounts,
  groupId,
  kept = {},
  dateLocked = false,
  number,
  busy,
  error,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
}: {
  draft: CompanyTripDraft;
  onChange: (draft: CompanyTripDraft) => void;
  me: Account;
  isAdmin: boolean;
  options: BookingOptions;
  vehicles: Vehicle[];
  accounts: Account[];
  /** The request being edited: its own trip isn't counted as a clash. */
  groupId?: string;
  kept?: CompanyKept;
  /** Approved: the date can't change (cancel and send a new request instead). */
  dateLocked?: boolean;
  number?: number;
  busy: boolean;
  error: string;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const today = manilaToday();
  const [showErrors, setShowErrors] = useState(false);
  const [query, setQuery] = useState("");
  // The passenger list opens as a dropdown while the box has focus.
  const [picking, setPicking] = useState(false);
  // The day's other Company trips, for free / booked and busy people.
  const [day, setDay] = useState<{ key: string; bookings: CompanyTripBooking[] }>({ key: "", bookings: [] });
  const dayKey = `${draft.date}|${groupId ?? ""}`;
  useEffect(() => {
    if (!draft.date) return;
    let live = true;
    companyTripBookings(draft.date, groupId)
      .then((bookings) => live && setDay({ key: `${draft.date}|${groupId ?? ""}`, bookings }))
      .catch(() => live && setDay({ key: `${draft.date}|${groupId ?? ""}`, bookings: [] }));
    return () => {
      live = false;
    };
    // A failed send may mean someone booked meanwhile: look again.
  }, [draft.date, groupId, error]);
  const bookings = day.key === dayKey ? day.bookings : [];

  const personal = vehicles.find((item) => item.ownerAccountId === me.id && item.status === "Active");
  const companyVehicles = vehicles.filter((item) => item.status === "Active" && item.companyTrips && !item.ownerAccountId);
  if (kept.vehicle && draft.vehicleKind === "company" && !companyVehicles.some((item) => item.plate === kept.vehicle!.id))
    companyVehicles.push({ plate: kept.vehicle.id, name: kept.vehicle.name, status: "Inactive", companyTrips: true } as Vehicle);
  const plate = draft.vehicleKind === "personal" ? (personal?.plate ?? "") : draft.vehiclePlate;
  const vehicle = vehicles.find((item) => item.plate === plate);
  const iCanDrive = canDriveCompany(me);
  const driverId = draft.vehicleKind === "personal" ? me.id : draft.driverId;
  const name = (id: string) => (id === me.id ? me.name : (accounts.find((item) => item.id === id)?.name ?? "someone"));
  const busyOf = (id: string) => personBusy(bookings, id, draft.timeOut, draft.timeIn);
  const busyText = (id: string) => {
    const trip = busyOf(id);
    if (!trip) return "";
    const whose = trip.ownerName === name(id) ? "their own" : `${trip.ownerName}'s`;
    return `${id === me.id ? "You are" : name(id) + " is"} booked on ${whose} trip, ${clock(trip.startsAt)}–${clock(trip.endsAt)}`;
  };

  const drivers: Choice[] = [
    ...(iCanDrive ? [{ id: me.id, name: "Me, I'll drive" }] : []),
    ...accounts
      .filter((item) => item.id !== me.id && canDriveCompany(item))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({ id: item.id, name: item.name + (busyOf(item.id) ? " · on another trip then" : "") })),
  ];
  if (draft.driverId && !drivers.some((item) => item.id === draft.driverId))
    drivers.push({ id: draft.driverId, name: `${name(draft.driverId)} (can't drive company trips now)` });
  const departments = active(options.projects, kept.department);
  const urgentReasons = active(options.urgent_reasons, kept.urgentReason);
  const destinations = destinationChoices(options.destinations, kept.destinations);
  const start = options.starting_points.find((item) => item.id === "start-office" && item.status === "Active") ??
    options.starting_points.find((item) => item.status === "Active");

  const errors = companyTripErrors(draft, personal?.plate);
  const dateError = requestDateError(draft.date, isAdmin);
  const clashes = plate ? vehicleClashes(bookings, plate, draft.timeOut, draft.timeIn) : [];
  const people = [...new Set([me.id, driverId, ...draft.passengers.flatMap((item) => ("accountId" in item ? [item.accountId] : []))].filter(Boolean))];
  const peopleBusy = people.map(busyText).filter(Boolean);
  const missing = companyTripMissing(errors);
  const shown = (message?: string) => (showErrors ? message : undefined);

  const set = (change: Partial<CompanyTripDraft>) => onChange({ ...draft, ...change });
  const setStop = (key: string, change: Partial<CompanyStopDraft>) =>
    set({ stops: draft.stops.map((stop) => (stop.key === key ? { ...stop, ...change } : stop)) });

  // Passenger search: colleagues not yet on the trip (busy ones greyed, with why), then "add as a guest".
  const term = query.trim().toLowerCase();
  const onTrip = new Set(people);
  // Truck drivers don't ride on Company trips (owner, 2026-11-27).
  const truckDriver = (item: Account) => item.role === "Driver" && item.driverType !== "Company car";
  const matches = accounts
    .filter((item) => item.status === "Active" && !truckDriver(item) && !onTrip.has(item.id) && (!term || item.name.toLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);
  const canAddGuest =
    !!term &&
    !accounts.some((item) => item.name.toLowerCase() === term) &&
    !draft.passengers.some((item) => "guestName" in item && item.guestName.toLowerCase() === term);
  const full = draft.passengers.length >= PASSENGERS_MAX;

  function send() {
    setShowErrors(true);
    if (missing.length || dateError || clashes.length || peopleBusy.length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".request-form [aria-invalid=true]")?.focus());
      return;
    }
    onSubmit();
  }

  const lastIndex = draft.stops.length - 1;
  const destinationName = (id: string) => destinations.find((item) => item.id === id)?.name ?? "";
  const route = [start?.name ?? "Main Office", ...draft.stops.map((stop) => destinationName(stop.destinationId) || "?")].join(" to ");

  return (
    <div className="request-form company-form">
      <div className="request-form-grid">
        <div className="request-form-main">
          <section className="request-panel">
            <div className="request-step">Step 1</div>
            <h2>Date</h2>
            <div className="request-trip-fields">
              {dateLocked ? (
                <p className="request-locked-note">
                  <b>{fullDate(draft.date)}</b>. The date of an approved trip cannot be changed. To travel on another date, cancel this trip and
                  submit a new request.
                </p>
              ) : (
                <label className="field">
                  <span>Date</span>
                  <Input
                    type="date"
                    value={draft.date}
                    min={isAdmin ? undefined : today}
                    aria-invalid={showErrors && !!(errors.date || dateError)}
                    onChange={(event) => event.target.value && set({ date: event.target.value })}
                  />
                  {showErrors && (errors.date || dateError) && <small className="field-hint">{errors.date || dateError}</small>}
                </label>
              )}
              <label className="field">
                <span>Starts at</span>
                <Input value={start?.name ?? "Main Office"} readOnly />
              </label>
            </div>
          </section>

          <section className="request-panel">
            <div className="request-step">Step 2</div>
            <h2>Regular or urgent</h2>
            <div className="request-choice-cards" role="radiogroup" aria-label="Regular or urgent">
              {(
                [
                  ["REGULAR", "Regular", "Scheduled in advance."],
                  ["URGENT", "Urgent", "Requires a reason."],
                ] as const
              ).map(([value, title, hint]) => (
                <label key={value} className={draft.priority === value ? "checked" : ""}>
                  <input type="radio" name="company-priority" checked={draft.priority === value} onChange={() => set({ priority: value })} />
                  <span>
                    {title}
                    <small>{hint}</small>
                  </span>
                </label>
              ))}
            </div>
            {draft.priority === "URGENT" && (
              <div className="request-urgent-box">
                <Pick
                  label="Reason it's urgent"
                  placeholder="Select a reason"
                  value={draft.urgentReasonId}
                  list={urgentReasons}
                  error={shown(errors.urgentReason)}
                  onPick={(id) => set({ urgentReasonId: id })}
                />
                <small>The list of urgent reasons is maintained by the Admin.</small>
              </div>
            )}
          </section>

          <section className="request-panel">
            <div className="request-step">Step 3</div>
            <h2>Vehicle and time</h2>
            {personal && (
              <div className="request-choice-cards" role="radiogroup" aria-label="Which vehicle">
                {(
                  [
                    ["company", "Company vehicle", "Subject to availability."],
                    ["personal", "Personal vehicle", `${personal.name} · ${personal.plate}`],
                  ] as const
                ).map(([value, title, hint]) => (
                  <label key={value} className={draft.vehicleKind === value ? "checked" : ""}>
                    <input type="radio" name="company-vehicle-kind" checked={draft.vehicleKind === value} onChange={() => set({ vehicleKind: value })} />
                    <span>
                      {title}
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {draft.vehicleKind === "personal" && personal ? (
              <p className="request-note">
                <b>
                  {personal.name} · {personal.plate}
                </b>
                . Personal vehicle, driven by its owner. To update its details, please contact the Admin.
              </p>
            ) : (
              <Pick
                label="Vehicle"
                value={draft.vehiclePlate}
                list={companyVehicles.map((item) => ({
                  id: item.plate,
                  name:
                    `${item.name} · ${item.plate}` +
                    (draft.timeOut && draft.timeIn ? (vehicleClashes(bookings, item.plate, draft.timeOut, draft.timeIn).length ? " · booked then" : " · free then") : ""),
                }))}
                hint={companyVehicles.length ? undefined : "No vehicles are available for company trips. Please contact the Admin."}
                error={shown(errors.vehicle)}
                onPick={(id) => set({ vehiclePlate: id })}
              />
            )}
            <div className="request-stop-row">
              <TimeField
                label="Time Out"
                value={draft.timeOut}
                error={shown(errors.timeOut)}
                onChange={(value) => set({ timeOut: value })}
              />
              <TimeField
                label="Time In"
                value={draft.timeIn}
                error={shown(errors.timeIn)}
                onChange={(value) => set({ timeIn: value })}
              />
            </div>
            {vehicle && draft.vehicleKind === "company" && (
              <>
                <p className="request-note">
                  <b>
                    {vehicle.name} · {vehicle.plate}
                  </b>{" "}
                  on {draft.date ? fullDate(draft.date) : "—"}
                </p>
                <DayBar
                  bookings={bookings.filter((item) => item.plate === vehicle.plate)}
                  timeOut={draft.timeOut}
                  timeIn={draft.timeIn}
                  overlaps={clashes.length > 0}
                />
              </>
            )}
            {clashes.length > 0 ? (
              <div className="notice" role="alert">
                The {vehicle?.name ?? "vehicle"} is booked by {clashes.map((item) => item.ownerName).join(", ")} at this time. Please select another
                time or vehicle.
              </div>
            ) : (
              vehicle &&
              draft.vehicleKind === "company" &&
              draft.timeOut &&
              draft.timeIn &&
              draft.timeIn > draft.timeOut && (
                <div className="notice success" role="status">
                  The {vehicle.name} is available at this time.
                </div>
              )
            )}
          </section>

          <section className="request-panel">
            <div className="request-step">Step 4</div>
            <h2>Where are you going?</h2>
            {draft.stops.map((stop, index) => {
              const own = (showErrors && errors.stops?.[index]) || {};
              const title = `Destination ${index + 1}`;
              return (
                <div key={stop.key} className="request-stop">
                  <div className="request-stop-head">
                    <b>{title}</b>
                    <span className="request-stop-gap" />
                    {draft.stops.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${title}`}
                        onClick={() => set({ stops: draft.stops.filter((item) => item.key !== stop.key) })}
                      >
                        <X size={16} />
                      </Button>
                    )}
                  </div>
                  <Pick
                    label="Destination / Site to visit"
                    placeholder="Select a destination"
                    value={stop.destinationId}
                    list={destinations}
                    error={own.destination}
                    onPick={(id) => setStop(stop.key, { destinationId: id })}
                  />
                  {index < lastIndex ? (
                    <div className="request-stop-row">
                      <TimeField label="Arrive" value={stop.arriveAt} error={own.arriveAt} onChange={(value) => setStop(stop.key, { arriveAt: value })} />
                      <TimeField label="Leave" value={stop.leaveAt} error={own.leaveAt} onChange={(value) => setStop(stop.key, { leaveAt: value })} />
                    </div>
                  ) : (
                    <p className="request-note">Arrival: Time In{draft.timeIn ? ` (${clock(draft.timeIn)})` : ""}</p>
                  )}
                </div>
              );
            })}
            {showErrors && errors.times && (
              <small className="field-hint" role="alert">
                {errors.times}
              </small>
            )}
            <Button
              variant="outline"
              className="request-add-stop"
              disabled={draft.stops.length >= COMPANY_STOPS_MAX}
              onClick={() => set({ stops: [...draft.stops, emptyCompanyStop()] })}
            >
              <Plus size={16} /> Add another destination
            </Button>
          </section>

          <section className="request-panel">
            <div className="request-step">Step 5</div>
            <h2>Purpose of trip</h2>
            <label className="field">
              <span>What is this trip for?</span>
              <Textarea
                value={draft.purpose}
                maxLength={PURPOSE_MAX}
                rows={3}
                aria-invalid={showErrors && !!errors.purpose}
                placeholder="e.g. Pick up rebar samples at the hardware, then drop them with the foreman at the warehouse"
                onChange={(event) => set({ purpose: event.target.value })}
              />
              <small className="field-note">
                {draft.purpose.length >= PURPOSE_MAX - 40 ? `${draft.purpose.length}/${PURPOSE_MAX}` : ""}
              </small>
              {shown(errors.purpose) && <small className="field-hint">{errors.purpose}</small>}
            </label>
          </section>

          <section className="request-panel">
            <div className="request-step">Step 6</div>
            <h2>Employee and vehicle</h2>
            <div className="request-trip-fields">
              <Pick
                label="Department / Project Site"
                value={draft.departmentId}
                list={departments}
                error={shown(errors.department)}
                onPick={(id) => set({ departmentId: id })}
              />
              <label className="field">
                <span>Fleet Card No. / last 4 digits</span>
                <Input
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="e.g. 4821"
                  value={draft.fleetCard}
                  aria-invalid={showErrors && !!errors.fleetCard}
                  onChange={(event) => set({ fleetCard: event.target.value.replace(/\D/g, "").slice(0, 4) })}
                />
                {shown(errors.fleetCard) && <small className="field-hint">{errors.fleetCard}</small>}
              </label>
              {draft.vehicleKind === "personal" ? (
                <label className="field">
                  <span>Driver</span>
                  <Input value="Me, my own vehicle" readOnly />
                </label>
              ) : (
                <Pick
                  label="Driver"
                  value={draft.driverId}
                  list={drivers}
                  hint="The driver records the trip in KOVA."
                  error={shown(errors.driver)}
                  onPick={(id) => set({ driverId: id })}
                />
              )}
            </div>
          </section>

          <section className="request-panel">
            <div className="request-step">Step 7</div>
            <h2>
              Passengers <small className="request-optional">optional{draft.passengers.length ? ` · ${draft.passengers.length} added` : ""}</small>
            </h2>
            {draft.passengers.length ? (
              <ul className="passenger-list">
                {draft.passengers.map((item, index) => {
                  const account = "accountId" in item ? accounts.find((row) => row.id === item.accountId) : undefined;
                  const label = "accountId" in item ? (account?.name ?? "Former account") : item.guestName;
                  return (
                    <li key={"accountId" in item ? item.accountId : "guest:" + item.guestName}>
                      <span>
                        <b>{label}</b>
                        <small>{"accountId" in item ? [account?.position, "KOVA account"].filter(Boolean).join(" · ") : "Guest, not in KOVA"}</small>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Remove ${label}`}
                        onClick={() => set({ passengers: draft.passengers.filter((_, other) => other !== index) })}
                      >
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="request-note">No passengers added.</p>
            )}
            {peopleBusy.length > 0 && (
              <div className="notice" role="alert">
                {peopleBusy.join(". ")}. Please remove them or change the time.
              </div>
            )}
            <div className="passenger-picker">
            <label className="field">
              <span>Add a passenger</span>
              <Input
                autoComplete="off"
                maxLength={100}
                placeholder="Search by name"
                value={query}
                disabled={full}
                role="combobox"
                aria-expanded={picking && !full}
                onFocus={() => setPicking(true)}
                onBlur={() => setPicking(false)}
                onKeyDown={(event) => event.key === "Escape" && setPicking(false)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPicking(true);
                }}
              />
              {full && <small className="field-note">A trip can have at most {PASSENGERS_MAX} passengers.</small>}
            </label>
            {!full && picking && (
              // mousedown keeps focus in the box, so a pick lands before the list closes.
              <ul className="passenger-suggestions" role="listbox" onMouseDown={(event) => event.preventDefault()}>
                {matches.map((item) => {
                  const why = busyOf(item.id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={!!why}
                        onClick={() => {
                          set({ passengers: [...draft.passengers, { accountId: item.id }] });
                          setQuery("");
                        }}
                      >
                        <span>
                          <b>{item.name}</b>
                          <small>
                            {why
                              ? `On another trip, ${clock(why.startsAt)}–${clock(why.endsAt)}`
                              : [item.position, item.role].filter(Boolean).join(" · ")}
                          </small>
                        </span>
                        {!why && <span className="badge">Add</span>}
                      </button>
                    </li>
                  );
                })}
                {canAddGuest && (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        set({ passengers: [...draft.passengers, { guestName: query.trim() }] });
                        setQuery("");
                      }}
                    >
                      <span>
                        <b>Add &ldquo;{query.trim()}&rdquo; as a guest</b>
                        <small>Not a KOVA user. Availability cannot be checked.</small>
                      </span>
                      <span className="badge">Add</span>
                    </button>
                  </li>
                )}
                {!matches.length && !canAddGuest && <li className="request-note">{term ? "No matching employees." : "All employees have been added."}</li>}
              </ul>
            )}
            </div>
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
            {number ? `Request #${number} · ` : ""}
            {me.name} · {draft.date ? fullDate(draft.date) : "No date yet"}
          </p>
          <p>
            <span className={"badge " + (draft.priority === "URGENT" ? "urgent" : "")}>
              {draft.priority === "URGENT"
                ? "Urgent" + (draft.urgentReasonId ? ": " + (urgentReasons.find((item) => item.id === draft.urgentReasonId)?.name ?? "") : "")
                : "Regular"}
            </span>{" "}
            Company trip
          </p>
          <p>
            {vehicle ? `${vehicle.name} · ${vehicle.plate}` : "No vehicle yet"} · {clock(draft.timeOut)} to {clock(draft.timeIn)}
          </p>
          <p>{route}</p>
          <p>Driver: {driverId ? (driverId === me.id ? `${me.name} (you)` : name(driverId)) : "Not selected"}</p>
          {draft.purpose.trim() && <p>Purpose: {draft.purpose.trim()}</p>}
          <p className="request-note">This request will be sent to the Admin for approval. Once approved, the Company Trip Form can be printed from My Requests.</p>
        </aside>
      </div>
    </div>
  );
}
