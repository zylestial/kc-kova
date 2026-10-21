import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { signInAndWaitForHome } from "./helpers";

// Taps with no signal (0077): driver4 starts today's demo trip on UAT-004
// (scripts/seed-live-trip-demo.mjs --fresh) with the phone offline. The
// taps show as done and waiting, and once the phone is back online they
// reach KOVA with the time they were tapped, not the time they were sent.

const saved = { timeout: 30_000 };
const PLATE = "UAT-004";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

type Schedule = { id: string; date: string; status: string; publishedRevisionId?: string; revisions: { id: string; plate: string }[] };
type Bootstrap = {
  schedules: Schedule[];
  attendance: { scheduleId: string; start: { at: string } }[];
  stopTaps: { scheduleId: string; kind: string; at: string }[];
};

test.setTimeout(180_000);

test.beforeAll(() => {
  execSync("node scripts/seed-live-trip-demo.mjs --fresh", { stdio: "inherit" });
});

test("taps made offline send later with the time they were tapped", async ({ browser }) => {
  const context = await browser.newContext({
    geolocation: { latitude: 16.1038, longitude: 120.4362, accuracy: 5 },
    permissions: ["geolocation"],
  });
  const driver = await context.newPage();
  await signInAndWaitForHome(driver, "driver4");
  const bootstrap = async () => (await (await driver.request.get("/api/bootstrap")).json()) as Bootstrap;

  const trip = (await bootstrap()).schedules.find(
    (s) => s.date === today && s.status === "ACTIVE" && s.revisions.some((r) => r.id === s.publishedRevisionId && r.plate === PLATE),
  );
  expect(trip, `no approved ${PLATE} trip today`).toBeTruthy();
  await driver.goto(`/my-schedule?open=${trip!.id}`);
  const steps = driver.locator(".trip-steps");
  const button = driver.locator(".trip-step-button");
  await expect(steps).toBeVisible(saved);

  // No signal: both taps are kept on the phone and shown as done, waiting.
  await expect(button).toHaveText(/^Start trip$/, saved);
  await context.setOffline(true);
  const tappedFrom = Date.now();
  await button.click();
  await expect(button).toHaveText(/^Arrived at Site Alpha$/, saved);
  await button.click();
  await expect(button).toHaveText(/^Leaving Site Alpha$/, saved);
  const tappedUntil = Date.now();
  await expect(steps.getByText("waiting for signal")).toHaveCount(2);
  await expect(driver.getByRole("dialog").locator(".notice.info", { hasText: "2 taps are saved on this phone" })).toBeVisible();

  // Still offline a while later, so a late send would show in the times.
  await driver.waitForTimeout(5_000);
  const backOnline = Date.now();
  await context.setOffline(false);
  await expect(driver.getByRole("dialog").getByText(/taps? (is|are) saved on this phone/)).toHaveCount(0, { timeout: 45_000 });
  await expect(steps.getByText("waiting for signal")).toHaveCount(0);

  const data = await bootstrap();
  const start = Date.parse(data.attendance.find((a) => a.scheduleId === trip!.id)!.start.at);
  const arrived = Date.parse(data.stopTaps.find((t) => t.scheduleId === trip!.id && t.kind === "ARRIVE")!.at);
  for (const at of [start, arrived]) {
    expect(at).toBeGreaterThanOrEqual(tappedFrom - 1_000);
    expect(at).toBeLessThanOrEqual(tappedUntil + 1_000);
    expect(at).toBeLessThan(backOnline);
  }
  expect(arrived).toBeGreaterThanOrEqual(start);

  // Back online, the next tap goes straight through.
  await button.click();
  await expect(button).not.toHaveText(/^Leaving Site Alpha$/, saved);
  await expect(steps.getByText("waiting for signal")).toHaveCount(0);
  await context.close();
});
