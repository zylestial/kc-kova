"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelInvite,
  DRIVER_TYPES,
  listInvites,
  resendInvite,
  sendInvites,
  type DriverType,
  type Invite,
  type InviteResult,
  type Role,
} from "@/lib/kova-api";
import { hasRequestSwitches } from "@/lib/request-access";
import { accessLabels } from "@/lib/settings-filters";

const ROLES: Role[] = ["Requester", "Scheduler", "Admin", "Driver", "Finance"];
const blankBatch = () => ({
  emails: "",
  role: "Requester" as Role,
  driverType: "Truck" as DriverType,
  canRequestDaily: false,
  canRequestCompany: false,
  canDriveCompany: false,
});

export const roleLabel = (invite: Pick<Invite, "role" | "driverType">) =>
  invite.role === "Driver" ? `Driver · ${invite.driverType ?? "Truck"}` : invite.role;

/** The invites still waiting to be accepted, with Resend and Cancel (0072). */
export function useInvites(onNotice: (message: string) => void) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    listInvites()
      .then((list) => {
        setInvites(list);
        setLoadError("");
      })
      .catch((caught) => setLoadError((caught as Error).message));
  }, []);
  useEffect(load, [load]);

  async function act(invite: Invite, action: "resend" | "cancel") {
    setBusy(`${action}:${invite.id}`);
    try {
      if (action === "resend") await resendInvite(invite.id);
      else await cancelInvite(invite.id);
      onNotice(action === "resend" ? `Invite sent again to ${invite.email}.` : `Invite to ${invite.email} cancelled.`);
    } catch (caught) {
      onNotice((caught as Error).message);
    } finally {
      setBusy("");
      load();
    }
  }
  return { invites, loadError, load, busy, act };
}

