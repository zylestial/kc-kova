import { expect, test, type Locator, type Page } from "@playwright/test";
import { pageFor } from "./helpers";

type Leg = { plannedTimeOut: string; plannedTimeIn: string };
type Schedule = { id: string; kind: string; status: string; revisions: { plate: string; requestIds: string[]; legs: Leg[] }[] };
type Stop = { id: string; date: string; group?: { number: number; form: string } };

const pick = async (scope: Page | Locator, page: Page, label: string | RegExp, option: string | RegExp) => {
  await scope.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
};
/** Waits on a save, which the dev server can take a while over on its first run. */
const saved = { timeout: 30_000 };
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const hhmm = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/**
 * A start time today, 06:00 to 22:20 on a 40-minute grid, when the Mirage
 * has no Company trip in the 35 minutes after it. Earlier local runs leave
 * trips behind, and a vehicle's Company trips can't overlap.
 */
async function freeStart(page: Page, today: string) {
  const { schedules } = (await (await page.request.get("/api/bootstrap")).json()) as { schedules: (Schedule & { date: string })[] };
  const busy = schedules
    .filter((s) => s.kind === "COMPANY" && s.status === "ACTIVE" && s.date === today)
    .flatMap((s) => s.revisions.filter((r) => r.plate === "NBC-4821" && r.legs.length))
    .map((r) => [minutes(r.legs[0].plannedTimeOut), minutes(r.legs.at(-1)!.plannedTimeIn)]);
  for (let start = 6 * 60; start + 35 <= 23 * 60; start += 40) {
    if (!busy.some(([a, b]) => start < b && a < start + 35)) return start;
  }
  throw new Error("The Mirage is booked all day today; reset the local database.");
}

test("a Company trip goes from request to the printed form", async ({ browser }) => {
  // Five accounts and a dozen saves: longer than the usual 90 seconds.
  test.setTimeout(180_000);
  // My Trips starts a trip only on its day, so this one is for today.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

  // req1 (allowed Company trips, Position set) asks for two stops with the
  // Mirage and its Company car Driver.
  const requester = await pageFor(browser, "req1");
  await requester.goto("/requests/new");
  await requester.getByRole("radio", { name: /^Company Trip/ }).check();
  await requester.getByLabel("Jump to date").fill(today);
  await pick(requester, requester, "Project / Site", "UAT Project");
  await pick(requester, requester, "Destination", "UAT Destination");
  await pick(requester, requester, "Purpose", "UAT Purpose");
  await requester.getByPlaceholder("Name and number").fill("Liza 0917 555 0142");
  await requester.getByRole("button", { name: "Add another destination" }).click();
  const second = requester.locator(".request-stop").nth(1);
  await pick(second, requester, "Destination", "UAT Second Destination");
  await pick(second, requester, "Purpose", "UAT Purpose");
  await pick(requester, requester, "Starting point", "Main Office");
  await pick(requester, requester, "Department / Site", /Procurement/);
  await pick(requester, requester, "Vehicle", /Mirage/);
  await pick(requester, requester, "Driver", "Jun Reyes");
  await pick(requester, requester, "Immediate Supervisor", /Dante/);
  await pick(requester, requester, "Project Manager / Construction Manager / Dept. Head", /Ong/);
  await requester.getByRole("button", { name: "Send request" }).click();
  await requester.waitForURL((url) => url.pathname === "/requests");
  await expect(requester.locator(".notice.success")).toBeVisible(saved);

  // A Requester sees only their own requests.
  const { requests } = (await (await requester.request.get("/api/bootstrap")).json()) as { requests: Stop[] };
  const mine = requests.filter((r) => r.date === today && r.group?.form === "COMPANY");
  const number = Math.max(...mine.map((r) => r.group!.number));
  const stopIds = mine.filter((r) => r.group!.number === number).map((r) => r.id);
  expect(stopIds).toHaveLength(2);

  // sched1 plans both stops as one trip at a free time and submits it.
  const scheduler = await pageFor(browser, "sched1");
  const start = await freeStart(scheduler, today);
  await scheduler.goto("/schedules/company");
  await scheduler.locator(".cp-jump input").fill(today);
  await scheduler.locator(".cp-card").filter({ hasText: `${number}-A` }).getByRole("button", { name: "Plan" }).click();
  const times = scheduler.locator(".cp-legs input[type=time]");
  await expect(times).toHaveCount(4);
  for (const [index, time] of [start, start + 15, start + 20, start + 35].map(hhmm).entries()) {
    await times.nth(index).fill(time);
  }
  await scheduler.getByRole("button", { name: "Submit for approval" }).click();
  await expect(scheduler.locator(".notice.success")).toContainText("Trip submitted", saved);
  const { schedules } = (await (await scheduler.request.get("/api/bootstrap")).json()) as { schedules: Schedule[] };
  const trip = schedules.find((s) => s.revisions.some((r) => r.requestIds.includes(stopIds[0])))!;

  // admin1 approves it as usual.
  const admin = await pageFor(browser, "admin1");
  await admin.goto(`/schedules?open=${trip.id}`);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible(saved);

  // req1 records it on My Trips: Start trip with the odometer, the first
  // stop, End trip on reaching the second with the odometer again.
  await requester.context().grantPermissions(["geolocation"]);
  await requester.context().setGeolocation({ latitude: 16.103769, longitude: 120.436222, accuracy: 10 });
  await requester.goto(`/my-trips?open=${trip.id}`);
  const action = requester.locator(".my-trip-action button");
  await requester.getByLabel("Starting odometer (km)").fill("48215");
  await action.click();
  await expect(action).toHaveText("Arrived at UAT Destination", saved);
  await action.click();
  await expect(action).toHaveText("Leaving UAT Destination", saved);
  await action.click();
  await expect(action).toHaveText("Arrived at UAT Second Destination · End trip", saved);
  await requester.getByLabel("Ending odometer (km)").fill("48000");
  await action.click();
  await expect(requester.locator(".modal-error")).toContainText("can't be lower than the start (48215 km)");
  await requester.getByLabel("Ending odometer (km)").fill("48262");
  await action.click();
  await expect(requester.getByText("Trip ended and submitted.")).toBeVisible(saved);

  // admin1 finds it under Company Trips in Finished Trips, prints the
  // Company Trip Form, and marks it done: every time is filled from the taps.
  await admin.goto("/finished");
  await pick(admin, admin, "Form filter", "Company Trips");
  await expect(admin.locator("tbody tr").filter({ hasText: "NBC-4821" }).first()).toBeVisible();
  await admin.goto(`/finished?open=${trip.id}`);
  const review = admin.getByRole("dialog");
  await expect(review.getByText(/48215 → 48262 \(47 km\)/)).toBeVisible();
  await admin.emulateMedia({ media: "print" });
  const form = admin.locator(".company-print");
  await expect(form).toContainText("COMPANY TRIP FORM");
  await expect(form).toContainText("Purchasing Officer");
  await expect(form).toContainText("47 km");
  await expect(form).toContainText("UAT Second Destination");
  await admin.emulateMedia({ media: "screen" });
  await review.getByRole("button", { name: "Mark as done" }).click();
  await review.getByRole("button", { name: "Mark as done" }).click();
  await expect(admin.getByText(/marked as done\./)).toBeVisible(saved);
});
