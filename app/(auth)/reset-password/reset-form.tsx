"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookUpReset, resetPassword } from "@/lib/kova-api";
import { PASSWORD_HINT, passwordError } from "@/lib/password-policy";
import KovaBrand from "../../kova-brand";

/** Where a reset email's link lands: choose a new password, then sign in with it. */
export default function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [linkError, setLinkError] = useState(token ? "" : "This link is missing its code. Open the link from your email again.");
  const [passwords, setPasswords] = useState({ next: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    lookUpReset(token)
      .then((found) => setUsername(found.username))
      .catch((caught) => setLinkError((caught as Error).message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = (passwords.next !== passwords.confirm && "Passwords do not match.") || passwordError(passwords.next, username);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await resetPassword(token, passwords.next);
      router.push("/sign-in?reset=done");
    } catch (caught) {
      setError((caught as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="sign-shell">
      <form className="sign-card" onSubmit={submit}>
        <KovaBrand signIn />
        <h1>
          New password<span className="title-dot">.</span>
        </h1>
        {linkError ? (
          <>
            <p className="modal-error" role="alert">
              {linkError}
            </p>
            <p className="helper">
              <a href="/forgot-password">Get a new link</a>
            </p>
          </>
        ) : !username ? (
          <p className="helper" role="status">
            Checking your link…
          </p>
        ) : (
          <>
            <p className="helper">
              Choose a new password for <b>{username}</b>.
            </p>
            <div className="sign-fields">
              <label className="field">
                <span>New password</span>
                <Input
                  required
                  type={showPassword ? "text" : "password"}
                  maxLength={256}
                  autoComplete="new-password"
                  value={passwords.next}
                  onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                />
                <small>{PASSWORD_HINT}</small>
              </label>
              <label className="field">
                <span>Confirm password</span>
                <Input
                  required
                  type={showPassword ? "text" : "password"}
                  maxLength={256}
                  autoComplete="new-password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                className="show-password"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? "Hide password" : "Show password"}
              </Button>
            </div>
            <Button className="primary sign-submit" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save new password"}
            </Button>
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </form>
    </div>
  );
}
