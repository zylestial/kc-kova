import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { INVITE_LINK_GONE, openInviteForToken } from "@/lib/invites";
import { accessSummary, positionAsk } from "@/lib/invite-fields";

/**
 * What an invite link is for, so the Join page can show it and ask only
 * for what that access needs. Public: the link's token is the proof.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const invite = token ? await openInviteForToken(createSupabaseAdminClient(), token) : null;
  if (!invite) return NextResponse.json({ message: INVITE_LINK_GONE }, { status: 410 });
  const access = {
    role: invite.role,
    driverType: invite.driver_type,
    canRequestDaily: invite.can_request_daily,
    canRequestCompany: invite.can_request_company,
    canDriveCompany: invite.can_drive_company,
  };
  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    access: accessSummary(access),
    position: positionAsk(access),
  });
}
