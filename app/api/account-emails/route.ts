import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";

/** Every account's email, for Settings → Accounts (Admin only; 0072's policy also limits it to Admins). */
export const GET = authed(async ({ supabase, account }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const { data, error } = await supabase.from("account_emails").select("account_id, email, pending_email");
  if (error) return NextResponse.json({ message: "Could not load the emails." }, { status: 500 });
  return NextResponse.json(
    data.map((row) => ({ accountId: row.account_id as string, email: row.email as string | null, pendingEmail: row.pending_email as string | null })),
  );
});
