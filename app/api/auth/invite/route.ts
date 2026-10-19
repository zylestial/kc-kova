import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { INVITE_LINK_GONE, openInviteForToken } from "@/lib/invites";

/**
 * What an invite link is for, so the Join page can show it before the
 * person sets up their account. Public: the link's token is the proof.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const invite = token ? await openInviteForToken(createSupabaseAdminClient(), token) : null;
  if (!invite) return NextResponse.json({ message: INVITE_LINK_GONE }, { status: 410 });
  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    // Company trips print the requester's Position, so it's required then (0051).
    needsPosition: invite.can_request_company,
  });
}
