import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseSessionCookie } from "@/lib/supabase/middleware-cookie";

export function proxy(request: NextRequest) {
  const isSignInRoute = request.nextUrl.pathname.startsWith("/sign-in");
  const authed = hasSupabaseSessionCookie(request);
  if (!authed && !isSignInRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }
  if (authed && isSignInRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.svg).*)"],
};
