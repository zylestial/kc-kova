"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/kova-api";
import KovaBrand from "../../kova-brand";

export default function SignInForm({ passwordReset = false }: { passwordReset?: boolean }) {
  const router = useRouter();
  const [signingIn, setSigningIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    setError("");
    try {
      await signIn(username.trim(), password);
      router.push("/home");
    } catch (caught) {
      setError((caught as Error).message);
      setSigningIn(false);
    }
  }
  return (
    <div className="sign-shell">
      <form className="sign-card" onSubmit={submit}>
        <KovaBrand signIn />
        <h1>
          Sign In<span className="title-dot">.</span>
        </h1>
        {passwordReset && (
          <p role="status">Password changed. Sign in with your new password.</p>
        )}
        <div className="sign-fields">
          <label className="field">
            <span>Username or email</span>
            <Input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <Input
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
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
        <Button className="primary sign-submit" type="submit" disabled={signingIn}>
          {signingIn ? "Signing in…" : "Sign In"}
        </Button>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <p className="helper">
          <a href="/forgot-password">Forgot password?</a>
        </p>
        <p className="helper">Need an account? Ask an Admin to invite you.</p>
      </form>
    </div>
  );
}
