"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMyEmail, setMyEmail, type EmailStatus } from "@/lib/kova-api";
import KovaBrand from "../kova-brand";

/**
 * Shown after sign-in instead of KOVA until the account has a confirmed
 * email (0072): add one, open the link KOVA emails to it, carry on. Only
 * Sign out works meanwhile.
 */
export default function EmailStep({
  status,
  onChange,
  onSignOut,
}: {
  status: EmailStatus;
  onChange: (status: EmailStatus) => void;
  onSignOut: () => void;
}) {
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(!status.pendingEmail);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run(action: string, work: () => Promise<EmailStatus>, done?: string) {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const next = await work();
      onChange(next);
      if (next.pendingEmail) setEditing(false);
      if (done) setMessage(done);
      return next;
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function checkConfirmed() {
    const next = await run("check", getMyEmail);
    if (next && !next.email) setMessage("Not confirmed yet. Open the link in the email, then try again.");
  }

  return (
    <div className="sign-shell">
      <form
        className="sign-card"
        onSubmit={(e) => {
          e.preventDefault();
          void run("send", () => setMyEmail(email.trim()));
        }}
      >
        <KovaBrand signIn />
        <h1>
          Add your email<span className="title-dot">.</span>
        </h1>
        <p className="helper">KOVA needs your email so you can reset your password yourself if you forget it.</p>
        {editing ? (
          <>
            <div className="sign-fields">
              <label className="field">
                <span>Email</span>
                <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                <small>We&apos;ll email you a link to confirm it.</small>
              </label>
            </div>
            <Button className="primary sign-submit" type="submit" disabled={!!busy}>
              {busy === "send" ? "Sending…" : "Send link"}
            </Button>
            {status.pendingEmail && (
              <Button type="button" variant="ghost" className="sign-submit" onClick={() => setEditing(false)}>
                Go back
              </Button>
            )}
          </>
        ) : (
          <>
            <p role="status">
              We sent a link to <b>{status.pendingEmail}</b>. Open it to confirm your email, then come back here. Check your
              spam folder if you don&apos;t see it.
            </p>
            <div className="sign-fields">
              <Button type="button" className="primary sign-submit" disabled={!!busy} onClick={checkConfirmed}>
                {busy === "check" ? "Checking…" : "I've confirmed it"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!!busy}
                onClick={() => void run("resend", () => setMyEmail(status.pendingEmail!), "Sent again.")}
              >
                {busy === "resend" ? "Sending…" : "Send the link again"}
              </Button>
              <Button type="button" variant="ghost" disabled={!!busy} onClick={() => setEditing(true)}>
                Use a different email
              </Button>
            </div>
          </>
        )}
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <p className="helper">
          <Button type="button" variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
        </p>
      </form>
    </div>
  );
}
