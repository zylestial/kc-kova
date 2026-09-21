import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toAccount } from "@/lib/supabase/accounts";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ account: null });

  const { data: accountRow } = await supabase.from("accounts").select("*").eq("id", user.id).maybeSingle();
  if (!accountRow || accountRow.status !== "Active") {
    await supabase.auth.signOut();
    return NextResponse.json({ account: null });
  }

  return NextResponse.json({ account: toAccount(accountRow) });
}
