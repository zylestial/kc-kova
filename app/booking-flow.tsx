"use client";
import { useEffect, useState } from "react";
import {
  Truck,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Check,
} from "lucide-react";
import {
  canManageBooking,
  currentAccount,
  getAccounts,
  getActiveBookings,
  getBookingOptions,
  getPendingBookings,
  getVehicles,
  saveBooking,
  updateBooking,
  cancelBooking as removeBooking,
  type Account,
  type Booking,
} from "@/lib/kova-api";
import { regularMinDate } from "@/lib/timezone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

const OTHER_OPTION = "__other__";
type Vehicle = { plate: string; name: string };
type Slot = { plate: string; start: number; end: number };
type EditDraft = {
  date: string;
  plate: string;
  start: number;
  end: number;
  driverId: string;
  destination: string;
  purpose: string;
  notes: string;
  bookingType: "REGULAR" | "URGENT";
  urgentReason: string;
};
const statusLabel: Record<Booking["status"], string> = {
  PENDING: "Pending Admin approval",
  SCHEDULED: "Scheduled",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
const time = (hour: number) =>
  hour === 24
    ? "12:00 AM (next day)"
    : `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
const hoursText = (count: number) => `${count} ${count === 1 ? "hour" : "hours"}`;
const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", options);
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const isPastSlot = (dateValue: string, hour: number) => {
  const now = new Date();
  const today = localDate(now);
  if (dateValue < today) return true;
  if (dateValue > today) return false;
  return hour < now.getHours();
};
const toDraft = (booking: Booking): EditDraft => ({
  date: booking.date,
  plate: booking.plate,
  start: booking.start,
  end: booking.end,
  driverId: booking.driverId,
  destination: booking.destination,
  purpose: booking.purpose,
  notes: booking.notes,
  bookingType: booking.bookingType,
  urgentReason: booking.urgentReason,
});

export default function BookingFlow() {
  const [date, setDate] = useState(() => localDate(new Date()));
  const [anchor, setAnchor] = useState(() => localDate(new Date()));
  const [step, setStep] = useState(1);
  const [fleet, setFleet] = useState<Vehicle[]>(() =>
    getVehicles()
      .filter((vehicle) => vehicle.status === "Active")
      .map(({ plate, name }) => ({ plate, name })),
  );
  const [unavailable, setUnavailable] = useState<Vehicle[]>(() =>
    getVehicles()
      .filter((vehicle) => vehicle.status === "Inactive")
      .map(({ plate, name }) => ({ plate, name })),
  );
  const [bookings, setBookings] = useState<Booking[]>(() => getActiveBookings());
  const [pending, setPending] = useState<Booking[]>(() => getPendingBookings());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Slot | null>(null);
  const [hoverHour, setHoverHour] = useState<number | null>(null);
  const [hoverPlate, setHoverPlate] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>(() => getAccounts());
  const [options, setOptions] = useState(() => getBookingOptions());
  const [driverId, setDriverId] = useState("");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [bookingType, setBookingType] = useState<"REGULAR" | "URGENT">("REGULAR");
  const [urgentReason, setUrgentReason] = useState("");
  const [destinationOther, setDestinationOther] = useState(false);
  const [purposeOther, setPurposeOther] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Booking | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [draftDestinationOther, setDraftDestinationOther] = useState(false);
  const [draftPurposeOther, setDraftPurposeOther] = useState(false);

  function load() {
    const vehicles = getVehicles();
    setFleet(
      vehicles
        .filter((vehicle) => vehicle.status === "Active")
        .map(({ plate, name }) => ({ plate, name })),
    );
    setUnavailable(
      vehicles
        .filter((vehicle) => vehicle.status === "Inactive")
        .map(({ plate, name }) => ({ plate, name })),
    );
    setBookings(getActiveBookings());
    setPending(getPendingBookings());
    setAccounts(getAccounts());
    setOptions(getBookingOptions());
    setLoading(false);
  }
  useEffect(() => {
    window.addEventListener("kova-data-update", load);
    return () => window.removeEventListener("kova-data-update", load);
  }, []);
  const current = currentAccount();
  const drivers = accounts.filter(
    (account) => account.role === "Driver" && account.status === "Active",
  );
  const daily = bookings.filter((booking) => booking.date === date);
  const archived = daily
    .filter(
      (booking) => !fleet.some((vehicle) => vehicle.plate === booking.plate),
    )
    .map(
      (booking) =>
        unavailable.find((vehicle) => vehicle.plate === booking.plate) || {
          plate: booking.plate,
          name: booking.plate,
        },
    );
  const allVehicles = [
    ...fleet,
    ...archived.filter(
      (vehicle, index, list) =>
        list.findIndex((item) => item.plate === vehicle.plate) === index,
    ),
  ];
  const shown = filter
    ? allVehicles.filter((vehicle) => vehicle.plate === filter)
    : allVehicles;
  const occupied = (plate: string, hour: number) =>
    daily.find(
      (booking) =>
        booking.plate === plate && hour >= booking.start && hour < booking.end,
    );
  const previewRange =
    selected &&
    hoverHour !== null &&
    hoverPlate === selected.plate &&
    (hoverHour < selected.start || hoverHour >= selected.end)
      ? {
          plate: selected.plate,
          start: Math.min(hoverHour, selected.start),
          end: Math.max(hoverHour + 1, selected.end),
        }
      : null;
  const available = (plate: string, selectedDate = date) =>
    24 -
    bookings
      .filter(
        (booking) => booking.date === selectedDate && booking.plate === plate,
      )
      .reduce((total, booking) => total + booking.end - booking.start, 0);
  const days = Array.from({ length: 12 }, (_, index) => {
    const day = new Date(anchor + "T12:00:00");
    day.setDate(day.getDate() + index);
    return localDate(day);
  });
  const minRegularDate = regularMinDate();
  const typeDateValid = bookingType === "REGULAR" ? date >= minRegularDate : true;

  function changeDate(nextDate: string) {
    setDate(nextDate);
    setSelected(null);
    setError("");
  }
  function shift(amount: number) {
    const day = new Date(anchor + "T12:00:00");
    day.setDate(day.getDate() + amount);
    setAnchor(localDate(day));
  }
  function pick(plate: string, hour: number) {
    if (
      occupied(plate, hour) ||
      !fleet.some((vehicle) => vehicle.plate === plate) ||
      (current?.role !== "Admin" && isPastSlot(date, hour))
    )
      return;
    let next = { plate, start: hour, end: hour + 1 };
    if (selected?.plate === plate) {
      if (hour === selected.start && selected.end === hour + 1) {
        setSelected(null);
        return;
      }
      next = {
        plate,
        start: Math.min(hour, selected.start),
        end: Math.max(hour + 1, selected.end),
      };
      for (let slot = next.start; slot < next.end; slot++)
        if (occupied(plate, slot)) {
          setError(
            "Choose a continuous range of available hours. Clear selection to start again.",
          );
          return;
        }
    }
    setSelected(next);
    setError("");
  }
  function resetForm() {
    setDriverId("");
    setDestination("");
    setPurpose("");
    setDestinationOther(false);
    setPurposeOther(false);
    setNotes("");
  }
  async function book() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const driver = drivers.find((account) => account.id === driverId),
        creator = currentAccount();
      if (!driver || !creator) throw Error("Select an active Driver.");
      const booking: Booking = {
        id: requestId,
        date,
        ...selected,
        driverId: driver.id,
        driver: driver.name,
        project: "",
        requestedById: creator.id,
        requestedByAccountId: creator.id,
        requestedBy: creator.name,
        destination,
        purpose,
        notes: notes.trim(),
        createdBy: creator.id,
        createdByAccountId: creator.id,
        createdAt: new Date().toISOString(),
        // The server always creates PENDING regardless of this value; it's
        // only here to satisfy the Booking type for the request payload.
        status: "PENDING",
        bookingType,
        urgentReason: bookingType === "URGENT" ? urgentReason.trim() : "",
      };
      const created = await saveBooking(booking);
      setActive(created);
      setSaved(true);
      setStep(2);
      setSelected(null);
      resetForm();
      setBookingType("REGULAR");
      setUrgentReason("");
      load();
    } catch (caught) {
      setError((caught as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  }
  function openBooking(booking: Booking) {
    setActive(booking);
    setSaved(false);
    setError("");
  }
  function openEdit() {
    if (!active || !canManageBooking(active)) return;
    setDraft(toDraft(active));
    setDraftDestinationOther(
      !options.destinations.some((item) => item.name === active.destination),
    );
    setDraftPurposeOther(
      !options.purposes.some((item) => item.name === active.purpose),
    );
    setEditOpen(true);
  }
  async function saveChanges() {
    if (!active || !draft) return;
    setBusy(true);
    setError("");
    try {
      const driver = drivers.find((account) => account.id === draft.driverId);
      if (!driver) throw Error("Select an active Driver.");
      const updated = await updateBooking({
        ...active,
        ...draft,
        driverId: driver.id,
        driver: driver.name,
        notes: draft.notes.trim(),
        urgentReason: draft.bookingType === "URGENT" ? draft.urgentReason.trim() : "",
      });
      setActive(updated);
      setEditOpen(false);
      setDate(updated.date);
      load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteBooking() {
    if (!active) return;
    setBusy(true);
    try {
      await removeBooking(active.id);
      setActive(null);
      setDeleteOpen(false);
      load();
    } catch (caught) {
      setError((caught as Error).message);
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  }
  const canChange = !!active && canManageBooking(active, current);
  const invalidDraft =
    !draft ||
    !draft.date ||
    !draft.plate ||
    !draft.driverId ||
    !draft.destination ||
    !draft.purpose ||
    draft.start >= draft.end ||
    (draft.bookingType === "URGENT" && !draft.urgentReason.trim());
  const draftScheduleChanged =
    !!active &&
    !!draft &&
    (active.date !== draft.date ||
      active.plate !== draft.plate ||
      active.start !== draft.start ||
      active.end !== draft.end ||
      active.driverId !== draft.driverId ||
      active.bookingType !== draft.bookingType);
  const myPending = pending.filter(
    (booking) => (booking.createdByAccountId || booking.createdBy) === current?.id,
  );

  return (
    <div className="booking-flow">
      <div className="booking-steps">
        <span className={step === 1 ? "current" : ""}>
          1 <b>Choose date</b>
        </span>
        <i />
        <span className={step === 2 ? "current" : ""}>
          2 <b>Vehicle & time</b>
        </span>
        <i />
        <span className={step === 3 ? "current" : ""}>
          3 <b>Booking details</b>
        </span>
      </div>
      {step > 1 && (
        <Button
          variant="ghost"
          onClick={() => {
            setStep(step - 1);
            setError("");
          }}
          className="booking-back"
        >
          <ArrowLeft size={16} /> Back
        </Button>
      )}
      <div className="booking-heading">
        <div>
          <h1>
            {step === 1
              ? "When do you need a vehicle?"
              : step === 2
                ? "Pick vehicle & time"
                : "Booking details"}
          </h1>
          <p>
            {step === 1
              ? "Choose a day to see your fleet’s availability."
              : step === 2
                ? "Tap an hour, then extend your selection with another available hour."
                : "Choose the Driver, Destination and Purpose for this booking."}
          </p>
        </div>
        {step > 1 && (
          <b>
            {dateLabel(date, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </b>
        )}
      </div>
      {error && !editOpen && (
        <div className="notice" role="alert">
          {error}
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              load();
            }}
          >
            Close
          </Button>
        </div>
      )}
      {loading && <p role="status">Loading availability…</p>}

      {step === 1 && (
        <>
          {myPending.length > 0 && (
            <section className="availability-card">
              <div className="section-heading">
                <h2>Your pending requests</h2>
                <span className="availability-total">{myPending.length} awaiting approval</span>
              </div>
              <div className="fleet-chips">
                {myPending.map((booking) => (
                  <button key={booking.id} onClick={() => openBooking(booking)}>
                    {dateLabel(booking.date, { month: "short", day: "numeric" })} ·{" "}
                    {allVehicles.find((vehicle) => vehicle.plate === booking.plate)?.name || booking.plate} ·{" "}
                    {booking.bookingType === "URGENT" ? "Urgent" : "Regular"}
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="date-strip-wrap">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous dates"
              onClick={() => shift(-7)}
            >
              <ChevronLeft size={18} />
            </Button>
            <div className="date-strip">
              {days.map((day) => (
                <button
                  key={day}
                  className={"date-card " + (date === day ? "selected" : "")}
                  onClick={() => changeDate(day)}
                  aria-pressed={date === day}
                >
                  <span>{dateLabel(day, { weekday: "short" })}</span>
                  <b>{dateLabel(day, { day: "numeric" })}</b>
                  <small>
                    {fleet.length
                      ? fleet.some(
                          (vehicle) => available(vehicle.plate, day) > 0,
                        )
                        ? "● ● ●"
                        : "—"
                      : "—"}
                  </small>
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next dates"
              onClick={() => shift(7)}
            >
              <ChevronRight size={18} />
            </Button>
          </div>
          <div className="date-other">
            <label>
              Jump to date{" "}
              <Input
                type="date"
                value={date}
                onChange={(event) => {
                  if (event.target.value) {
                    changeDate(event.target.value);
                    setAnchor(event.target.value);
                  }
                }}
              />
            </label>
          </div>
          <section className="availability-card">
            <div className="section-heading">
              <h2>
                {dateLabel(date, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </h2>
              <span className="availability-total">
                {fleet.reduce(
                  (total, vehicle) => total + available(vehicle.plate),
                  0,
                )}{" "}
                vehicle-hours open
              </span>
            </div>
            <div className="fleet-chips">
              <button
                className={!filter ? "active" : ""}
                onClick={() => setFilter("")}
              >
                All vehicles
              </button>
              {fleet.map((vehicle) => (
                <button
                  key={vehicle.plate}
                  className={filter === vehicle.plate ? "active" : ""}
                  onClick={() =>
                    setFilter(filter === vehicle.plate ? "" : vehicle.plate)
                  }
                >
                  {vehicle.name} · {available(vehicle.plate)}h open
                </button>
              ))}
            </div>
            <p>Availability is based on active saved bookings. Time slots are one hour each.</p>
          </section>
          <section className="availability-card">
            <div className="section-heading">
              <div>
                <h2>Your fleet</h2>
                <p>Select a vehicle or view the full schedule.</p>
              </div>
            </div>
            {!fleet.length && !loading ? (
              <div className="fleet-empty">
                <Truck size={34} />
                <h3>No active vehicles</h3>
                <p>Ask an Admin to add or activate a vehicle in Settings.</p>
              </div>
            ) : (
              <div className="vehicle-cards">
                {shown.map((vehicle) => (
                  <button
                    key={vehicle.plate}
                    className={
                      "vehicle-card " +
                      (available(vehicle.plate) === 0 ? "full" : "")
                    }
                    onClick={() => {
                      setFilter(vehicle.plate);
                      setStep(2);
                    }}
                  >
                    <Truck size={24} />
                    <b>{vehicle.name}</b>
                    <span>{vehicle.plate}</span>
                    <small>
                      {available(vehicle.plate)} / 24 hours available
                    </small>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {step === 2 && (
        <>
          <div className="grid-toolbar">
            <div className="fleet-chips">
              <button
                className={!filter ? "active" : ""}
                onClick={() => {
                  setFilter("");
                  setSelected(null);
                }}
              >
                All vehicles
              </button>
              {allVehicles.map((vehicle) => (
                <button
                  key={vehicle.plate}
                  className={filter === vehicle.plate ? "active" : ""}
                  onClick={() => {
                    setFilter(vehicle.plate);
                    setSelected(null);
                  }}
                >
                  {vehicle.name}
                </button>
              ))}
            </div>
            <div className="slot-legend">
              <span>□ Available</span>
              <span>■ Selected</span>
              <span>▧ Booked</span>
            </div>
          </div>
          <div className="time-grid-scroll">
            <div
              className="time-grid"
              style={{
                gridTemplateColumns: `66px repeat(${Math.max(shown.length, 1)},minmax(145px,1fr))`,
              }}
            >
              <div className="grid-corner">TIME</div>
              {shown.map((vehicle) => (
                <div className="vehicle-col" key={vehicle.plate}>
                  <Truck size={22} />
                  <b>{vehicle.name}</b>
                  <span>
                    {vehicle.plate}
                    {!fleet.some((item) => item.plate === vehicle.plate)
                      ? " · Inactive"
                      : ""}
                  </span>
                </div>
              ))}
              {Array.from({ length: 24 }, (_, hour) => [
                <div className="hour-label" key={"h" + hour}>
                  {time(hour)}
                </div>,
                ...shown.map((vehicle) => {
                  const booking = occupied(vehicle.plate, hour),
                    chosen =
                      selected?.plate === vehicle.plate &&
                      hour >= selected.start &&
                      hour < selected.end,
                    unavailableSlot = !fleet.some(
                      (item) => item.plate === vehicle.plate,
                    ),
                    pastSlot =
                      current?.role !== "Admin" && isPastSlot(date, hour),
                    previewed =
                      !chosen &&
                      previewRange?.plate === vehicle.plate &&
                      hour >= previewRange.start &&
                      hour < previewRange.end;
                  return (
                    <button
                      key={vehicle.plate + hour}
                      className={
                        "time-slot " +
                        (booking
                          ? "booked"
                          : chosen
                            ? "chosen"
                            : unavailableSlot || pastSlot
                              ? "booked"
                              : previewed
                                ? "preview"
                                : "")
                      }
                      aria-label={`${vehicle.name}, ${time(hour)} to ${time(hour + 1)}, ${booking ? "booked" : chosen ? "selected" : unavailableSlot ? "unavailable" : pastSlot ? "past" : "available"}`}
                      aria-pressed={!!chosen}
                      onClick={() =>
                        booking
                          ? openBooking(booking)
                          : pick(vehicle.plate, hour)
                      }
                      onMouseEnter={() => {
                        if (!booking && !unavailableSlot && !pastSlot) {
                          setHoverPlate(vehicle.plate);
                          setHoverHour(hour);
                        }
                      }}
                      onMouseLeave={() => {
                        setHoverPlate(null);
                        setHoverHour(null);
                      }}
                    >
                      <span>{time(hour)}</span>
                      {booking ? (
                        <>
                          <b>{booking.destination}</b>
                          <small>{booking.driver}</small>
                        </>
                      ) : chosen ? (
                        <Check size={17} />
                      ) : (
                        <small>
                          {unavailableSlot ? "Unavailable" : "Available"}
                        </small>
                      )}
                    </button>
                  );
                }),
              ])}
            </div>
          </div>
        </>
      )}

      {step === 3 && selected && (
        <section className="availability-card booking-confirm">
          <div className="reservation-summary">
            <Truck size={30} />
            <div>
              <span className="summary-label">SELECTED VEHICLE</span>
              <h2>
                {
                  fleet.find((vehicle) => vehicle.plate === selected.plate)
                    ?.name
                }
              </h2>
              <p>{selected.plate}</p>
              <span className="summary-label">SELECTED TIME</span>
              <p>
                {dateLabel(date, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                · {time(selected.start)} – {time(selected.end)}
              </p>
            </div>
            <b>
              {selected.end - selected.start}{" "}
              {selected.end - selected.start === 1 ? "hour" : "hours"}
            </b>
          </div>
          <div className="fields booking-fields">
            <label className="field">
              <span>BOOKING TYPE *</span>
              <Select value={bookingType} onValueChange={(value) => setBookingType(value as "REGULAR" | "URGENT")}>
                <SelectTrigger aria-label="Booking Type">
                  <SelectValue placeholder="Select Booking Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REGULAR">Regular · 7 days notice</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
              {!typeDateValid && (
                <small className="field-hint">
                  This date is less than 7 days away — choose Urgent, or go back and pick a later date.
                </small>
              )}
            </label>
            <label className="field">
              <span>DRIVER *</span>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger aria-label="Driver">
                  <SelectValue placeholder="Select Driver" />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="field">
              <span>DESTINATION *</span>
              {destinationOther ? (
                <div className="field-other">
                  <Input
                    aria-label="Destination"
                    placeholder="Type a destination"
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    maxLength={120}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="field-other-back"
                    onClick={() => {
                      setDestinationOther(false);
                      setDestination("");
                    }}
                  >
                    Choose from list
                  </button>
                </div>
              ) : (
                <Select
                  value={destination}
                  onValueChange={(value) => {
                    if (value === OTHER_OPTION) {
                      setDestinationOther(true);
                      setDestination("");
                    } else setDestination(value);
                  }}
                >
                  <SelectTrigger aria-label="Destination">
                    <SelectValue placeholder="Select Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.destinations
                      .filter((item) => item.status === "Active")
                      .map((item) => (
                        <SelectItem key={item.id} value={item.name}>
                          {item.name}
                        </SelectItem>
                      ))}
                    <SelectItem value={OTHER_OPTION}>Other…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </label>
            <label className="field">
              <span>PURPOSE *</span>
              {purposeOther ? (
                <div className="field-other">
                  <Input
                    aria-label="Purpose"
                    placeholder="Type a purpose"
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                    maxLength={120}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="field-other-back"
                    onClick={() => {
                      setPurposeOther(false);
                      setPurpose("");
                    }}
                  >
                    Choose from list
                  </button>
                </div>
              ) : (
                <Select
                  value={purpose}
                  onValueChange={(value) => {
                    if (value === OTHER_OPTION) {
                      setPurposeOther(true);
                      setPurpose("");
                    } else setPurpose(value);
                  }}
                >
                  <SelectTrigger aria-label="Purpose">
                    <SelectValue placeholder="Select Purpose" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.purposes
                      .filter((item) => item.status === "Active")
                      .map((item) => (
                        <SelectItem key={item.id} value={item.name}>
                          {item.name}
                        </SelectItem>
                      ))}
                    <SelectItem value={OTHER_OPTION}>Other…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </label>
            <label className="field booking-notes">
              <span>NOTES</span>
              <Textarea
                placeholder="Optional"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={500}
              />
            </label>
            {bookingType === "URGENT" && (
              <label className="field booking-notes">
                <span>URGENT REASON *</span>
                <Textarea
                  placeholder="Why does this need to be booked urgently?"
                  value={urgentReason}
                  onChange={(event) => setUrgentReason(event.target.value)}
                  maxLength={500}
                />
              </label>
            )}
          </div>
          <p className="helper">
            This request needs Admin approval before it&apos;s confirmed. Only
            active Drivers and booking choices appear.
          </p>
        </section>
      )}

      <div className="booking-bottom">
        <div>
          {step === 1 ? (
            <span>
              {dateLabel(date, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
          ) : selected ? (
            <>
              <span>
                <b>
                  {
                    fleet.find((vehicle) => vehicle.plate === selected.plate)
                      ?.name
                  }
                </b>{" "}
                · {time(selected.start)} – {time(selected.end)} ·{" "}
                {hoursText(selected.end - selected.start)}
              </span>
              {step === 2 && previewRange && (
                <span className="preview-hint">
                  Hovering: {time(previewRange.start)} –{" "}
                  {time(previewRange.end)} ·{" "}
                  {hoursText(previewRange.end - previewRange.start)}
                </span>
              )}
              {step === 2 && (
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  Clear selection
                </Button>
              )}
            </>
          ) : (
            <span>Select your vehicle and hours</span>
          )}
        </div>
        <Button
          className="booking-continue"
          disabled={
            busy ||
            loading ||
            !fleet.length ||
            (step === 2 && !selected) ||
            (step === 3 &&
              (!driverId ||
                !destination ||
                !purpose ||
                !typeDateValid ||
                (bookingType === "URGENT" && !urgentReason.trim())))
          }
          onClick={() => {
            if (step === 1) setStep(2);
            else if (step === 2) {
              setRequestId(crypto.randomUUID());
              resetForm();
              setStep(3);
            } else book();
          }}
        >
          {busy
            ? "Saving…"
            : step === 1
              ? "Continue — " +
                dateLabel(date, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              : step === 2
                ? "Continue"
                : "Confirm booking"}
        </Button>
      </div>

      <Dialog
        open={!!active && !editOpen}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {saved
                ? active?.status === "PENDING"
                  ? "Request submitted — pending approval"
                  : "Booking confirmed"
                : "Booking details"}
            </DialogTitle>
            <DialogDescription>
              {active &&
                dateLabel(active.date, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
            </DialogDescription>
          </DialogHeader>
          {active && (
            <>
              <div className="booking-details">
                <h2>
                  {allVehicles.find((vehicle) => vehicle.plate === active.plate)
                    ?.name || active.plate}{" "}
                  · {active.plate}
                </h2>
                <p>
                  <b>Time:</b> {time(active.start)} – {time(active.end)}
                </p>
                <p>
                  <b>Driver:</b> {active.driver}
                </p>
                <p>
                  <b>Destination:</b> {active.destination}
                </p>
                <p>
                  <b>Purpose:</b> {active.purpose}
                </p>
                {active.notes && (
                  <p>
                    <b>Notes:</b> {active.notes}
                  </p>
                )}
                <p>
                  <b>Type:</b> {active.bookingType === "URGENT" ? "Urgent" : "Regular"}
                </p>
                {active.bookingType === "URGENT" && active.urgentReason && (
                  <p>
                    <b>Urgent reason:</b> {active.urgentReason}
                  </p>
                )}
                <p>
                  <b>Status:</b>{" "}
                  <span className={"status-pill " + active.status.toLowerCase()}>
                    {statusLabel[active.status]}
                  </span>
                </p>
              </div>
              <DialogFooter className="booking-dialog-actions">
                <Button variant="outline" onClick={() => setActive(null)}>
                  Close
                </Button>
                {canChange && (
                  <>
                    <Button variant="outline" onClick={openEdit}>
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => setDeleteOpen(true)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </DialogFooter>
              {!canChange && !saved && (
                <p className="helper">
                  {active.status === "REJECTED"
                    ? "This booking was rejected."
                    : active.status === "CANCELLED"
                      ? "This booking was cancelled."
                      : "This booking is read-only."}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditOpen(false);
            setDraft(null);
          }
        }}
      >
        <DialogContent className="edit-booking-modal">
          <DialogHeader>
            <DialogTitle>Edit booking</DialogTitle>
            <DialogDescription>
              Vehicle and Driver availability will be checked again before
              saving.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="modal-fields edit-booking-fields">
              <label className="field">
                <span>BOOKING TYPE *</span>
                <Select
                  value={draft.bookingType}
                  onValueChange={(value) => setDraft({ ...draft, bookingType: value as "REGULAR" | "URGENT" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REGULAR">Regular</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              {draft.bookingType === "URGENT" && (
                <label className="field booking-notes">
                  <span>URGENT REASON *</span>
                  <Textarea
                    placeholder="Why does this need to be booked urgently?"
                    value={draft.urgentReason}
                    onChange={(event) => setDraft({ ...draft, urgentReason: event.target.value })}
                    maxLength={500}
                  />
                </label>
              )}
              <label className="field">
                <span>DATE *</span>
                <Input
                  type="date"
                  value={draft.date}
                  onChange={(event) =>
                    setDraft({ ...draft, date: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>VEHICLE *</span>
                <Select
                  value={draft.plate}
                  onValueChange={(plate) => setDraft({ ...draft, plate })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fleet.map((vehicle) => (
                      <SelectItem key={vehicle.plate} value={vehicle.plate}>
                        {vehicle.name} · {vehicle.plate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="field">
                <span>START TIME *</span>
                <Select
                  value={String(draft.start)}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      start: Number(value),
                      end: Math.max(Number(value) + 1, draft.end),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, hour) => (
                      <SelectItem key={hour} value={String(hour)}>
                        {time(hour)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="field">
                <span>END TIME *</span>
                <Select
                  value={String(draft.end)}
                  onValueChange={(value) =>
                    setDraft({ ...draft, end: Number(value) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      { length: 24 - draft.start },
                      (_, index) => draft.start + index + 1,
                    ).map((hour) => (
                      <SelectItem key={hour} value={String(hour)}>
                        {time(hour)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="field">
                <span>DRIVER *</span>
                <Select
                  value={draft.driverId}
                  onValueChange={(value) =>
                    setDraft({ ...draft, driverId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="field">
                <span>DESTINATION *</span>
                {draftDestinationOther ? (
                  <div className="field-other">
                    <Input
                      aria-label="Destination"
                      placeholder="Type a destination"
                      value={draft.destination}
                      onChange={(event) =>
                        setDraft({ ...draft, destination: event.target.value })
                      }
                      maxLength={120}
                    />
                    <button
                      type="button"
                      className="field-other-back"
                      onClick={() => {
                        setDraftDestinationOther(false);
                        setDraft({ ...draft, destination: "" });
                      }}
                    >
                      Choose from list
                    </button>
                  </div>
                ) : (
                  <Select
                    value={draft.destination}
                    onValueChange={(value) => {
                      if (value === OTHER_OPTION) {
                        setDraftDestinationOther(true);
                        setDraft({ ...draft, destination: "" });
                      } else setDraft({ ...draft, destination: value });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.destinations
                        .filter(
                          (item) =>
                            item.status === "Active" ||
                            item.name === draft.destination,
                        )
                        .map((item) => (
                          <SelectItem key={item.id} value={item.name}>
                            {item.name}
                            {item.status === "Inactive" ? " (Inactive)" : ""}
                          </SelectItem>
                        ))}
                      <SelectItem value={OTHER_OPTION}>Other…</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </label>
              <label className="field">
                <span>PURPOSE *</span>
                {draftPurposeOther ? (
                  <div className="field-other">
                    <Input
                      aria-label="Purpose"
                      placeholder="Type a purpose"
                      value={draft.purpose}
                      onChange={(event) =>
                        setDraft({ ...draft, purpose: event.target.value })
                      }
                      maxLength={120}
                    />
                    <button
                      type="button"
                      className="field-other-back"
                      onClick={() => {
                        setDraftPurposeOther(false);
                        setDraft({ ...draft, purpose: "" });
                      }}
                    >
                      Choose from list
                    </button>
                  </div>
                ) : (
                  <Select
                    value={draft.purpose}
                    onValueChange={(value) => {
                      if (value === OTHER_OPTION) {
                        setDraftPurposeOther(true);
                        setDraft({ ...draft, purpose: "" });
                      } else setDraft({ ...draft, purpose: value });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.purposes
                        .filter(
                          (item) =>
                            item.status === "Active" ||
                            item.name === draft.purpose,
                        )
                        .map((item) => (
                          <SelectItem key={item.id} value={item.name}>
                            {item.name}
                            {item.status === "Inactive" ? " (Inactive)" : ""}
                          </SelectItem>
                        ))}
                      <SelectItem value={OTHER_OPTION}>Other…</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </label>
              <label className="field booking-notes">
                <span>NOTES</span>
                <Textarea
                  placeholder="Optional"
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft({ ...draft, notes: event.target.value })
                  }
                  maxLength={500}
                />
              </label>
            </div>
          )}
          {active?.status === "SCHEDULED" && draftScheduleChanged && (
            <p className="helper">
              Changing the date, time, vehicle, driver, or booking type will
              require re-approval.
            </p>
          )}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setDraft(null);
                setError("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="primary"
              disabled={busy || invalidDraft}
              onClick={saveChanges}
            >
              {busy ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete booking?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete your booking? The reservation will
              be cancelled and will no longer block the Vehicle or Driver.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep Booking</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                deleteBooking();
              }}
            >
              Delete Booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
