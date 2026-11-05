import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { signInAndWaitForHome } from "./helpers";

// The bell hears about new notifications from Realtime (0089), and one account
// never hears another's, whichever filter its browser asks for.

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function notify(accountId: string, message: string) {
  const { error } = await admin.from("notifications").insert({ account_id: accountId, type: "TRIP_PUBLISHED", message });
  expect(error).toBeNull();
}

async function accountIdOf(username: string) {
  const { data, error } = await admin.from("accounts").select("id").eq("username", username).single();
  expect(error).toBeNull();
  return data!.id as string;
}

test("a new notification reaches the open bell straight away", async ({ page }) => {
  const message = `Live bell test ${Date.now()}`;
  await signInAndWaitForHome(page, "sched1");
  await page.keyboard.press("Escape");
  const connected = page.waitForResponse((response) => response.url().endsWith("/api/notifications/live"));
  await page.reload();
  await connected;
  // Give the socket time to join, then send: the regular check is 5 minutes away.
  await page.waitForTimeout(4000);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Notifications" }).click();

  await notify(await accountIdOf("sched1"), message);

  await expect(page.getByText(message)).toBeVisible({ timeout: 10_000 });
});

test("an account hears its own notifications and nobody else's", async ({ page }) => {
  await signInAndWaitForHome(page, "driver1");
  const access = await (await page.request.get("/api/notifications/live")).json();
  const otherId = await accountIdOf("sched1");
  expect(access.accountId).not.toBe(otherId);

  const listener = createClient(access.url, access.key, { auth: { persistSession: false } });
  await listener.realtime.setAuth(access.token);
  const heard: string[] = [];
  const onInsert = (payload: { new: { message: string } }) => {
    heard.push(payload.new.message);
  };
  const subscribed = new Promise<void>((resolve) => {
    listener
      .channel("snooping")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `account_id=eq.${otherId}` }, onInsert)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, onInsert)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
  });
  await subscribed;
  await page.waitForTimeout(2000);

  const secret = `For someone else ${Date.now()}`;
  const own = `For me ${Date.now()}`;
  await notify(otherId, secret);
  await notify(access.accountId, own);

  await expect.poll(() => heard, { timeout: 10_000 }).toContain(own);
  await page.waitForTimeout(2000);
  expect(heard).not.toContain(secret);

  await listener.removeAllChannels();
  listener.realtime.disconnect();
});
