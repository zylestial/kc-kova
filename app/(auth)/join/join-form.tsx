"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptInvite, lookUpInvite, type Role } from "@/lib/kova-api";
import { PASSWORD_HINT, passwordError } from "@/lib/password-policy";
import { USERNAME_HINT, usernameError } from "@/lib/username-policy";
import KovaBrand from "../../kova-brand";

type Invite = { email: string; role: Role; needsPosition: boolean };

/**
 * Where an invite link lands: the person picks their own name, username,
 * position and password. The role and request permissions were chosen by
 * the Admin who invited them and only show here.
 */
export default function JoinForm({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [linkError, setLinkError] = useState(token ? "" : "This link is missing its code. Open the link from your invite email again.");
  const [form, setForm] = useState({ name: "", username: "", position: "", password: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    lookUpInvite(token)
      .then(setInvite)
      .catch((caught) => setLinkError((caught as Error).message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const username = form.username.trim();
    const problem =
      (!form.name.trim() && "Enter your name.") ||
      usernameError(username) ||
      (invite?.needsPosition && !form.position.trim() && "Add your position; it prints on the Company Trip Form.") ||
      (form.password !== form.confirm && "Passwords do not match.") ||
      passwordError(form.password, username);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const account = await acceptInvite({ token, name: form.name.trim(), username, position: form.position.trim(), password: form.password });
      router.push(account ? "/home" : "/sign-in");
    } catch (caught) {
      setError((caught as Error).message);
      setSaving(false);
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <div className="sign-shell">
      <form className="sign-card" onSubmit={submit}>
        <KovaBrand signIn />
        <h1>
          Set up your account<span className="title-dot">.</span>
        </h1>
        {linkError ? (
          <>
            <p className="modal-error" role="alert">
              {linkError}
            </p>
            <p className="helper">
              <a href="/sign-in">Go to Sign In</a>
            </p>
          </>
        ) : !invite ? (
          <p className="helper" role="status">
            Checking your invite…
          </p>
        ) : (
          <>
            <p className="helper">
              You&apos;re joining as a <b>{invite.role}</b> with <b>{invite.email}</b>.
            </p>
            <div className="sign-fields">
              <label className="field">
                <span>Your name</span>
                <Input required maxLength={100} autoComplete="name" {...field("name")} />
              </label>
              <label className="field">
                <span>Username</span>
                <Input required maxLength={30} autoComplete="username" autoCapitalize="none" {...field("username")} />
                <small>You&apos;ll sign in with this. {USERNAME_HINT}</small>
              </label>
              <label className="field">
                <span>Position{invite.needsPosition ? "" : " (optional)"}</span>
                <Input required={invite.needsPosition} maxLength={100} autoComplete="organization-title" {...field("position")} />
                <small>Your job title, e.g. Site Engineer.</small>
              </label>
              <label className="field">
                <span>Password</span>
                <Input required type={showPassword ? "text" : "password"} maxLength={256} autoComplete="new-password" {...field("password")} />
                <small>{PASSWORD_HINT}</small>
              </label>
              <label className="field">
                <span>Confirm password</span>
                <Input required type={showPassword ? "text" : "password"} maxLength={256} autoComplete="new-password" {...field("confirm")} />
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
              {saving ? "Setting up…" : "Set up my account"}
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
