"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Redirects to /home if the current account/viewRole isn't allowed on this
// route, mirroring the inline role guards the old single-screen app used to
// check before rendering a screen.
export function RequireRole({ allow, children }: { allow: boolean; children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!allow) router.replace("/home");
  }, [allow, router]);
  if (!allow) return null;
  return <>{children}</>;
}
