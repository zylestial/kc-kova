import type { SupabaseClient } from "@supabase/supabase-js";
import { toAccount } from "@/lib/supabase/accounts";

/**
 * Resolves the signed-in Account for a request-scoped Supabase client.
 * Returns null when there is no session or the account is missing/inactive,
 * so callers can uniformly respond 401.
 */
export async function requireAccount(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: accountRow } = await supabase.from("accounts").select("*").eq("id", user.id).maybeSingle();
  if (!accountRow || accountRow.status !== "Active") return null;

  return toAccount(accountRow);
}
