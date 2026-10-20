"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forgotPassword } from "@/lib/kova-api";
import KovaBrand from "../../kova-brand";

/** Asks for a reset link by username or email; it arrives by email. */
export default function ForgotForm() {
  const [login, setLogin] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      setSent((await forgotPassword(login.trim())).message);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="sign-shell">
      <form className="sign-card" onSubmit={submit}>
        <KovaBrand signIn />
        <h1>
          Forgot password<span className="title-dot">.</span>
        </h1>
        {sent ? (
          <p className="helper" role="status">
            {sent}
          </p>
        ) : (
          <>
            <div className="sign-fields">
              <label className="field">
                <span>Username or email</span>
                <Input required value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" />
                <small>We&apos;ll email you a link to choose a new password.</small>
              </label>
            </div>
            <Button className="primary sign-submit" type="submit" disabled={sending}>
              {sending ? "Sending…" : "Email me a link"}
            </Button>
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <p className="helper">
          <a href="/sign-in">Back to Sign In</a>
        </p>
      </form>
    </div>
  );
}
