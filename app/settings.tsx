"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { PASSWORD_HINT, passwordError } from "@/lib/password-policy";
import { accountMissing, stillNeeded, vehicleMissing } from "@/lib/missing-fields";
import { useState } from "react";
import { Car, Plus } from "lucide-react";
import {
  saveAccount as storeAccount,
  saveVehicle as storeVehicle,
  changeAccountPassword,
  DRIVER_TYPES,
  type DriverType,
} from "@/lib/kova-api";
import { canRequestCompany, canRequestDaily } from "@/lib/request-access";
import { Checkbox } from "@/components/ui/checkbox";
import { useKovaData } from "@/lib/use-kova-data";
import BookingOptions from "./booking-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
type Account = {
  id: string;
  name: string;
  username: string;
  role: "Requester" | "Scheduler" | "Admin" | "Driver";
  status: "Active" | "Inactive";
  position: string;
  driverType?: DriverType;
  canRequestDaily: boolean;
  canRequestCompany: boolean;
};
type Vehicle = {
  plate: string;
  name: string;
  status: "Active" | "Inactive";
  assignedDriverId?: string | null;
  companyTrips: boolean;
};
const UNASSIGNED = "unassigned";
const blankAccount = () => ({
  name: "",
  username: "",
  password: "",
  role: "Requester" as Account["role"],
  status: "Active" as Account["status"],
  position: "",
  driverType: "Truck" as DriverType,
  canRequestDaily: false,
  canRequestCompany: false,
});
const blankVehicle = () => ({
  plate: "",
  name: "",
  status: "Active" as Vehicle["status"],
  assignedDriverId: UNASSIGNED,
  companyTrips: false,
});
/** What an account may request, for the Accounts list (0051). */
function requestsLabel(account: Account) {
  const kinds = [canRequestDaily(account) && "Daily", canRequestCompany(account) && "Company trips"].filter(Boolean);
  return kinds.length ? kinds.join(" · ") : "—";
}
function TextField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label} *</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        autoComplete={autoComplete}
        maxLength={type === "password" ? 256 : 100}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Choice<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: readonly T[];
  onChange: (s: T) => void;
}) {
  return (
    <label className="field">
      <span>{label} *</span>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
export default function Settings() {
  const [tab, setTab] = useState("accounts");
  const { accounts, vehicles } = useKovaData();
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);
  const [busy, setBusy] = useState(false);
  const [accountModal, setAccountModal] = useState<"add" | "edit" | null>(null);
  const [vehicleModal, setVehicleModal] = useState<"add" | "edit" | null>(null);
  const [account, setAccount] = useState(blankAccount());
  const [vehicle, setVehicle] = useState(blankVehicle());
  const [accountId, setAccountId] = useState("");
  const [originalPlate, setOriginalPlate] = useState("");
  const [passwordFor, setPasswordFor] = useState<Account | null>(null);
  const [passwords, setPasswords] = useState({ next: "", confirm: "" });
  const drivers = accounts.filter(
    (a) => a.role === "Driver" && a.status === "Active",
  );
  const driverName = (id?: string | null) =>
    (id && accounts.find((a) => a.id === id)?.name) || "No Driver assigned";
  // Who may request what (0051): a Truck driver never; a Company car driver
  // only with the switches below; Requesters and Admins always make Daily
  // requests, and company trips with their switch.
  const isDriver = account.role === "Driver";
  const carDriver = isDriver && account.driverType === "Company car";
  const companyAllowed = account.role === "Requester" || account.role === "Admin" || carDriver;
  // The lists follow the app's data (useKovaData), so another Admin's change
  // shows once the app refreshes; after a save there is only the error to clear.
  function load() {
    setError("");
  }
  function addAccount() {
    setAccount(blankAccount());
    setAccountModal("add");
    setFormError("");
  }
  function editAccount(a: Account) {
    setAccount({
      name: a.name,
      username: a.username,
      role: a.role,
      status: a.status,
      password: "",
      position: a.position,
      driverType: a.driverType ?? "Truck",
      canRequestDaily: a.canRequestDaily,
      canRequestCompany: a.canRequestCompany,
    });
    setAccountId(a.id);
    setAccountModal("edit");
    setFormError("");
  }
  async function saveAccount() {
    const missing = accountMissing(account, accountModal === "add");
    if (companyAllowed && account.canRequestCompany && !account.position.trim()) missing.push("Position");
    if (missing.length) {
      setFormError(stillNeeded(missing));
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await storeAccount({
        id: accountModal === "add" ? "" : accountId,
        name: account.name.trim(),
        username: account.username.trim(),
        role: account.role,
        status: account.status,
        password: accountModal === "add" ? account.password : undefined,
        // Switches the role or Driver type can't have are sent off.
        position: account.position.trim(),
        driverType: isDriver ? account.driverType : undefined,
        canRequestDaily: carDriver && account.canRequestDaily,
        canRequestCompany: companyAllowed && account.canRequestCompany,
      });
      setAccountModal(null);
      setAccount({ ...account, password: "" });
      setNotice("Account saved.");
      load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function addVehicle() {
    setVehicle(blankVehicle());
    setVehicleModal("add");
    setFormError("");
  }
  function editVehicle(v: Vehicle) {
    setVehicle({
      plate: v.plate,
      name: v.name,
      status: v.status,
      assignedDriverId: v.assignedDriverId || UNASSIGNED,
      companyTrips: v.companyTrips,
    });
    setOriginalPlate(v.plate);
    setVehicleModal("edit");
    setFormError("");
  }
  async function saveVehicle() {
    const missing = vehicleMissing(vehicle);
    if (missing.length) {
      setFormError(stillNeeded(missing));
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await storeVehicle(
        {
          plate: vehicle.plate,
          name: vehicle.name.trim(),
          status: vehicle.status,
          assignedDriverId:
            vehicle.assignedDriverId === UNASSIGNED
              ? undefined
              : vehicle.assignedDriverId,
          companyTrips: vehicle.companyTrips,
        },
        vehicleModal === "edit" ? originalPlate : undefined,
      );
      setVehicleModal(null);
      setNotice("Vehicle saved.");
      load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changePassword() {
    if (passwords.next !== passwords.confirm) {
      setFormError("Passwords do not match.");
      return;
    }
    const problem = passwordError(passwords.next, passwordFor!.username);
    if (problem) {
      setFormError(problem);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await changeAccountPassword(passwordFor!.id, passwords.next);
      setPasswordFor(null);
      setPasswords({ next: "", confirm: "" });
      setNotice("Password changed.");
    } catch (caught) {
      setFormError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-shell">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>
            Settings<span className="title-dot">.</span>
          </h1>
          <p>Manage KOVA accounts, vehicles and request choices.</p>
        </div>
      </div>
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab} className="main-nav">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="options">Request choices</TabsTrigger>
        </TabsList>
      </Tabs>
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <Button variant="ghost" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {tab === "accounts" ? (
        <section className="schedule-panel">
          <div className="panel-toolbar">
            <div>
              <h2>Accounts</h2>
              <span className="count">{accounts.length}</span>
              <p>Manage people who can sign in.</p>
            </div>
            <Button className="primary" onClick={addAccount}>
              <Plus size={17} /> Add Account
            </Button>
          </div>
          <div className="schedule-table">
            <table>
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>USERNAME</th>
                  <th>ACCOUNT TYPE</th>
                  <th>CAN REQUEST</th>
                  <th>STATUS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.name}</b>
                    </td>
                    <td>{a.username}</td>
                    <td>{a.role === "Driver" ? `Driver · ${a.driverType ?? "Truck"}` : a.role}</td>
                    <td>{requestsLabel(a)}</td>
                    <td>
                      <span
                        className={
                          "badge " + (a.status === "Active" ? "complete" : "")
                        }
                      >
                        {a.status}
                      </span>
                    </td>
                    <td>
                      <Button variant="outline" onClick={() => editAccount(a)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : tab === "vehicles" ? (
        <section className="schedule-panel">
          <div className="panel-toolbar">
            <div>
              <h2>Vehicles</h2>
              <span className="count">{vehicles.length}</span>
              <p>Manage company vehicles.</p>
            </div>
            <Button className="primary" onClick={addVehicle}>
              <Plus size={17} /> Add Vehicle
            </Button>
          </div>
          {vehicles.length ? (
            <div className="schedule-table">
              <table>
                <thead>
                  <tr>
                    <th>PLATE NUMBER</th>
                    <th>VEHICLE NAME / MODEL</th>
                    <th>COMPANY TRIPS</th>
                    <th>ASSIGNED DRIVER</th>
                    <th>STATUS</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((v) => (
                    <tr key={v.plate}>
                      <td>
                        <b>{v.plate}</b>
                      </td>
                      <td>{v.name}</td>
                      <td>{v.companyTrips ? "Can be requested" : "—"}</td>
                      <td>{driverName(v.assignedDriverId)}</td>
                      <td>
                        <span
                          className={
                            "badge " + (v.status === "Active" ? "complete" : "")
                          }
                        >
                          {v.status}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          onClick={() => editVehicle(v)}
                        >
                          Edit
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
                <Car size={30} />
              </div>
              <h3>No vehicles yet</h3>
              <p>Add the first vehicle to make it available in Schedule.</p>
            </div>
          )}
        </section>
      ) : (
        <BookingOptions />
      )}
      <Dialog
        open={!!accountModal}
        onOpenChange={(o) => {
          if (!o) setAccountModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {accountModal === "add" ? "Add Account" : "Edit Account"}
            </DialogTitle>
            <DialogDescription>
              {accountModal === "add"
                ? "Add a Requester, Scheduler, Admin or Driver account."
                : "Update this account. Inactive accounts cannot sign in."}
            </DialogDescription>
          </DialogHeader>
          <div className="modal-fields">
            <TextField
              label="Name"
              value={account.name}
              onChange={(v) => setAccount({ ...account, name: v })}
            />
            <TextField
              label="Username"
              value={account.username}
              onChange={(v) => setAccount({ ...account, username: v })}
              autoComplete="off"
            />
            {accountModal === "add" && (
              <TextField
                label="Password"
                hint={PASSWORD_HINT}
                type="password"
                value={account.password}
                onChange={(v) => setAccount({ ...account, password: v })}
                autoComplete="new-password"
              />
            )}
            <Choice
              label="Account Type"
              value={account.role}
              items={["Requester", "Scheduler", "Admin", "Driver"]}
              onChange={(v) => setAccount({ ...account, role: v })}
            />
            {isDriver && (
              <Choice
                label="Driver type"
                value={account.driverType}
                items={DRIVER_TYPES}
                onChange={(v) => setAccount({ ...account, driverType: v })}
              />
            )}
            <Choice
              label="Status"
              value={account.status}
              items={["Active", "Inactive"]}
              onChange={(v) => setAccount({ ...account, status: v })}
            />
            {account.role !== "Scheduler" && (
              <div className="field">
                <span>Requests</span>
                {isDriver && !carDriver ? (
                  <small>Truck drivers can&apos;t make requests.</small>
                ) : (
                  <div className="person-projects">
                    {carDriver ? (
                      <label>
                        <Checkbox
                          checked={account.canRequestDaily}
                          onCheckedChange={(v) => setAccount({ ...account, canRequestDaily: v === true })}
                        />
                        Can make Daily Vehicle Trip requests
                      </label>
                    ) : (
                      <small>Can make Daily Vehicle Trip requests.</small>
                    )}
                    {account.role === "Admin" ? (
                      // Every Admin may (0059); no switch needed.
                      <small>Can request company trips.</small>
                    ) : (
                      <label>
                        <Checkbox
                          checked={account.canRequestCompany}
                          onCheckedChange={(v) => setAccount({ ...account, canRequestCompany: v === true })}
                        />
                        Can request company trips
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
            {(account.role === "Admin" || (companyAllowed && account.canRequestCompany)) && (
              <TextField
                label="Position"
                hint="Prints on the Company Trip Form, e.g. Site Engineer."
                value={account.position}
                onChange={(v) => setAccount({ ...account, position: v })}
              />
            )}
          </div>
          {formError && (
            <p className="modal-error" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            {accountModal === "edit" && (
              <Button
                variant="outline"
                onClick={() => {
                  setAccountModal(null);
                  setPasswordFor(
                    accounts.find((a) => a.id === accountId) || null,
                  );
                  setPasswords({ next: "", confirm: "" });
                  setFormError("");
                }}
              >
                Change Password
              </Button>
            )}
            <Button variant="outline" onClick={() => setAccountModal(null)}>
              Go back
            </Button>
            <Button className="primary" disabled={busy} onClick={saveAccount}>
              {busy
                ? "Saving…"
                : accountModal === "add"
                  ? "Add Account"
                  : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!passwordFor}
        onOpenChange={(o) => {
          if (!o) setPasswordFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Set a new password for {passwordFor?.name}. They will use it the
              next time they sign in. {PASSWORD_HINT}
            </DialogDescription>
          </DialogHeader>
          <div className="modal-fields">
            <TextField
              label="New Password"
              value={passwords.next}
              type="password"
              onChange={(v) => setPasswords({ ...passwords, next: v })}
              autoComplete="new-password"
            />
            <TextField
              label="Confirm Password"
              value={passwords.confirm}
              type="password"
              onChange={(v) => setPasswords({ ...passwords, confirm: v })}
              autoComplete="new-password"
            />
          </div>
          {formError && (
            <p className="modal-error" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setPasswordFor(null)}>
              Go back
            </Button>
            <Button
              className="primary"
              disabled={busy}
              onClick={changePassword}
            >
              {busy ? "Saving…" : "Change Password"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!vehicleModal}
        onOpenChange={(o) => {
          if (!o) setVehicleModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {vehicleModal === "add" ? "Add Vehicle" : "Edit Vehicle"}
            </DialogTitle>
            <DialogDescription>
              Manage which vehicles are available in Schedule. Inactive vehicles can&apos;t be chosen for new schedules.
              A vehicle that can be requested for company trips is offered on the Company Trip form, and its
              requester picks the Driver.
            </DialogDescription>
          </DialogHeader>
          <div className="modal-fields">
            <TextField
              label="Plate Number"
              value={vehicle.plate}
              onChange={(v) =>
                setVehicle({ ...vehicle, plate: v.toUpperCase() })
              }
            />
            <TextField
              label="Vehicle Name / Model"
              value={vehicle.name}
              onChange={(v) => setVehicle({ ...vehicle, name: v })}
            />
            <div className="field">
              <span>Company trips</span>
              <div className="person-projects">
                <label>
                  <Checkbox
                    checked={vehicle.companyTrips}
                    onCheckedChange={(v) => setVehicle({ ...vehicle, companyTrips: v === true })}
                  />
                  Can be requested for company trips
                </label>
              </div>
            </div>
            <label className="field">
              <span>Assigned Driver</span>
              <Select
                value={vehicle.assignedDriverId}
                onValueChange={(v) =>
                  setVehicle({ ...vehicle, assignedDriverId: v })
                }
              >
                <SelectTrigger aria-label="Assigned Driver">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>No Driver assigned</SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Choice
              label="Status"
              value={vehicle.status}
              items={["Active", "Inactive"]}
              onChange={(v) => setVehicle({ ...vehicle, status: v })}
            />
          </div>
          {formError && (
            <p className="modal-error" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setVehicleModal(null)}>
              Go back
            </Button>
            <Button className="primary" disabled={busy} onClick={saveVehicle}>
              {busy
                ? "Saving…"
                : vehicleModal === "add"
                  ? "Add Vehicle"
                  : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
