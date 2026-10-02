import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/lib/kova-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";

type Context<P> = {
  request: Request;
  /** Cookie-scoped client: Row Level Security applies as the signed-in account. */
  supabase: SupabaseClient;
  /** The signed-in, Active account. */
  account: Account;
  /** The route's dynamic segments, already resolved. */
  params: P;
};

/**
 * Wraps a route handler that needs a signed-in account: builds the
 * session-scoped Supabase client, resolves the account (answering 401
 * when there isn't an Active one) and resolves the route params, so the
 * handler starts with the work itself.
 *
 *   export const POST = authed<{ scheduleId: string }>(async ({ supabase, params }) => { ... });
 */
export function authed<P = Record<string, never>>(handler: (context: Context<P>) => Promise<Response>) {
  return async (request: Request, { params }: { params: Promise<P> }): Promise<Response> => {
    const supabase = await createSupabaseServerClient();
    const account = await requireAccount(supabase);
    if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    return handler({ request, supabase, account, params: await params });
  };
}

/** A request body as parsed JSON, or null when it isn't valid JSON. */
export const readJson = (request: Request): Promise<unknown> => request.json().catch(() => null);

/** A 422 with a message the screens show as is. */
export const unprocessable = (message: string) => NextResponse.json({ message }, { status: 422 });
