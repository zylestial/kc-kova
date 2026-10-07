import type { NextConfig } from "next";

// No page in this app reads cookies()/headers() to force dynamic rendering,
// and there are no third-party scripts, so a static (non-nonce) CSP is used
// rather than the proxy-based nonce approach — it avoids opting every route
// into per-request dynamic rendering just for a CSP header. 'unsafe-inline'
// is required for script-src (Next's hydration payload script) and
// style-src (React inline `style={{...}}` usage in app/components); every
// other directive is locked to 'self'/'none'. All app data access goes
// through this app's own /api/* routes (no direct browser calls to
// Supabase), so connect-src 'self' is sufficient.
const isDev = process.env.NODE_ENV === "development";
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // geolocation=(self): Start/End trip read the Driver's position (lib/phone-location.ts).
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Content-Security-Policy", value: cspHeader },
];

const nextConfig: NextConfig = {
  // Turbopack's on-disk cache (on by default since 16.3) served a stale
  // app/globals.css: the 2026-10-05 production deploy shipped new markup
  // with the old stylesheet, and `next dev` kept the old CSS across
  // restarts. Builds start cold until that's fixed upstream.
  experimental: {
    turbopackFileSystemCacheForBuild: false,
    turbopackFileSystemCacheForDev: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
