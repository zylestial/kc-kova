"use client";
import { useCallback, useEffect, useState } from "react";
import { MailPlus } from "lucide-react";
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

const ROLES: Role[] = ["Requester", "Scheduler", "Admin", "Driver", "Finance"];
const blankBatch = () => ({
  emails: "",
  role: "Requester" as Role,
  driverType: "Truck" as DriverType,
  canRequestDaily: false,
  canRequestCompany: false,
});

const roleLabel = (invite: Pick<Invite, "role" | "driverType">) =>
  invite.role === "Driver" ? `Driver · ${invite.driverType ?? "Truck"}` : invite.role;

/**
 * Settings → Accounts: invite people by email in batches, each batch with
 * one account type and set of request permissions, and the invites still
 * waiting to be accepted. The invited person sets up their own name,
 * username, position and password from the emailed link (0072).
 */
export default function InvitesPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [batch, setBatch] = useState(blankBatch());
  const [result, setResult] = useState<InviteResult | null>(null);
  const [formError, setFormError] = useState("");
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

  // The same rules as the Accounts form (0051, 0059, 0074).
  const isDriver = batch.role === "Driver";
  const switches = hasRequestSwitches(batch);
  const companyAllowed = batch.role === "Requester" || batch.role === "Admin" || switches;
  const count = new Set(batch.emails.split(/[\s,;]+/).filter((item) => item.includes("@"))).size;

  function start() {
    setBatch(blankBatch());
    setResult(null);
    setFormError("");
    setOpen(true);
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
      });
      setResult(sent);
      load();
    } catch (caught) {
      setFormError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

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

  return (
    <section className="schedule-panel">
      <div className="panel-toolbar">
        <div>
          <h2>Pending invites</h2>
          <span className="count">{invites.length}</span>
          <p>People who were emailed an invite and haven&apos;t set up their account yet.</p>
        </div>
        <Button className="primary" onClick={start}>
          <MailPlus size={17} /> Invite people
        </Button>
      </div>
      {loadError && (
        <div className="notice" role="alert">
          {loadError}{" "}
          <Button variant="ghost" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {invites.length > 0 && (
        <div className="schedule-table">
          <table>
            <thead>
              <tr>
                <th>EMAIL</th>
                <th>ACCOUNT TYPE</th>
                <th>SENT</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>
                    <b>{invite.email}</b>
                  </td>
                  <td>{roleLabel(invite)}</td>
                  <td>
                    {new Date(invite.sentAt).toLocaleDateString()}
                    {invite.expired && <span className="badge"> Link expired</span>}
                  </td>
                  <td>
                    <div className="modal-actions">
                      <Button variant="outline" disabled={!!busy} onClick={() => act(invite, "resend")}>
                        {busy === `resend:${invite.id}` ? "Sending…" : "Resend"}
                      </Button>
                      <Button variant="ghost" disabled={!!busy} onClick={() => act(invite, "cancel")}>
                        {busy === `cancel:${invite.id}` ? "Cancelling…" : "Cancel"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
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
                <Button className="primary" onClick={() => setOpen(false)}>
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
              </div>
              {formError && (
                <p className="modal-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="modal-actions">
                <Button variant="outline" onClick={() => setOpen(false)}>
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
    </section>
  );
}
