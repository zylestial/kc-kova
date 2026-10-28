import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseSessionCookie } from "@/lib/supabase/middleware-cookie";

// Pages opened from an emailed link, which work signed in or not.
// The privacy notice is public too: Google's consent screen links to it.
const LINK_PAGES = ["/join", "/forgot-password", "/reset-password", "/confirm-email", "/privacy"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isSignInRoute = pathname.startsWith("/sign-in");
  const isLinkPage = LINK_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
  const authed = hasSupabaseSessionCookie(request);
  if (!authed && !isSignInRoute && !isLinkPage) {
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
  // The manifest, service worker and app icons load before sign-in.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.svg|images/|manifest.webmanifest|sw.js|icon-|apple-touch-icon.png|notification-badge.png).*)",
  ],
};
