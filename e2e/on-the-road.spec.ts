import { execSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInAndWaitForHome } from "./helpers";

// Several people on one trip at once (0060, 0061): driver4 drives today's
// demo trip on UAT-004 (scripts/seed-live-trip-demo.mjs --fresh) while
// sched1 changes it and admin1 approves, then the Driver reports problems
// at stops. Each person has their own browser session, and their actions
// run side by side where they would in real life.

const saved = { timeout: 30_000 };
const PLATE = "UAT-004";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

type Leg = {
  id: string;
  destinationId?: string;
  destinationName: string;
  plannedTimeOut: string;
  plannedTimeIn: string;
  contactName: string;
  contactNumber: string;
  isFinal: boolean;
  stops: string[];
};
type Revision = { id: string; status: string; rowVersion: number; plate: string; requestIds: string[]; legs: Leg[] };
type Schedule = { id: string; date: string; status: string; publishedRevisionId?: string; revisions: Revision[] };
type Notification = { type: string; message: string; relatedScheduleId?: string };

/** A session signed in as `username`; the Driver's phone shares a position near ANONANG. */
async function personFor(browser: Browser, username: string) {
  const context = await browser.newContext({
    geolocation: { latitude: 16.1038, longitude: 120.4362, accuracy: 5 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  await signInAndWaitForHome(page, username);
  return page;
}

const bootstrap = async (page: Page) => (await page.request.get("/api/bootstrap")).json();

async function todaysTrip(page: Page) {
  const { schedules } = (await bootstrap(page)) as { schedules: Schedule[] };
  const trip = schedules.find(
    (s) => s.date === today && s.status === "ACTIVE" && s.revisions.some((r) => r.id === s.publishedRevisionId && r.plate === PLATE),
  );
  expect(trip, `no approved ${PLATE} trip today`).toBeTruthy();
  return trip!;
}
const published = (trip: Schedule) => trip.revisions.find((r) => r.id === trip.publishedRevisionId)!;

async function notificationsOf(page: Page, type: string, scheduleId: string) {
  const { notifications } = (await bootstrap(page)) as { notifications: Notification[] };
  return notifications.filter((n) => n.type === type && n.relatedScheduleId === scheduleId);
}

/** The Driver's trip dialog, opened fresh so it shows the latest route. */
async function openTrip(driver: Page, scheduleId: string) {
  await driver.goto(`/my-schedule?open=${scheduleId}`);
  await expect(driver.locator(".trip-steps")).toBeVisible(saved);
  return driver.locator(".trip-steps");
}

/** Taps the one big button, which should read `label`. */
async function tapNext(driver: Page, label: RegExp) {
  const button = driver.locator(".trip-step-button");
  await expect(button).toHaveText(label, saved);
  await button.click();
  await expect(button).not.toHaveText(label, saved);
}

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test.beforeAll(() => {
  execSync("node scripts/seed-live-trip-demo.mjs --fresh", { stdio: "inherit" });
});

test("several people on a trip that's on the road", async ({ browser }) => {
  // Everyone signs in at once.
  const [driver, scheduler, admin] = await Promise.all([
    personFor(browser, "driver4"),
    personFor(browser, "sched1"),
    personFor(browser, "admin1"),
  ]);
  const trip = await todaysTrip(admin);

  // The Driver sets off while the Scheduler opens today's Scheduling page.
  await Promise.all([
    (async () => {
      await openTrip(driver, trip.id);
      await tapNext(driver, /^Start trip$/);
      await tapNext(driver, /^Arrived at Site Alpha$/);
      await tapNext(driver, /^Leaving Site Alpha$/);
    })(),
    scheduler.goto(`/scheduling?date=${today}&type=DAILY`),
  ]);

  // The Scheduler fits the waiting Urgent Site Gamma stop into the trip on the road.
  await scheduler.reload();
  await scheduler.locator(".sc-panel .sc-stop", { hasText: "Site Gamma" }).first().click();
  const option = scheduler.locator(".sc-option", { hasText: "Nissan Urvan (UAT)" });
  await expect(option).toContainText("goes into draft changes", saved);
  await option.getByRole("button", { name: "Add" }).click();
  await expect(scheduler.locator(".notice.success")).toContainText("Added to Nissan Urvan (UAT)", saved);
  const card = scheduler.locator(`.sc-vehicle[data-plate="${PLATE}"]`);
  await expect(card.locator(".sc-leg").first()).toContainText("DONE", saved);
  await card.getByRole("button", { name: "Resubmit for approval" }).click();
  await expect(scheduler.locator(".notice.success")).toContainText("Resubmitted", saved);

  // Until the Admin approves, the Driver's route hasn't changed.
  expect(await notificationsOf(driver, "TRIP_CHANGED", trip.id)).toHaveLength(0);
  const before = await openTrip(driver, trip.id);
  await expect(before).not.toContainText("Site Gamma");

  // The Admin approves; the Driver gets the new route with Site Alpha's taps kept.
  await admin.goto(`/schedules?open=${trip.id}`);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible(saved);
  expect(await notificationsOf(driver, "TRIP_CHANGED", trip.id)).toHaveLength(1);
  const after = await openTrip(driver, trip.id);
  await expect(driver.getByText(/Route changed by the Scheduler/)).toBeVisible();
  await expect(after).toContainText("Site Gamma");
  await expect(after.locator(".trip-card", { hasText: "Site Alpha" }).locator(".trip-step.done")).toHaveCount(2);

  // At the next stop nobody is there: the Driver reports it, with no note, and moves on.
  const current = after.locator(".trip-card.current");
  const missedPlace = (await current.locator("h3").textContent())!.trim();
  await current.getByRole("button", { name: /Problem here\?/ }).click();
  await driver.getByRole("button", { name: /^Not available/ }).click();
  await driver.getByRole("button", { name: "Send report" }).click();
  await expect(driver.locator(".notice.success")).toContainText(`${missedPlace} is missed`, saved);
  await expect(after.locator(".trip-card", { hasText: missedPlace }).locator(".trip-step.missed")).toContainText("Missed: Not available");
  await expect(after.locator(".trip-card.current h3")).not.toHaveText(missedPlace);

  // The Scheduler and the Admin both hear about it, at the same time.
  const [toScheduler, toAdmin] = await Promise.all([
    notificationsOf(scheduler, "STOP_REPORTED", trip.id),
    notificationsOf(admin, "STOP_REPORTED", trip.id),
  ]);
  expect(toScheduler.map((n) => n.message).join()).toContain(`Not available at ${missedPlace}`);
  expect(toAdmin).toHaveLength(toScheduler.length);

  // The Scheduler moves the missed stop to tomorrow (0065): it's off the trip, and waits there tagged Missed.
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextDay = tomorrow.toISOString().slice(0, 10);
  await scheduler.goto(`/scheduling?date=${today}&type=DAILY`);
  const banner = scheduler.locator(".sc-banner", { hasText: `at ${missedPlace}` });
  await banner.getByRole("button", { name: "Another day" }).click();
  await banner.getByLabel("Move to").fill(nextDay);
  await banner.getByRole("button", { name: "Move", exact: true }).click();
  await expect(scheduler.locator(".notice.success")).toContainText(`${missedPlace} moved to`, saved);
  await expect(scheduler.locator(".date-card.selected")).toBeVisible();
  expect(new URL(scheduler.url()).searchParams.get("date")).toBe(nextDay);
  await scheduler.keyboard.press("Escape");
  await expect(scheduler.locator(".sc-stop", { hasText: missedPlace }).locator(".sc-tag", { hasText: "Missed" })).toBeVisible();
  expect(published(await todaysTrip(scheduler)).legs.find((leg) => leg.destinationName === missedPlace)?.stops ?? []).toHaveLength(0);

  // A flat tire pauses the trip; no taps until Resume trip.
  await after.locator(".trip-card.current").getByRole("button", { name: /Problem here\?/ }).click();
  await driver.getByRole("button", { name: /^Vehicle problem/ }).click();
  await driver.getByRole("button", { name: "Send report" }).click();
  await expect(driver.getByText(/Trip paused for a vehicle problem/)).toBeVisible(saved);
  await driver.getByRole("button", { name: "Resume trip" }).click();
  await expect(driver.locator(".trip-step-button")).toHaveText(/^Arrived at /, saved);

  // A race: the Scheduler proposes a later time for the Driver's next stop,
  // and before the Admin approves it, the Driver arrives there.
  const live = published(await todaysTrip(scheduler));
  const nextPlace = (await after.locator(".trip-card.current h3").textContent())!.trim();
  const target = live.legs.findIndex((leg) => leg.destinationName === nextPlace);
  const input = {
    date: today,
    plate: PLATE,
    requestIds: live.requestIds,
    legs: live.legs.map((leg, index) => ({
      id: leg.id,
      destinationId: leg.isFinal ? undefined : leg.destinationId,
      plannedTimeOut: leg.plannedTimeOut,
      plannedTimeIn: index === target ? `${leg.plannedTimeIn.slice(0, 3)}${leg.plannedTimeIn.slice(3) === "55" ? "50" : "55"}` : leg.plannedTimeIn,
      contactName: leg.contactName,
      contactNumber: leg.contactNumber,
      stops: leg.stops,
      isFinal: leg.isFinal,
    })),
  };
  const draft = await scheduler.request.put(`/api/schedules/${trip.id}`, { data: { ...input, rowVersion: null } });
  expect(draft.ok(), await draft.text()).toBeTruthy();
  const open = ((await draft.json()) as Schedule).revisions.find((r) => r.status === "DRAFT")!;
  const submitted = await scheduler.request.post(`/api/schedules/${trip.id}/submit`, { data: { rowVersion: open.rowVersion } });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();

  await Promise.all([tapNext(driver, new RegExp(`^Arrived at ${nextPlace}$`)), admin.goto(`/schedules?open=${trip.id}`)]);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/already reached a stop this change moves/)).toBeVisible(saved);

  // The Driver's route is untouched by the refused change.
  const unchanged = published(await todaysTrip(admin));
  expect(unchanged.legs[target].plannedTimeIn).toBe(live.legs[target].plannedTimeIn);
});
