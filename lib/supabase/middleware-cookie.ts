import type { NextRequest } from "next/server";

// A lightweight presence check only -- not a validity check. The
// authoritative session/role check stays in app/api/auth/session/route.ts
// (getUser() + the accounts row + status === "Active"), which the (app)
// layout calls on every load. This just keeps obviously signed-out traffic
// off protected pages before they render.
export function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name) && cookie.value.length > 0);
}
