import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api-route";
import { consumeAccountToken } from "@/lib/account-tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseWith } from "@/lib/validation";

const LINK_GONE = "This confirm link has expired or was already used. Sign in to KOVA to send a new one.";

/**
 * Confirms an email from its link: the address the link was sent to
 * becomes the account's email. Public, since it may be opened on a phone
 * that isn't signed in; the token is the proof.
 */
export async function POST(request: Request) {
  const body = parseWith(z.object({ token: z.string().min(1) }), await readJson(request));
  if (!body) return NextResponse.json({ message: LINK_GONE }, { status: 410 });

  const admin = createSupabaseAdminClient();
  const link = await consumeAccountToken(admin, body.token, "confirm_email");
  if (!link) return NextResponse.json({ message: LINK_GONE }, { status: 410 });

  const { data: row } = await admin.from("account_emails").select("pending_email").eq("account_id", link.accountId).maybeSingle();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("account_emails")
    .update({
      email: link.email,
      // A newer pending email, sent after this link, keeps waiting.
      pending_email: row?.pending_email === link.email ? null : row?.pending_email,
      confirmed_at: now,
      updated_at: now,
    })
    .eq("account_id", link.accountId);
  if (error) {
    const taken = error.code === "23505";
    if (!taken) console.error("[api/auth/confirm-email] update failed:", error);
    return NextResponse.json(
      { message: taken ? "That email is already used by another KOVA account." : "Could not confirm the email." },
      { status: taken ? 409 : 422 },
    );
  }
  return NextResponse.json({ email: link.email });
}
