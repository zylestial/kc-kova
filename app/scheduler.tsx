"use client";
import { useState, useEffect } from "react";
import BookingFlow from "./booking-flow";
import {
  canFinishTrip,
  currentAccount,
  getBookings,
  getRecordForBooking,
  getRecords,
  getVehicles,
  saveRecord,
  validateDriverSubmission,
  type Booking,
  type HistoryEntry,
} from "@/lib/kova-api";
import {
  Truck,
  Plus,
  ChevronLeft,
  ChevronRight,
  Printer,
  ArrowUpRight,
  CalendarDays,
  Save,
  ArrowLeft,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import ReviewTrip from "./review-trip";
import RecordHistory from "./record-history";
import KovaBrand from "./kova-brand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
type Leg = {
  requestor: string;
  purpose: string;
  origin: string;
  destination: string;
  out: string;
  arrival: string;
  contact: string;
  phone: string;
};
export type RecordData = {
  id: string;
  date: string;
  plate: string;
  vehicle: string;
  driver: string;
  project: string;
  start: string;
  end: string;
  status: string;
  legs: Leg[];
  full: boolean;
  card: boolean;
  receipt: boolean;
  pm: string;
  coo: string;
  submitted: string;
  received: string;
  reference: string;
  finance: string;
  financeDate: string;
  bookingId?: string;
  submittedAt?: string;
  history?: HistoryEntry[];
};
const today = () => new Date().toLocaleDateString("en-CA");
const leg = (origin = "ANONANG"): Leg => ({
  requestor: "",
  purpose: "",
  origin,
  destination: "",
  out: "",
  arrival: "",
  contact: "",
  phone: "",
});
const fresh = (date: string): RecordData => ({
  id: crypto.randomUUID(),
  date,
  plate: "",
  vehicle: "",
  driver: "",
  project: "",
  start: "",
  end: "",
  status: "Scheduled",
  legs: [leg()],
  full: false,
  card: false,
  receipt: false,
  pm: "",
  coo: "",
  submitted: "",
  received: "",
  reference: "",
  finance: "Pending",
  financeDate: "",
});
function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <Input
        type={type}
        value={value}
        required={required}
        readOnly={readOnly}
        min={type === "number" ? 0 : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export default function Scheduler({
  role,
  onHome,
  onSignOut,
  driverBooking,
  driverBackLabel = "My Schedule",
  reviewRecordId,
}: {
  role: "Booker" | "Admin" | "Driver";
  onHome: () => void;
  onSignOut: () => void;
  driverBooking?: Booking;
  driverBackLabel?: string;
  reviewRecordId?: string;
}) {
  const [date, setDate] = useState(() => today());
  const [records, setRecords] = useState<RecordData[]>(() => getRecords() as RecordData[]);
  const [edit, setEdit] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState("details");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState("book");
  const [review, setReview] = useState(false);
  const [adminEditing, setAdminEditing] = useState(false);
  const [markConfirm, setMarkConfirm] = useState(false);
  useEffect(() => {
    document.title = `KOVA — ${edit ? "Daily Vehicle Record" : "Schedule"}`;
  }, [edit]);
  useEffect(() => {
    if (role !== "Driver" || !driverBooking) return;
    const signedIn = currentAccount();
    if (
      signedIn?.role !== "Driver" ||
      signedIn.id !== driverBooking.driverId ||
      !canFinishTrip(driverBooking)
    )
      return;
    const linked = getRecordForBooking(driverBooking) as RecordData | undefined;
    const draft = linked ? structuredClone(linked) : fresh(driverBooking.date);
    draft.bookingId = driverBooking.id;
    draft.date = driverBooking.date;
    draft.plate = driverBooking.plate;
    draft.vehicle =
      getVehicles().find((v) => v.plate === driverBooking.plate)?.name ||
      draft.vehicle ||
      driverBooking.plate;
    draft.driver = driverBooking.driver;
    draft.project = driverBooking.project;
    draft.pm = draft.pm || "Joedel Capillan";
    draft.coo = draft.coo || "President Vargas";
    if (!linked) draft.legs[0].destination = driverBooking.destination;
    // Deferred to a microtask: this reacts to the driverBooking prop
    // changing (not a one-time mount hydration), so it can't be replaced by
    // a lazy state initializer.
    queueMicrotask(() => {
      setEdit(draft);
      setDate(driverBooking.date);
    });
  }, [role, driverBooking]);
  useEffect(() => {
    if (
      role !== "Admin" ||
      !reviewRecordId ||
      currentAccount()?.role !== "Admin"
    )
      return;
    const record = getRecords().find(
      (r) => r.id === reviewRecordId && r.submittedAt,
    ) as RecordData | undefined;
    if (record) {
      queueMicrotask(() => {
        setEdit(structuredClone(record));
        setDate(record.date);
        setTab("details");
      });
    }
  }, [role, reviewRecordId]);
  function refresh() {
    setRecords(getRecords() as RecordData[]);
    setLoading(false);
  }
  const adminReviewMode = role === "Admin" && !!reviewRecordId;
  const reviewBooking =
    adminReviewMode && edit?.bookingId
      ? getBookings().find((b) => b.id === edit.bookingId)
      : undefined;
  const printBooking = edit?.bookingId
    ? getBookings().find((booking) => booking.id === edit.bookingId)
    : undefined;
  const readOnly =
    (role === "Driver" && !!edit?.submittedAt) ||
    (role === "Booker" && !!edit?.submittedAt) ||
    (role === "Admin" && edit?.status === "DONE") ||
    (adminReviewMode && !adminEditing);
  function update<K extends keyof RecordData>(k: K, v: RecordData[K]) {
    if (edit && !readOnly) {
      setEdit({ ...edit, [k]: v });
      setDirty(true);
      setMessage("");
    }
  }
  function changeLeg(i: number, k: keyof Leg, v: string) {
    if (!edit) return;
    const ls = edit.legs.map((l) => ({ ...l }));
    ls[i][k] = v;
    if (k === "destination" && ls[i + 1]) ls[i + 1].origin = v;
    update("legs", ls);
  }
  async function save() {
    if (!edit || readOnly) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await saveRecord(edit);
      setEdit(saved as RecordData);
      setRecords(getRecords() as RecordData[]);
      setDirty(false);
      if (adminReviewMode) setAdminEditing(false);
      setMessage("Saved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function markDone() {
    if (
      !edit ||
      !adminReviewMode ||
      dirty ||
      edit.status === "DONE" ||
      currentAccount()?.role !== "Admin"
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await saveRecord({ ...edit, status: "DONE" });
      setEdit(saved as RecordData);
      setRecords(getRecords() as RecordData[]);
      setAdminEditing(false);
      setMarkConfirm(false);
      setMessage("Trip marked as Done.");
    } catch (e) {
      setMarkConfirm(false);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openReview() {
    if (!edit || !driverBooking || readOnly) return;
    setMessage("");
    try {
      validateDriverSubmission(
        edit,
        driverBooking,
        currentAccount()?.id || "",
      );
      setReview(true);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function submitTrip() {
    if (!edit || !driverBooking || readOnly) return;
    setBusy(true);
    setMessage("");
    try {
      const account = currentAccount();
      if (account?.role !== "Driver")
        throw Error("Sign in as the assigned Driver.");
      validateDriverSubmission(edit, driverBooking, account.id);
      if (getRecordForBooking(driverBooking)?.submittedAt)
        throw Error("This trip has already been submitted.");
      const record = {
        ...edit,
        date: driverBooking.date,
        plate: driverBooking.plate,
        driver: driverBooking.driver,
        project: driverBooking.project,
        bookingId: driverBooking.id,
        status: "SUBMITTED FOR REVIEW",
        submittedAt: new Date().toISOString(),
      };
      await saveRecord(record);
      setEdit(record);
      setRecords(getRecords() as RecordData[]);
      setDirty(false);
      setReview(false);
      setMessage("Trip submitted for review.");
    } catch (e) {
      setReview(false);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(r: RecordData) {
    setEdit(structuredClone(r));
    setTab("details");
    setMessage("");
    setDirty(false);
  }
  function close() {
    if (dirty && !confirm("May unsaved changes. Discard changes?")) return;
    setEdit(null);
    setMessage("");
    setDirty(false);
    if (role === "Driver" || adminReviewMode) onHome();
  }
  function shift(n: number) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + n);
    setDate(d.toLocaleDateString("en-CA"));
  }
  const visible = records.filter((r) => r.date === date);
  const closed = visible.filter((r) => r.status === "Completed").length;
  return (
    <>
      <div className="app-shell">
        <header className="topbar">
          <KovaBrand />
          <div className="workspace-label">OPERATIONS</div>
          <div className="account">KC</div>
          <Button variant="ghost" onClick={onSignOut}>
            Sign Out
          </Button>
        </header>
        <main>
          <div className="breadcrumb">
            {role !== "Booker" && (
              <Button
                variant="ghost"
                onClick={adminReviewMode ? close : onHome}
              >
                <ArrowLeft size={15} />{" "}
                {role === "Driver"
                  ? driverBackLabel
                  : adminReviewMode
                    ? "Finished Trips"
                    : "Admin Home"}
              </Button>
            )}{" "}
            Operations <span>/</span>{" "}
            {role === "Driver"
              ? "My Schedule"
              : adminReviewMode
                ? "Finished Trips"
                : "Schedule"}{" "}
            {edit && (
              <>
                <span>/</span> Daily record
              </>
            )}
          </div>
          {!edit && role !== "Driver" && !adminReviewMode && (
            <Tabs value={view} onValueChange={setView} className="main-nav">
              <TabsList>
                <TabsTrigger value="book">Book a vehicle</TabsTrigger>
                <TabsTrigger value="records">Daily records & PDF</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {(role === "Driver" || adminReviewMode) && !edit ? null : !edit &&
            view === "book" ? (
            <BookingFlow />
          ) : !edit ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">DISPATCH & RECORDS</div>
                  <h1>
                    Daily trip records<span className="title-dot">.</span>
                  </h1>
                  <p>
                    Record actual movements and prepare the daily form for
                    Finance.
                  </p>
                </div>
                <Button
                  className="primary"
                  onClick={() => open(fresh(date || today()))}
                >
                  <Plus size={18} /> New daily record
                </Button>
              </div>
              <div className="stats">
                <div>
                  <span>Scheduled vehicles</span>
                  <strong>{visible.length.toString().padStart(2, "0")}</strong>
                  <small>For the selected day</small>
                </div>
                <div>
                  <span>On the road</span>
                  <strong>
                    {visible
                      .filter((r) => r.status === "In progress")
                      .length.toString()
                      .padStart(2, "0")}
                  </strong>
                  <small>Trips in progress</small>
                </div>
                <div>
                  <span>Returned & completed</span>
                  <strong>{closed.toString().padStart(2, "0")}</strong>
                  <small>Daily records closed</small>
                </div>
                <div className="rule-card">
                  <MapPin size={21} />
                  <span>
                    Every day starts and
                    <br />
                    ends at <b>ANONANG.</b>
                  </span>
                </div>
              </div>
              <section className="schedule-panel">
                <div className="panel-toolbar">
                  <div>
                    <CalendarDays size={20} />
                    <h2>Daily records</h2>
                    <span className="count">{visible.length}</span>
                  </div>
                  <div className="date-controls">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Previous day"
                      onClick={() => shift(-1)}
                    >
                      <ChevronLeft size={18} />
                    </Button>
                    <Input
                      type="date"
                      aria-label="Schedule date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Next day"
                      onClick={() => shift(1)}
                    >
                      <ChevronRight size={18} />
                    </Button>
                    <Button variant="outline" onClick={() => setDate(today())}>
                      Today
                    </Button>
                  </div>
                </div>
                {loading ? (
                  <div className="empty">Loading daily records…</div>
                ) : visible.length ? (
                  <div className="schedule-table">
                    <table>
                      <thead>
                        <tr>
                          <th>VEHICLE / PLATE</th>
                          <th>DRIVER</th>
                          <th>PROJECT / DEPARTMENT</th>
                          <th>TRIP LEGS</th>
                          <th>STATUS</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((r) => (
                          <tr key={r.id} onClick={() => open(r)}>
                            <td>
                              <b>{r.vehicle}</b>
                              <small>{r.plate}</small>
                            </td>
                            <td>{r.driver}</td>
                            <td>{r.project || "—"}</td>
                            <td>{r.legs.length}</td>
                            <td>
                              <span
                                className={
                                  "badge " +
                                  (r.status === "Completed" ? "complete" : "")
                                }
                              >
                                {r.status}
                              </span>
                            </td>
                            <td>
                              <Button
                                variant="ghost"
                                onClick={() => open(r)}
                                aria-label={"Open " + r.plate}
                              >
                                <ArrowUpRight size={19} />
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
                      <Truck size={30} />
                    </div>
                    <h3>A clear road ahead</h3>
                    <p>No daily trip records for this day.</p>
                    <Button variant="outline" onClick={() => open(fresh(date))}>
                      <Plus size={16} /> Create the first record
                    </Button>
                  </div>
                )}
                <div className="panel-foot">
                  <span>One vehicle. One day. One complete trip record.</span>
                  <span>Daily utilization form ↗</span>
                </div>
              </section>
              {message && (
                <div role="alert" className="notice">
                  {message}
                  <Button variant="ghost" onClick={refresh}>
                    Retry
                  </Button>
                </div>
              )}
              <div className="workflow">
                <span>
                  <b>01</b> Schedule vehicle
                </span>
                <i />
                <span>
                  <b>02</b> Record trip legs
                </span>
                <i />
                <span>
                  <b>03</b> Return & close
                </span>
                <i />
                <span>
                  <b>04</b> Print for Finance
                </span>
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost" className="back" onClick={close}>
                <ArrowLeft size={16} />{" "}
                {role === "Driver"
                  ? `Back to ${driverBackLabel}`
                  : adminReviewMode
                    ? "Back to Finished Trips"
                    : "Back to schedule"}
              </Button>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">DAILY VEHICLE RECORD</div>
                  <h1>
                    {edit.plate || "Schedule a vehicle"}
                    <span className="title-dot">.</span>
                  </h1>
                  <p>
                    {edit.date} ·{" "}
                    {edit.vehicle ||
                      "Vehicle details, trip legs and return confirmation"}
                  </p>
                </div>
                <div className="actions">
                  {role === "Admin" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (dirty) {
                          setMessage("Save your changes before printing.");
                          return;
                        }
                        window.print();
                      }}
                      disabled={!records.some((r) => r.id === edit.id) || dirty}
                    >
                      <Printer size={17} /> Print / Save PDF
                    </Button>
                  )}
                  {role === "Driver" ? (
                    readOnly ? (
                      <span className="badge complete">
                        Submitted for review
                      </span>
                    ) : (
                      <Button
                        className="primary"
                        disabled={busy}
                        onClick={openReview}
                      >
                        <Save size={17} /> Review & Submit
                      </Button>
                    )
                  ) : adminReviewMode ? (
                    edit.status === "DONE" ? (
                      <span className="badge complete">Done</span>
                    ) : adminEditing ? (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => {
                            const original = getRecords().find(
                              (r) => r.id === edit.id,
                            );
                            if (original)
                              setEdit(structuredClone(original as RecordData));
                            setAdminEditing(false);
                            setDirty(false);
                            setMessage("");
                          }}
                        >
                          Cancel edit
                        </Button>
                        <Button
                          className="primary"
                          disabled={busy}
                          onClick={save}
                        >
                          <Save size={17} /> Save
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => setAdminEditing(true)}
                        >
                          Edit
                        </Button>
                        <Button
                          className="primary"
                          disabled={busy || dirty}
                          onClick={() => setMarkConfirm(true)}
                        >
                          Mark as Done
                        </Button>
                      </>
                    )
                  ) : (
                    !readOnly && (
                      <Button
                        className="primary"
                        disabled={busy}
                        onClick={save}
                      >
                        <Save size={17} />
                        {busy
                          ? "Saving…"
                          : dirty
                            ? "Save changes"
                            : "Save record"}
                      </Button>
                    )
                  )}
                </div>
              </div>
              {role === "Driver" && driverBooking && (
                <div className="driver-booking-context">
                  <strong>Scheduled trip</strong>
                  <span>
                    {driverBooking.date} · {driverBooking.start}:00 –{" "}
                    {driverBooking.end}:00 · {driverBooking.destination} ·
                    Requested by {driverBooking.requestedBy}
                  </span>
                </div>
              )}
              {adminReviewMode && reviewBooking && (
                <div className="driver-booking-context">
                  <strong>Scheduled trip</strong>
                  <span>
                    Requested By: {reviewBooking.requestedBy} · Destination:{" "}
                    {reviewBooking.destination} · Purpose:{" "}
                    {reviewBooking.purpose}
                  </span>
                  <span
                    className={
                      "badge " + (edit.status === "DONE" ? "complete" : "")
                    }
                  >
                    {edit.status === "DONE" ? "Done" : "Submitted for Review"}
                  </span>
                </div>
              )}
              {message && (
                <div
                  className={
                    "notice " +
                    (message === "Saved." ? "success" : "")
                  }
                  role="status"
                >
                  {message}
                </div>
              )}
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="record-tabs">
                  <TabsTrigger value="details">
                    01 · Vehicle details
                  </TabsTrigger>
                  <TabsTrigger value="trips">02 · Trip record</TabsTrigger>
                  <TabsTrigger value="return">
                    03 · {role === "Driver" ? "Return" : "Return & approvals"}
                  </TabsTrigger>
                  {role === "Admin" && (
                    <TabsTrigger value="finance">04 · Finance</TabsTrigger>
                  )}
                </TabsList>
                <TabsContent value="details">
                  <fieldset disabled={readOnly} className="record-fieldset">
                    <section className="editor-panel">
                      <h2>Vehicle & assignment</h2>
                      <p>
                        {role === "Driver"
                          ? "Booked vehicle details are filled automatically. Enter the actual starting odometer."
                          : "One daily form per vehicle. Reserve planned time slots in Book a vehicle."}
                      </p>
                      <div className="fields">
                        <Field
                          label="Date"
                          type="date"
                          value={edit.date}
                          onChange={(v) => update("date", v)}
                          required
                          readOnly={role === "Driver" || adminReviewMode}
                        />
                        <Field
                          label="Plate number"
                          value={edit.plate}
                          onChange={(v) => update("plate", v.toUpperCase())}
                          required
                          readOnly={role === "Driver" || adminReviewMode}
                        />
                        <Field
                          label="Vehicle"
                          value={edit.vehicle}
                          onChange={(v) => update("vehicle", v)}
                          required
                          readOnly={role === "Driver"}
                        />
                        <Field
                          label="Driver"
                          value={edit.driver}
                          onChange={(v) => update("driver", v)}
                          required
                          readOnly={role === "Driver" || adminReviewMode}
                        />
                        {role === "Admin" && !!edit.project && (
                          <Field
                            label="Project / department (historical)"
                            value={edit.project}
                            onChange={(v) => update("project", v)}
                            readOnly={adminReviewMode && !adminEditing}
                          />
                        )}
                        <Field
                          label="Starting odometer (km)"
                          type="number"
                          value={edit.start}
                          onChange={(v) => update("start", v)}
                          required={role === "Driver"}
                        />
                        {role !== "Driver" && !adminReviewMode && (
                          <label className="field">
                            <span>Record status</span>
                            <Select
                              value={edit.status}
                              onValueChange={(v) => update("status", v)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {["Scheduled", "In progress", "Completed"].map(
                                  (s) => (
                                    <SelectItem key={s} value={s}>
                                      {s}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                          </label>
                        )}
                      </div>
                    </section>
                  </fieldset>
                </TabsContent>
                <TabsContent value="trips">
                  <fieldset disabled={readOnly} className="record-fieldset">
                    <section className="editor-panel">
                      <div className="section-heading">
                        <div>
                          <h2>Trip record</h2>
                          <p>
                            Chronological legs. First origin and final
                            destination must be ANONANG.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          disabled={edit.legs.length >= 8}
                          onClick={() =>
                            update("legs", [
                              ...edit.legs,
                              leg(edit.legs.at(-1)?.destination || ""),
                            ])
                          }
                        >
                          <Plus size={16} /> Add leg
                        </Button>
                      </div>
                      {edit.legs.map((l, i) => (
                        <div className="leg-card" key={i}>
                          <div className="leg-label">
                            <b>LEG {String(i + 1).padStart(2, "0")}</b>
                            {i === edit.legs.length - 1 && i > 0 && (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  update("legs", edit.legs.slice(0, -1))
                                }
                              >
                                Remove leg
                              </Button>
                            )}
                          </div>
                          <div className="fields leg-fields">
                            <label className="field">
                              <span>Origin (automatic)</span>
                              <Input value={l.origin} readOnly />
                            </label>
                            <Field
                              label="Destination"
                              value={l.destination}
                              onChange={(v) => changeLeg(i, "destination", v)}
                            />
                            <Field
                              label="Time out"
                              type="time"
                              value={l.out}
                              onChange={(v) => changeLeg(i, "out", v)}
                            />
                            <Field
                              label="Time in"
                              type="time"
                              value={l.arrival}
                              onChange={(v) => changeLeg(i, "arrival", v)}
                            />
                            <Field
                              label="Requestor"
                              value={l.requestor}
                              onChange={(v) => changeLeg(i, "requestor", v)}
                            />
                            <Field
                              label="Purpose / activity"
                              value={l.purpose}
                              onChange={(v) => changeLeg(i, "purpose", v)}
                            />
                            <Field
                              label="Destination contact name"
                              value={l.contact}
                              onChange={(v) => changeLeg(i, "contact", v)}
                            />
                            <Field
                              label="Contact number"
                              value={l.phone}
                              onChange={(v) => changeLeg(i, "phone", v)}
                            />
                          </div>
                        </div>
                      ))}
                      <p className="helper">
                        Up to 8 legs per daily form. Requestors sign the printed
                        form.
                      </p>
                    </section>
                  </fieldset>
                </TabsContent>
                <TabsContent value="return">
                  <fieldset disabled={readOnly} className="record-fieldset">
                    <section className="editor-panel">
                      <h2>Final return / full-tank confirmation</h2>
                      <p>Fueling location: SHELL</p>
                      <div className="checks">
                        {(
                          [
                            [
                              "full",
                              "Driver confirms the vehicle is returned in full-tank condition",
                            ],
                            ["card", "Official company fleet card used"],
                            [
                              "receipt",
                              "Shell gas receipt attached to the printed form",
                            ],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key}>
                            <Checkbox
                              checked={edit[key]}
                              onCheckedChange={(v) => update(key, v === true)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <div className="fields">
                        <Field
                          label="Ending odometer (km)"
                          type="number"
                          value={edit.end}
                          onChange={(v) => update("end", v)}
                          required={role === "Driver"}
                        />
                        <div className="distance">
                          <span>Total distance</span>
                          <b>
                            {edit.start !== "" && edit.end !== ""
                              ? +edit.end >= +edit.start
                                ? +edit.end - +edit.start
                                : "—"
                              : "—"}{" "}
                            <small>km</small>
                          </b>
                        </div>
                      </div>
                    </section>
                  </fieldset>
                </TabsContent>
                {role === "Admin" && (
                  <TabsContent value="finance">
                    <fieldset disabled={readOnly} className="record-fieldset">
                      <section className="editor-panel">
                        <h2>For Finance use</h2>
                        <p>
                          Submit completed trip forms by the next business day.
                        </p>
                        <div className="fields">
                          <Field
                            label="Date submitted"
                            type="date"
                            value={edit.submitted}
                            onChange={(v) => update("submitted", v)}
                          />
                          <Field
                            label="Received by"
                            value={edit.received}
                            onChange={(v) => update("received", v)}
                          />
                          <Field
                            label="Reference number"
                            value={edit.reference}
                            onChange={(v) => update("reference", v)}
                          />
                          <Field
                            label="Finance date"
                            type="date"
                            value={edit.financeDate}
                            onChange={(v) => update("financeDate", v)}
                          />
                          <label className="field">
                            <span>Status</span>
                            <Select
                              value={edit.finance}
                              onValueChange={(v) => update("finance", v)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[
                                  "Pending",
                                  "Complete",
                                  "Returned",
                                  "Invalid / late",
                                ].map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                        </div>
                      </section>
                    </fieldset>
                  </TabsContent>
                )}
              </Tabs>
              <div className="editor-foot">
                <span>
                  {role === "Driver"
                    ? readOnly
                      ? "Submitted for review · read-only"
                      : "Review and submit when the trip record is ready."
                    : adminReviewMode
                      ? edit.status === "DONE"
                        ? "Done · read-only"
                        : adminEditing
                          ? dirty
                            ? "Unsaved changes"
                            : "Select Save when finished editing."
                          : "Select Edit to make corrections."
                      : dirty
                        ? "Unsaved changes"
                        : "Changes are saved when you select Save record."}
                </span>
                <span>{edit.legs.length} / 8 trip legs</span>
              </div>
              {adminReviewMode && (
                <RecordHistory entries={edit.history || []} />
              )}
            </>
          )}
          <footer>
            <span>KOVA</span>
            <span>Kayelen&apos;s Operations and Vehicle Allocation</span>
          </footer>
        </main>
      </div>
      {role === "Driver" && edit && driverBooking && (
        <ReviewTrip
          record={edit}
          booking={driverBooking}
          open={review}
          onBack={() => setReview(false)}
          onSubmit={submitTrip}
          busy={busy}
        />
      )}
      <AlertDialog open={markConfirm} onOpenChange={setMarkConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this trip as Done?</AlertDialogTitle>
            <AlertDialogDescription>
              The record will be saved as completed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                markDone();
              }}
            >
              Mark as Done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {role === "Admin" && edit && (
        <PrintForm r={edit} booking={printBooking} />
      )}
    </>
  );
}
function PrintForm({ r, booking }: { r: RecordData; booking?: Booking }) {
  const check = (v: boolean) => (v ? "☑" : "☐");
  const val = (s: string) => s || "________________";
  return (
    <article className="print-form">
      <header className="print-header">
        <span className="print-header-tag">COMPANY TRIP FORM - TRUCK UTILIZATION</span>
        <img src="/images/kova-print-logo.png" alt="Kayelen's Construction logo" />
      </header>
      <h1>DAILY VEHICLE TRIP &amp; UTILIZATION FORM</h1>
      <div className="print-info">
        <div>
          DATE <b>{val(r.date)}</b>
        </div>
        <div>
          VEHICLE <b>{val(r.vehicle)}</b>
        </div>
        <div>
          PLATE NO. <b>{val(r.plate)}</b>
        </div>
        <div>
          DRIVER <b>{val(r.driver)}</b>
        </div>
        <div>
          PROJECT / DEPARTMENT <b>{r.project || "________________"}</b>
        </div>
        <div>
          STARTING ODOMETER <b>{val(r.start)} km</b>
        </div>
        <div>
          REQUESTED BY <b>{val(booking?.requestedBy || "")}</b>
        </div>
        <div>
          DESTINATION <b>{val(booking?.destination || "")}</b>
        </div>
        <div>
          PURPOSE <b>{val(booking?.purpose || "")}</b>
        </div>
      </div>
      <h2>ROUTE & RECORDING RULE</h2>
      <p>
        The first trip leg of the day MUST originate from ANONANG and the final
        trip leg MUST terminate at ANONANG. Record every movement
        chronologically. The destination of the preceding leg must be the origin
        of the succeeding leg. A Requestor may sign/countersign a trip leg when
        applicable. Example: ANONANG → PROJECT SITE → SUPPLIER → SHELL →
        ANONANG.
      </p>
      <h2>TRIP RECORD</h2>
      <table className="print-trips">
        <colgroup>
          {[15, 22, 4, 10, 7, 12, 7, 23].map((n, i) => (
            <col key={i} style={{ width: n + "%" }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {[
              "REQUESTOR / SIGNATURE",
              "PURPOSE / ACTIVITY AT DESTINATION",
              "LEG",
              "ORIGIN",
              "TIME OUT",
              "DESTINATION",
              "TIME IN",
              "DESTINATION CONTACT / SITE ENGR. / LEADMAN / SUPPLIER",
            ].map((t) => (
              <th key={t}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, i) => {
            const l = r.legs[i];
            return (
              <tr key={i}>
                <td>
                  Name: {l?.requestor || "____________"}
                  <div className="sign-line">Sign: ______________</div>
                </td>
                <td>{l?.purpose}</td>
                <td>{i + 1}</td>
                <td>{l?.origin || (i === 0 ? "ANONANG" : "")}</td>
                <td>{l?.out}</td>
                <td>{l?.destination || (!l && i === 7 ? "ANONANG" : "")}</td>
                <td>{l?.arrival}</td>
                <td>
                  Name: {l?.contact || "________________"}
                  <div className="sign-line">
                    Contact: {l?.phone || "______________"}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>FINAL RETURN / FULL-TANK CONFIRMATION</h2>
      <div className="print-return">
        <div>
          <p>
            <strong>FUELING LOCATION</strong> SHELL
          </p>
          <p>
            <strong>FULL-TANK CONFIRMATION</strong> {check(r.full)} DRIVER
            CONFIRMS VEHICLE IS RETURNED IN FULL-TANK CONDITION
          </p>
          <p>
            <strong>DRIVER CERTIFICATION</strong> I certify that the vehicle was
            refueled to FULL TANK before returning to Anonang, using the
            official company fleet card, and the Shell gas receipt is attached.
          </p>
        </div>
        <div>
          <p>
            <strong>FLEET CARD</strong> {check(r.card)} USED
          </p>
          <p>
            <strong>GAS RECEIPT</strong> {check(r.receipt)} ATTACHED
          </p>
          <p>
            <strong>SIGNATURE</strong> ________________
          </p>
        </div>
      </div>
      <h2>VEHICLE CONTROL</h2>
      <div className="print-row">
        <span>
          ENDING ODOMETER <b>{val(r.end)} km</b>
        </span>
        <span>
          TOTAL DISTANCE{" "}
          <b>
            {r.start !== "" && r.end !== "" ? +r.end - +r.start : "________"} km
          </b>
        </span>
        <span>
          NO. OF TRIP LEGS <b>{r.legs.length}</b>
        </span>
      </div>
      <h2>APPROVALS</h2>
      <div className="print-approval">
        <span>PROJECT MANAGER</span>
        <span>Joedel Capillan (PM)</span>
        <span>SIGNATURE ________________________</span>
        <span>2ND-LEVEL APPROVAL / COO</span>
        <span>President Vargas (COO)</span>
        <span>SIGNATURE ________________________</span>
      </div>
      <h2>FOR FINANCE USE</h2>
      <div className="print-row">
        <span>DATE SUBMITTED {val(r.submitted)}</span>
        <span>RECEIVED BY {val(r.received)}</span>
        <span>REF. NO. {val(r.reference)}</span>
      </div>
      <div className="print-row">
        <span>STATUS</span>
        {["Complete", "Returned", "Invalid / late"].map((s) => (
          <span key={s}>
            {check(r.finance === s)} {s.toUpperCase()}
          </span>
        ))}
        <span>DATE {val(r.financeDate)}</span>
      </div>
      <p className="submission">
        SUBMISSION CONTROL: Completed trip forms must be submitted to Finance by
        the next business day. Late forms may be considered INVALID.
      </p>
    </article>
  );
}
