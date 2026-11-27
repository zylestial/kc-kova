import { expect, test, type Locator, type Page } from "@playwright/test";
import { pageFor } from "./helpers";

type Booking = { plate: string; startsAt: string; endsAt: string; accountIds: string[] };
type CompanyTrip = { groupId: string; scheduleId?: string; state: string };
type Stop = { id: string; date: string; group?: { id: string; number: number; form: string } };

const pick = async (scope: Page | Locator, page: Page, label: string | RegExp, option: string | RegExp) => {
  await scope.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
};
/** Waits on a save, which the dev server can take a while over on its first run. */
const saved = { timeout: 30_000 };
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const hhmm = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/**
 * A Time Out today, from 06:00 on a 40-minute grid, with the Mirage and
 * everyone on this trip free for the two hours after it, so the trip ends
 * before the Driver's day does at 6 PM. Earlier local runs leave trips
 * behind, and no vehicle or person can be on two Company trips at once.
 */
async function freeStart(page: Page, today: string, people: string[]) {
  const bookings = (await (await page.request.get(`/api/company-trips/busy?date=${today}`)).json()) as Booking[];
  const busy = bookings
    .filter((b) => b.plate === "NBC-4821" || b.accountIds.some((id) => people.includes(id)))
    .map((b) => [minutes(b.startsAt), minutes(b.endsAt)]);
  for (let start = 6 * 60; start + 120 <= 18 * 60; start += 40) {
    if (!busy.some(([a, b]) => start < b + 15 && a < start + 120)) return start;
  }
  throw new Error("The Mirage is booked all day today; reset the local database.");
}

