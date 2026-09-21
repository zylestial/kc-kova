import type { NextConfig } from "next";

// Content-Security-Policy is deliberately not set here yet: getting the
// script-src right for Next's own inline bootstrap scripts needs to be
// verified against a running build before it ships, or it risks silently
// breaking the app. See docs/TASKS.md.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
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
