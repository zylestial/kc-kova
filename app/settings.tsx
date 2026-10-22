"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { PASSWORD_HINT, passwordError } from "@/lib/password-policy";
import { accountMissing, stillNeeded, vehicleMissing } from "@/lib/missing-fields";
import { useCallback, useEffect, useState } from "react";
import {
  saveAccount as storeAccount,
  saveVehicle as storeVehicle,
  changeAccountPassword,
  listAccountEmails,
  resendEmailLink,
  DRIVER_TYPES,
  type EmailStatus,
  type DriverType,
  type Role,
} from "@/lib/kova-api";
import { MailPlus } from "lucide-react";
import { hasRequestSwitches } from "@/lib/request-access";
import { Checkbox } from "@/components/ui/checkbox";
import { useKovaData } from "@/lib/use-kova-data";
import { useAccount } from "./(app)/providers";
import BookingOptions from "./booking-options";
import { InviteDialog, useInvites } from "./invites-panel";
import AccountList from "./settings-accounts";
import VehicleList from "./settings-vehicles";
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
  role: Role;
  status: "Active" | "Inactive";
  position: string;
  driverType?: DriverType;
  canRequestDaily: boolean;
  canRequestCompany: boolean;
  canDriveCompany: boolean;
};
type Vehicle = {
  plate: string;
  name: string;
  status: "Active" | "Inactive";
  assignedDriverId?: string | null;
  companyTrips: boolean;
  hasOdometer: boolean;
};
const UNASSIGNED = "unassigned";
const blankAccount = () => ({
  name: "",
  username: "",
  email: "",
  role: "Requester" as Account["role"],
  status: "Active" as Account["status"],
  position: "",
  driverType: "Truck" as DriverType,
  canRequestDaily: false,
  canRequestCompany: false,
  canDriveCompany: false,
});
const blankVehicle = () => ({
  plate: "",
  name: "",
  status: "Active" as Vehicle["status"],
  assignedDriverId: UNASSIGNED,
  companyTrips: false,
  hasOdometer: true,
});
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
  disabled = false,
}: {
  label: string;
  value: T;
  items: readonly T[];
  onChange: (s: T) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label} *</span>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
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
  const { account: me } = useAccount();
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);
  const [busy, setBusy] = useState(false);
  // Accounts are only edited here; new ones come from Invite people (0072).
  const [accountModal, setAccountModal] = useState<"edit" | null>(null);
  const [vehicleModal, setVehicleModal] = useState<"add" | "edit" | null>(null);
  const [account, setAccount] = useState(blankAccount());
  const [vehicle, setVehicle] = useState(blankVehicle());
  const [accountId, setAccountId] = useState("");
  const [originalPlate, setOriginalPlate] = useState("");
  const [passwordFor, setPasswordFor] = useState<Account | null>(null);
  const [passwords, setPasswords] = useState({ next: "", confirm: "" });
  // Every account's email (0072), by account id; loaded apart from the app's data.
  const [emails, setEmails] = useState<Record<string, EmailStatus>>({});
  const [resending, setResending] = useState("");
  const loadEmails = useCallback(() => {
    listAccountEmails()
      .then((list) => setEmails(Object.fromEntries(list.map(({ accountId, ...status }) => [accountId, status]))))
      .catch(() => undefined);
  }, []);
  useEffect(loadEmails, [loadEmails]);
  async function resendLink(a: Account) {
    setResending(a.id);
    try {
      await resendEmailLink(a.id);
      setNotice(`Confirm link sent again to ${emails[a.id]?.pendingEmail}.`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setResending("");
    }
  }
  const invites = useInvites(setNotice);
  // A new key per opening gives Invite people a fresh batch.
  const [inviteKey, setInviteKey] = useState(0);
  const [inviting, setInviting] = useState(false);
  const drivers = accounts.filter(
    (a) => a.role === "Driver" && a.status === "Active",
  );
  // Who may request what (0051, 0074): a Truck driver never; a Scheduler or
  // Company car driver only with the switches below; Requesters and Admins
  // always make Daily requests, and company trips with their switch.
  const isDriver = account.role === "Driver";
  const switches = hasRequestSwitches(account);
  const companyAllowed = account.role === "Requester" || account.role === "Admin" || switches;
  // The lists follow the app's data (useKovaData), so another Admin's change
  // shows once the app refreshes; after a save there is only the error to clear.
  function load() {
    setError("");
  }
  function editAccount(a: Account) {
    setAccount({
      name: a.name,
      username: a.username,
      role: a.role,
      status: a.status,
      email: emails[a.id]?.pendingEmail ?? emails[a.id]?.email ?? "",
      position: a.position,
      driverType: a.driverType ?? "Truck",
      canRequestDaily: a.canRequestDaily,
      canRequestCompany: a.canRequestCompany,
      canDriveCompany: a.canDriveCompany,
    });
    setAccountId(a.id);
    setAccountModal("edit");
    setFormError("");
  }
  async function saveAccount() {
    const missing = accountMissing(account, false);
    if (companyAllowed && account.canRequestCompany && !account.position.trim()) missing.push("Position");
    if (missing.length) {
      setFormError(stillNeeded(missing));
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await storeAccount({
        id: accountId,
        name: account.name.trim(),
        username: account.username.trim(),
        role: account.role,
        status: account.status,
        email: account.email.trim(),
        // Switches the role or Driver type can't have are sent off.
        position: account.position.trim(),
        driverType: isDriver ? account.driverType : undefined,
        canRequestDaily: switches && account.canRequestDaily,
        canRequestCompany: companyAllowed && account.canRequestCompany,
        canDriveCompany: !isDriver && account.canDriveCompany,
      });
      setAccountModal(null);
      setNotice("Account saved.");
      load();
      loadEmails();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function addVehicle(companyTrips: boolean) {
    setVehicle({ ...blankVehicle(), companyTrips });
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
      hasOdometer: v.hasOdometer,
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
          // A company trip vehicle's Driver is picked per request (0079).
          assignedDriverId:
            vehicle.companyTrips || vehicle.assignedDriverId === UNASSIGNED
              ? undefined
              : vehicle.assignedDriverId,
          companyTrips: vehicle.companyTrips,
          hasOdometer: vehicle.hasOdometer,
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
      <div className="settings-tabbar">
        <Tabs value={tab} onValueChange={setTab} className="main-nav">
          <TabsList>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
            <TabsTrigger value="options">Request choices</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "accounts" && (
          <Button
            className="primary"
            onClick={() => {
              setInviteKey((key) => key + 1);
              setInviting(true);
            }}
          >
            <MailPlus size={17} /> Invite people
          </Button>
        )}
      </div>
      <InviteDialog key={inviteKey} open={inviting} onOpenChange={setInviting} onSent={invites.load} />
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <Button variant="ghost" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {tab === "accounts" ? (
        <AccountList
          accounts={accounts}
          emails={emails}
          invites={invites.invites}
          invitesError={invites.loadError}
          onInvitesRetry={invites.load}
          inviteBusy={invites.busy}
          onInviteAct={invites.act}
          onEdit={editAccount}
          resending={resending}
          onResendLink={resendLink}
        />
      ) : tab === "vehicles" ? (
        <VehicleList vehicles={vehicles} accounts={accounts} onAdd={addVehicle} onEdit={editVehicle} />
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
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>Update this account. Inactive accounts cannot sign in.</DialogDescription>
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
            <label className="field">
              <span>Email</span>
              <Input
                type="email"
                value={account.email}
                onChange={(e) => setAccount({ ...account, email: e.target.value })}
                autoComplete="off"
                maxLength={254}
              />
              <small>A new email gets a confirm link; the old one keeps working until then.</small>
            </label>
            <Choice
              label="Account Type"
              value={account.role}
              items={["Requester", "Scheduler", "Admin", "Driver", "Finance"]}
              onChange={(v) => setAccount({ ...account, role: v })}
              disabled={accountId === me.id}
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
              disabled={accountId === me.id}
            />
            {accountId === me.id && <small>You can&apos;t change your own account type or status. Ask another Admin.</small>}
            <div className="field">
              <span>Requests</span>
              {isDriver && !switches ? (
                <small>Truck drivers can&apos;t make requests.</small>
              ) : (
                <div className="person-projects">
                  {switches ? (
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
            <div className="field">
              <span>Driving</span>
              {isDriver ? (
                // A Driver's comes from the Driver type (0079).
                <small>
                  {account.driverType === "Company car" ? "Can drive company trips." : "Truck drivers don't drive company trips."}
                </small>
              ) : (
                <div className="person-projects">
                  <label>
                    <Checkbox
                      checked={account.canDriveCompany}
                      onCheckedChange={(v) => setAccount({ ...account, canDriveCompany: v === true })}
                    />
                    Can drive company trips
                  </label>
                </div>
              )}
            </div>
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
            <Button variant="outline" onClick={() => setAccountModal(null)}>
              Go back
            </Button>
            <Button className="primary" disabled={busy} onClick={saveAccount}>
              {busy ? "Saving…" : "Save"}
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
            <div className="field">
              <span>Odometer</span>
              <div className="person-projects">
                <label>
                  <Checkbox
                    checked={vehicle.hasOdometer}
                    onCheckedChange={(v) => setVehicle({ ...vehicle, hasOdometer: v === true })}
                  />
                  Has an odometer
                </label>
              </div>
              <small>Turn off for a vehicle without one: its trips are completed without readings.</small>
            </div>
            {!vehicle.companyTrips && (
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
              <small>Drives this vehicle&apos;s Daily trips.</small>
            </label>
            )}
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