test("a Company trip goes from request to the printed form", async ({ browser }) => {
  // Three accounts and a dozen saves: longer than the usual 90 seconds.
  test.setTimeout(180_000);
  // My Trips starts a trip only on its day, so this one is for today.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

  // req1 (allowed Company trips, Position set) books the Mirage with its
  // Company car Driver for two stops (Company trip v2: no Scheduler).
  const requester = await pageFor(browser, "req1");
  const driver = await pageFor(browser, "carjun");
  const { accounts } = (await (await requester.request.get("/api/bootstrap")).json()) as { accounts: Array<{ id: string; name: string }> };
  const people = accounts.filter((a) => a.name === "QA Requester Three" || a.name === "Jun Reyes").map((a) => a.id);
  const start = await freeStart(requester, today, people);

  await requester.goto("/requests/new");
  await requester.getByRole("radio", { name: /^Company Trip/ }).check();
  await requester.getByLabel("Date", { exact: true }).fill(today);
  await pick(requester, requester, "Vehicle", /Mirage/);
  await requester.getByLabel("Time Out").fill(hhmm(start));
  await requester.getByLabel("Time In").fill(hhmm(start + 100));
  await pick(requester, requester, "Destination / Site to visit", "UAT Destination");
  await requester.getByRole("button", { name: "Add another destination" }).click();
  const second = requester.locator(".request-stop").nth(1);
  await pick(second, requester, "Destination / Site to visit", "UAT Second Destination");
  const first = requester.locator(".request-stop").first();
  await first.getByLabel("Arrive").fill(hhmm(start + 30));
  await first.getByLabel("Leave").fill(hhmm(start + 60));
  await requester.getByLabel("What is this trip for?").fill("Deliver the UAT documents, then pick up the signed copies");
  await pick(requester, requester, "Department / Project Site", "UAT Project");
  await requester.getByLabel("Fleet Card No. / last 4 digits").fill("4821");
  await pick(requester, requester, "Driver", /Jun Reyes/);
  await requester.getByRole("button", { name: "Send request" }).click();
  await requester.waitForURL((url) => url.pathname === "/requests");
  await expect(requester.locator(".notice.success")).toContainText("sent to the Admin for approval", saved);

  // A Requester sees only their own requests, and where each trip is (0096).
  const data = (await (await requester.request.get("/api/bootstrap")).json()) as { requests: Stop[]; companyTrips: CompanyTrip[] };
  const mine = data.requests.filter((r) => r.date === today && r.group?.form === "COMPANY");
  const number = Math.max(...mine.map((r) => r.group!.number));
  const groupId = mine.find((r) => r.group!.number === number)!.group!.id;
  expect(mine.filter((r) => r.group!.number === number)).toHaveLength(2);
  const status = data.companyTrips.find((t) => t.groupId === groupId)!;
  expect(status.state).toBe("WAITING");
  const tripId = status.scheduleId!;

  // admin1 approves it on Schedules, which says who records it.
  const admin = await pageFor(browser, "admin1");
  await admin.goto(`/schedules?open=${tripId}`);
  await expect(admin.getByRole("dialog")).toContainText("Records the trip:");
  await expect(admin.getByRole("dialog").getByRole("button", { name: "Edit draft" })).toHaveCount(0);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible(saved);

  // req1 prints the form from My requests: A and B filled, odometers blank.
  await requester.goto("/requests");
  await requester.locator("tbody tr").filter({ hasText: `#${number}` }).click();
  await expect(requester.getByRole("button", { name: "Print Company Trip Form" })).toBeVisible(saved);
  await requester.emulateMedia({ media: "print" });
  const form = requester.locator(".company-print");
  await expect(form).toContainText("COMPANY TRIP FORM – EMPLOYEE FLEET CARD UTILIZATION");
  await expect(form).toContainText("Purchasing Officer");
  await expect(form).toContainText("NBC-4821 (Mirage)");
  await expect(form).toContainText("Jun Reyes");
  await expect(form).toContainText("UAT Second Destination");
  await expect(form).toContainText("Deliver the UAT documents");
  await requester.emulateMedia({ media: "screen" });

  // Jun, its Driver, records it on My Trips (0079): Start trip with the
  // odometer, the first stop, End trip on reaching the second.
  await driver.context().grantPermissions(["geolocation"]);
  await driver.context().setGeolocation({ latitude: 16.103769, longitude: 120.436222, accuracy: 10 });
  await driver.goto(`/my-trips?open=${tripId}`);
  const action = driver.locator(".my-trip-action .trip-step-button");
  await action.click(); // Start trip; the reading comes after it (0090)
  await driver.getByLabel("Starting odometer (km)").fill("48215");
  await driver.getByRole("button", { name: "Save reading" }).click();
  await expect(action).toHaveText("Arrived at UAT Destination", saved);
  await action.click();
  await expect(action).toHaveText("Leaving UAT Destination", saved);
  await driver.getByRole("button", { name: "Done", exact: true }).click();
  await expect(action).toBeEnabled(saved);
  await action.click();
  await expect(action).toHaveText("Arrived at UAT Second Destination · End trip", saved);
  await driver.getByRole("button", { name: "Done", exact: true }).click();
  await expect(action).toBeEnabled(saved);
  await driver.getByLabel("Ending odometer (km)").fill("48000");
  await action.click();
  await expect(driver.locator(".modal-error")).toContainText("can't be lower than the start (48215 km)");
  await driver.getByLabel("Ending odometer (km)").fill("48262");
  await action.click();
  await expect(driver.getByText("Trip ended and submitted.")).toBeVisible(saved);

  // The printed form now has the odometers (0097).
  await requester.reload();
  await requester.locator("tbody tr").filter({ hasText: `#${number}` }).click();
  await expect(requester.getByRole("button", { name: "Print Company Trip Form" })).toBeVisible(saved);
  await requester.emulateMedia({ media: "print" });
  await expect(form).toContainText("48215");
  await expect(form).toContainText("48262");
  await expect(form).toContainText("47");
  await requester.emulateMedia({ media: "screen" });

  // admin1 finds it under Company Trips in Finished Trips and marks it done;
  // the requester prints the form, not the Admin.
  await admin.goto("/finished");
  await pick(admin, admin, "Form filter", "Company Trips");
  await expect(admin.locator("tbody tr").filter({ hasText: "NBC-4821" }).first()).toBeVisible();
  await admin.goto(`/finished?open=${tripId}`);
  const review = admin.getByRole("dialog");
  await expect(review.getByText(/48215 → 48262 \(47 km\)/)).toBeVisible();
  await expect(review.getByRole("button", { name: "Print", exact: true })).toHaveCount(0);
  await review.getByRole("button", { name: "Mark as done" }).click();
  await review.getByRole("button", { name: "Mark as done" }).click();
  await expect(admin.getByText(/marked as done\./)).toBeVisible(saved);
});
