import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invite, Role } from "@/lib/kova-api";
import { INVITE_TTL_MS, expiresIn, hashToken, newToken } from "@/lib/account-tokens";
import { inviteEmail } from "@/lib/email-templates";
import { appUrl, sendMail } from "@/lib/mailer";

export type InviteRow = {
  id: string;
  email: string;
  role: Role;
  driver_type: Invite["driverType"] | null;
  can_request_daily: boolean;
  can_request_company: boolean;
  can_drive_company: boolean;
  sent_at: string;
  expires_at: string;
};

export function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    driverType: row.driver_type ?? undefined,
    canRequestDaily: row.can_request_daily,
    canRequestCompany: row.can_request_company,
    canDriveCompany: row.can_drive_company,
    sentAt: row.sent_at,
    expired: new Date(row.expires_at).getTime() <= Date.now(),
  };
}

/** A fresh link for an invite: its token hash, expiry, and the URL to email. */
export function inviteLink() {
  const { raw, hash } = newToken();
  return { hash, expiresAt: expiresIn(INVITE_TTL_MS), url: appUrl(`/join?token=${encodeURIComponent(raw)}`) };
}

export async function emailInvite(email: string, role: Role, url: string) {
  await sendMail({ to: email, ...inviteEmail(url, role) });
}

/**
 * The open invite a link belongs to, or null when the link is unknown,
 * expired, accepted or cancelled. `admin` is the service-role client.
 */
export async function openInviteForToken(admin: SupabaseClient, raw: string) {
  const { data } = await admin
    .from("account_invites")
    .select("*")
    .eq("token_hash", hashToken(raw))
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return (data as InviteRow | null) ?? null;
}

export const INVITE_LINK_GONE = "This invite link has expired or was already used. Ask an Admin to send you a new one.";
