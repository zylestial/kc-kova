import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";

// What the browser needs to hear about new notifications from Realtime: this
// account's own short-lived token, so the row policy (0035) applies to it.
export const GET = authed(async ({ supabase, account }) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  return NextResponse.json(
    {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      token: session.access_token,
      expiresAt: session.expires_at,
      accountId: account.id,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
