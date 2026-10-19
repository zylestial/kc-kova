import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api-route";
import { pushMessage } from "@/lib/push-message";
import { bearerMatches } from "@/lib/push-secret";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pushConfigured, sendToAccount } from "@/lib/supabase/push";
import { parseWith } from "@/lib/validation";

const sendBody = z.object({ notificationId: z.uuid() });

// Called by the database, not a person: a new notifications row (0070)
// posts its id here through pg_net, with PUSH_SEND_SECRET, and this sends it
// to the recipient's devices. Written without authed() since no one is
// signed in; the secret is the check.
export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.PUSH_SEND_SECRET)) {
    return NextResponse.json({ message: "Not allowed." }, { status: 401 });
  }
  if (!pushConfigured()) return NextResponse.json({ message: "Phone notifications aren't set up." }, { status: 503 });

  const body = parseWith(sendBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Which notification?" }, { status: 422 });

  const admin = createSupabaseAdminClient();
  const { data: notification, error } = await admin
    .from("notifications")
    .select("id, account_id, type, message, related_request_id, related_schedule_id")
    .eq("id", body.notificationId)
    .maybeSingle();
  if (error) return NextResponse.json({ message: "Could not load the notification." }, { status: 500 });
  if (!notification) return NextResponse.json({ message: "Notification not found." }, { status: 404 });

  const { data: account, error: accountError } = await admin
    .from("accounts")
    .select("role, status")
    .eq("id", notification.account_id)
    .maybeSingle();
  if (accountError) return NextResponse.json({ message: "Could not load the account." }, { status: 500 });
  if (!account || account.status !== "Active") return NextResponse.json({ sent: 0, removed: 0 });

  // Only some links need the schedule's day and kind (Scheduling).
  let schedule: { id: string; date: string; kind: "DAILY" | "COMPANY" } | undefined;
  if (notification.related_schedule_id) {
    const { data: row, error: scheduleError } = await admin
      .from("schedules")
      .select("id, schedule_date, kind")
      .eq("id", notification.related_schedule_id)
      .maybeSingle();
    if (scheduleError) return NextResponse.json({ message: "Could not load the schedule." }, { status: 500 });
    if (row) schedule = { id: row.id, date: row.schedule_date, kind: row.kind ?? "DAILY" };
  }

  const message = pushMessage(
    {
      id: notification.id,
      type: notification.type,
      message: notification.message,
      relatedRequestId: notification.related_request_id ?? undefined,
      relatedScheduleId: notification.related_schedule_id ?? undefined,
    },
    (id) => (schedule?.id === id ? schedule : undefined),
    account.role,
  );
  return NextResponse.json(await sendToAccount(admin, notification.account_id, message));
}
