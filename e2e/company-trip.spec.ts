import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { pageFor } from "./helpers";

type Leg = { plannedTimeOut: string; plannedTimeIn: string };
type Schedule = { id: string; kind: string; status: string; date: string; revisions: { plate: string; requestIds: string[]; legs: Leg[] }[] };
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
 * A start time today, from 06:00 on a 40-minute grid, with the Mirage free
 * for the three hours after it (other than the trip with `stopIds`), so
 * the trip ends before the Driver's day does at 6 PM. Earlier local runs
 * leave trips behind, and a vehicle's Company trips can't overlap.
 */
async function freeStart(page: Page, today: string, stopIds: string[]) {
  const { schedules } = (await (await page.request.get("/api/bootstrap")).json()) as { schedules: Schedule[] };
  const busy = schedules
    .filter((s) => s.kind === "COMPANY" && s.status === "ACTIVE" && s.date === today)
    .flatMap((s) => s.revisions.filter((r) => r.plate === "NBC-4821" && r.legs.length && !stopIds.some((id) => r.requestIds.includes(id))))
    .map((r) => [minutes(r.legs[0].plannedTimeOut), minutes(r.legs.at(-1)!.plannedTimeIn)]);
  for (let start = 6 * 60; start + 180 <= 18 * 60; start += 40) {
    if (!busy.some(([a, b]) => start < b + 15 && a < start + 180)) return start;
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
  const second = requester.locator(".request-stop:not(.request-start)").nth(1);
  await pick(second, requester, "Destination", "UAT Second Destination");
  await pick(second, requester, "Purpose", "UAT Purpose");
  await pick(requester, requester, "Starting point", "Main Office");
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

  // sched1 adds both stops to the Mirage on Scheduling, A then B on the
  // same trip, moves leg 1's Time Out to a free time (the rest follows) and submits.
  const scheduler = await pageFor(browser, "sched1");
  await scheduler.goto(`/scheduling?date=${today}&type=COMPANY`);
  for (const letter of ["A", "B"]) {
    const stop = scheduler.locator(".sc-panel .sc-stop").filter({ hasText: `${number}-${letter}` });
    const add = scheduler.locator(".sc-option").filter({ hasText: "Mirage" }).getByRole("button", { name: "Add" });
    // Stop B's tap can land while the list redraws after stop A was added,
    // and no options open (CI, 2026-10-22), so tap again until they do. On a
    // failure, keep what the Scheduler saw.
    try {
      await expect(async () => {
        if (!(await add.isVisible())) await stop.click();
        await expect(add).toBeEnabled({ timeout: 5_000 });
      }).toPass(saved);
    } catch (caught) {
      // Written into test-results, which CI uploads on a failure.
      const sheet = await scheduler.getByRole("dialog").allInnerTexts().catch(() => []);
      writeFileSync(test.info().outputPath(`scheduler-stop-${letter}.txt`), sheet.join("\n----\n") || "(no dialog open)");
      await scheduler.screenshot({ path: test.info().outputPath(`scheduler-stop-${letter}.png`), fullPage: true });
      throw caught;
    }
    await add.click();
    await expect(scheduler.locator(".notice.success")).toContainText("Added to", saved);
  }
  const card = scheduler.locator(".sc-vehicle").filter({ hasText: "NBC-4821" });
  // The draft's time boxes; an earlier trip's are locked.
  const times = card.locator("input[type=time]:enabled");
  const start = await freeStart(scheduler, today, stopIds);
  await times.first().fill(hhmm(start));
  await times.first().press("Enter");
  await expect(scheduler.locator(".notice.success")).toContainText("Leg 1: ", saved);
  await card.getByRole("button", { name: "Submit for approval" }).click();
  await expect(scheduler.locator(".notice.success")).toContainText("Submitted", saved);
  const { schedules } = (await (await scheduler.request.get("/api/bootstrap")).json()) as { schedules: Schedule[] };
  const trip = schedules.find((s) => s.revisions.some((r) => r.requestIds.includes(stopIds[0])))!;

  // admin1 approves it as usual.
  const admin = await pageFor(browser, "admin1");
  await admin.goto(`/schedules?open=${trip.id}`);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible(saved);

  // Jun, its Driver, records it on My Trips (0079): Start trip with the
  // odometer, the first stop, End trip on reaching the second with the
  // odometer again. req1 only drives trips they're the Driver of, so My
  // Trips doesn't list this one for them.
  await requester.goto("/my-trips");
  await expect(requester.getByText("No trips yet")).toBeVisible(saved);
  const driver = await pageFor(browser, "carjun");
  await driver.context().grantPermissions(["geolocation"]);
  await driver.context().setGeolocation({ latitude: 16.103769, longitude: 120.436222, accuracy: 10 });
  await driver.goto(`/my-trips?open=${trip.id}`);
  const action = driver.locator(".my-trip-action .trip-step-button");
  await driver.getByLabel("Starting odometer (km)").fill("48215");
  await action.click();
  await expect(action).toHaveText("Arrived at UAT Destination", saved);
  await action.click();
  await expect(action).toHaveText("Leaving UAT Destination", saved);
  await action.click();
  await expect(action).toHaveText("Arrived at UAT Second Destination · End trip", saved);
  await driver.getByLabel("Ending odometer (km)").fill("48000");
  await action.click();
  await expect(driver.locator(".modal-error")).toContainText("can't be lower than the start (48215 km)");
  await driver.getByLabel("Ending odometer (km)").fill("48262");
  await action.click();
  await expect(driver.getByText("Trip ended and submitted.")).toBeVisible(saved);

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
