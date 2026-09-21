import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";
import { clearLoginAttempts, isLoginRateLimited, recordFailedLogin } from "@/lib/supabase/login-rate-limit";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ message: "Username and password are required." }, { status: 422 });
  }

  if (await isLoginRateLimited(username)) {
    return NextResponse.json({ message: "Too many sign-in attempts. Try again later." }, { status: 429 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: usernameToAuthEmail(username),
    password,
  });
  if (authError || !authData.user) {
    await recordFailedLogin(username);
    return NextResponse.json({ message: "Invalid username or password." }, { status: 401 });
  }

  const { data: accountRow } = await supabase.from("accounts").select("*").eq("id", authData.user.id).maybeSingle();
  if (!accountRow || accountRow.status !== "Active") {
    await supabase.auth.signOut();
    await recordFailedLogin(username);
    const message = accountRow ? "This account is inactive." : "Invalid username or password.";
    return NextResponse.json({ message }, { status: accountRow ? 403 : 401 });
  }

  await clearLoginAttempts(username);
  return NextResponse.json({ account: toAccount(accountRow) });
}