/** Settings → Accounts → Pending invites. */
export function InviteTable({
  invites,
  busy,
  onAct,
}: {
  invites: Invite[];
  busy: string;
  onAct: (invite: Invite, action: "resend" | "cancel") => void;
}) {
  return (
    <div className="schedule-table">
      <table>
        <thead>
          <tr>
            <th>EMAIL</th>
            <th>ACCOUNT TYPE</th>
            <th>ACCESS</th>
            <th>SENT</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invites.map((invite) => {
            const access = accessLabels({ ...invite, status: "Active" });
            return (
              <tr key={invite.id}>
                <td>
                  <b>{invite.email}</b>
                </td>
                <td>{roleLabel(invite)}</td>
                <td>
                  {access.length ? (
                    <div className="settings-chips">
                      {access.map((label) => (
                        <span className="settings-tag" key={label}>
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {new Date(invite.sentAt).toLocaleDateString()}
                  {invite.expired && <span className="status-pill pending">Link expired</span>}
                </td>
                <td>
                  <div className="modal-actions">
                    <Button variant="outline" disabled={!!busy} onClick={() => onAct(invite, "resend")}>
                      {busy === `resend:${invite.id}` ? "Sending…" : "Resend"}
                    </Button>
                    <Button variant="ghost" disabled={!!busy} onClick={() => onAct(invite, "cancel")}>
                      {busy === `cancel:${invite.id}` ? "Cancelling…" : "Cancel"}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Invite people (Settings → Accounts, beside the tabs): invite by email in
 * batches, each batch with one account type and set of permissions. The
 * invited person sets up their own name, username, position and password
 * from the emailed link (0072). Mount it with a new key per opening for a fresh batch.
 */
export function InviteDialog({ open, onOpenChange, onSent }: { open: boolean; onOpenChange: (open: boolean) => void; onSent: () => void }) {
  const [batch, setBatch] = useState(blankBatch());
  const [result, setResult] = useState<InviteResult | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState("");

  // The same rules as the Accounts form (0051, 0059, 0074).
  const isDriver = batch.role === "Driver";
  const switches = hasRequestSwitches(batch);
  const companyAllowed = batch.role === "Requester" || batch.role === "Admin" || switches;
  const count = new Set(batch.emails.split(/[s,;]+/).filter((item) => item.includes("@"))).size;

  function start() {
    setBatch(blankBatch());
    setResult(null);
    setFormError("");
  }
  async function send() {
    if (!count) {
      setFormError("Add at least one email address.");
      return;
    }
    setBusy("send");
    setFormError("");
    try {
      const sent = await sendInvites({
        emails: batch.emails,
        role: batch.role,
        driverType: isDriver ? batch.driverType : undefined,
        canRequestDaily: switches && batch.canRequestDaily,
        canRequestCompany: companyAllowed && batch.canRequestCompany,
        canDriveCompany: !isDriver && batch.canDriveCompany,
      });
      setResult(sent);
      onSent();
    } catch (caught) {
      setFormError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite people</DialogTitle>
            <DialogDescription>
              Everyone in this batch gets the same account type and permissions. Each person gets an email with a link
              to choose their own username and password. Links work for 7 days.
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="modal-fields" role="status">
              <p>
                <b>Sent {result.sent.length}</b> {result.sent.length === 1 ? "invite" : "invites"}.
              </p>
              {result.skipped.length > 0 && (
                <p>
                  Skipped: {result.skipped.map((item) => `${item.email} (${item.reason})`).join(", ")}.
                </p>
              )}
              {result.invalid.length > 0 && <p>Not email addresses: {result.invalid.join(", ")}.</p>}
              {result.failed.length > 0 && (
                <p className="modal-error">Couldn&apos;t send to: {result.failed.join(", ")}. Try them again in a moment.</p>
              )}
              <div className="modal-actions">
                <Button variant="outline" onClick={start}>
                  Invite more
                </Button>
                <Button className="primary" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="modal-fields">
                <label className="field">
                  <span>Emails *</span>
                  <Textarea
                    rows={6}
                    value={batch.emails}
                    placeholder={"ana@gmail.com\nben.cruz@yahoo.com"}
                    onChange={(e) => setBatch({ ...batch, emails: e.target.value })}
                  />
                  <small>One per line, or separated by commas.</small>
                </label>
                <label className="field">
                  <span>Account Type *</span>
                  <Select value={batch.role} onValueChange={(v) => setBatch({ ...batch, role: v as Role })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {isDriver && (
                  <label className="field">
                    <span>Driver type *</span>
                    <Select value={batch.driverType} onValueChange={(v) => setBatch({ ...batch, driverType: v as DriverType })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DRIVER_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                <div className="field">
                  <span>Requests</span>
                  {isDriver && !switches ? (
                    <small>Truck drivers can&apos;t make requests.</small>
                  ) : (
                    <div className="person-projects">
                      {switches ? (
                        <label>
                          <Checkbox
                            checked={batch.canRequestDaily}
                            onCheckedChange={(v) => setBatch({ ...batch, canRequestDaily: v === true })}
                          />
                          Can make Daily Vehicle Trip requests
                        </label>
                      ) : (
                        <small>Can make Daily Vehicle Trip requests.</small>
                      )}
                      {batch.role === "Admin" ? (
                        <small>Can request company trips.</small>
                      ) : (
                        <label>
                          <Checkbox
                            checked={batch.canRequestCompany}
                            onCheckedChange={(v) => setBatch({ ...batch, canRequestCompany: v === true })}
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
                      {batch.driverType === "Company car" ? "Can drive company trips." : "Truck drivers don't drive company trips."}
                    </small>
                  ) : (
                    <div className="person-projects">
                      <label>
                        <Checkbox
                          checked={batch.canDriveCompany}
                          onCheckedChange={(v) => setBatch({ ...batch, canDriveCompany: v === true })}
                        />
                        Can drive company trips
                      </label>
                    </div>
                  )}
                </div>
              </div>
              {formError && (
                <p className="modal-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="modal-actions">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Go back
                </Button>
                <Button className="primary" disabled={busy === "send"} onClick={send}>
                  {busy === "send" ? "Sending…" : count > 1 ? `Send ${count} invites` : "Send invite"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
  );
}
