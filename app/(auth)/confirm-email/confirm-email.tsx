"use client";
import { useEffect, useRef, useState } from "react";
import { confirmEmailLink } from "@/lib/kova-api";
import KovaBrand from "../../kova-brand";

/** Where a confirm email's link lands: confirms it straight away and says so. */
export default function ConfirmEmail({ token }: { token: string }) {
  const [confirmed, setConfirmed] = useState("");
  const [error, setError] = useState(token ? "" : "This link is missing its code. Open the link from your email again.");
  // Strict Mode runs effects twice in development; the link works only once.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    confirmEmailLink(token)
      .then((result) => setConfirmed(result.email))
      .catch((caught) => setError((caught as Error).message));
  }, [token]);

  return (
    <div className="sign-shell">
      <div className="sign-card">
        <KovaBrand signIn />
        <h1>
          Confirm email<span className="title-dot">.</span>
        </h1>
        {error ? (
          <p className="modal-error" role="alert">
            {error}
          </p>
        ) : confirmed ? (
          <p role="status">
            <b>{confirmed}</b> is confirmed. You can use it to reset your password.
          </p>
        ) : (
          <p className="helper" role="status">
            Confirming…
          </p>
        )}
        <p className="helper">
          <a href="/home">Continue to KOVA</a>
        </p>
      </div>
    </div>
  );
}
