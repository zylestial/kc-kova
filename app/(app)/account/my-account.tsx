"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeMyPassword, changeMyUsername, getMyEmail, setMyEmail, type EmailStatus } from "@/lib/kova-api";
import { PASSWORD_HINT, passwordError } from "@/lib/password-policy";
import { USERNAME_HINT, usernameError } from "@/lib/username-policy";
import { useAccount } from "../providers";

type Section = "username" | "email" | "password";

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Input
        value={value}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize="none"
        maxLength={type === "password" ? 256 : 254}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/**
 * My account (every role): change your own username, email and password,
 * each with your current password. Name, role and permissions stay with
 * an Admin (0072).
 */
export default function MyAccount() {
  const { account } = useAccount();
  const [username, setUsername] = useState(account.username);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [form, setForm] = useState({ username: "", email: "", current: "", next: "", confirm: "" });
  const [open, setOpen] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    getMyEmail()
      .then(setEmail)
      .catch((caught) => setError((caught as Error).message));
  }, []);

  function start(section: Section) {
    setForm({ username: "", email: "", current: "", next: "", confirm: "" });
    setError("");
    setNotice("");
    setOpen(section);
  }

  async function save(section: Section) {
    const problem =
      section === "username"
        ? usernameError(form.username.trim())
        : section === "email"
          ? !form.email.trim() && "Enter your new email."
          : (form.next !== form.confirm && "New passwords do not match.") || passwordError(form.next, username);
    if (problem || !form.current) {
      setError(problem || "Enter your current password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (section === "username") {
        const saved = await changeMyUsername(form.username.trim(), form.current);
        setUsername(saved.username);
        setNotice(`Username changed. Sign in with ${saved.username} from now on.`);
      } else if (section === "email") {
        setEmail(await setMyEmail(form.email.trim(), form.current));
        setNotice(`We sent a link to ${form.email.trim()}. Your email changes when you open it.`);
      } else {
        await changeMyPassword(form.current, form.next);
        setNotice("Password changed.");
      }
      setOpen(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = (
    <Field
      label="Current password"
      type="password"
      autoComplete="current-password"
      value={form.current}
      onChange={(v) => setForm({ ...form, current: v })}
    />
  );
  const actions = (section: Section, label: string) => (
    <>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button variant="outline" onClick={() => setOpen(null)}>
          Go back
        </Button>
        <Button className="primary" disabled={busy} onClick={() => save(section)}>
          {busy ? "Saving…" : label}
        </Button>
      </div>
    </>
  );

  return (
    <section className="settings-shell my-account">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{account.role.toUpperCase()}</div>
          <h1>
            My account<span className="title-dot">.</span>
          </h1>
          <p>Change how you sign in. Your name, account type and permissions are set by an Admin.</p>
        </div>
      </div>
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {!open && error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}

      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <h2>Username</h2>
            <p>
              You sign in as <b>{username}</b>.
            </p>
          </div>
          {open !== "username" && (
            <Button variant="outline" onClick={() => start("username")}>
              Change
            </Button>
          )}
        </div>
        {open === "username" && (
          <div className="modal-fields">
            <Field
              label="New username"
              autoComplete="username"
              hint={USERNAME_HINT}
              value={form.username}
              onChange={(v) => setForm({ ...form, username: v })}
            />
            {current}
            {actions("username", "Change username")}
          </div>
        )}
      </section>

      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <h2>Email</h2>
            <p>
              {email?.email ? <b>{email.email}</b> : "No confirmed email yet."} Used to reset your password if you forget it.
            </p>
            {email?.pendingEmail && (
              <p>
                <span className="badge">Not confirmed</span> {email.pendingEmail}: open the link we emailed to it.
              </p>
            )}
          </div>
          {open !== "email" && (
            <Button variant="outline" onClick={() => start("email")}>
              Change
            </Button>
          )}
        </div>
        {open === "email" && (
          <div className="modal-fields">
            <Field
              label="New email"
              type="email"
              autoComplete="email"
              hint="We'll email it a link; your email changes when you open it."
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            {current}
            {actions("email", "Send link")}
          </div>
        )}
      </section>

      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <h2>Password</h2>
          </div>
          {open !== "password" && (
            <Button variant="outline" onClick={() => start("password")}>
              Change
            </Button>
          )}
        </div>
        {open === "password" && (
          <div className="modal-fields">
            {current}
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              hint={PASSWORD_HINT}
              value={form.next}
              onChange={(v) => setForm({ ...form, next: v })}
            />
            <Field
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(v) => setForm({ ...form, confirm: v })}
            />
            {actions("password", "Change password")}
          </div>
        )}
      </section>
    </section>
  );
}
