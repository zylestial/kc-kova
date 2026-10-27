import { expect, test, type Locator, type Page } from "@playwright/test";
import { pageFor } from "./helpers";

type Leg = { plannedTimeOut: string; plannedTimeIn: string };
type Revision = { id: string; status: string; plate: string; requestIds: string[]; legs: Leg[] };
type Schedule = { id: string; kind: string; status: string; date: string; publishedRevisionId?: string; revisions: Revision[] };
type Stop = { id: string; date: string; group?: { number: number; form: string } };

const pick = async (scope: Page | Locator, page: Page, label: string | RegExp, option: string | RegExp) => {
  await scope.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
};
const saved = { timeout: 30_000 };
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const hhmm = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
const PLATE = "NBC-4821";

async function schedulesOf(page: Page) {
  return ((await (await page.request.get("/api/bootstrap")).json()) as { schedules: Schedule[] }).schedules;
}
const published = (trip: Schedule) => trip.revisions.find((r) => r.id === trip.publishedRevisionId)!;

/** A start today on a 40-minute grid with the Mirage free for four hours (other than `stopIds`' trip). */
async function freeStart(page: Page, today: string, stopIds: string[]) {
  const busy = (await schedulesOf(page))
    .filter((s) => s.kind === "COMPANY" && s.status === "ACTIVE" && s.date === today)
    .flatMap((s) => s.revisions.filter((r) => r.plate === PLATE && r.legs.length && !stopIds.some((id) => r.requestIds.includes(id))))
    .map((r) => [minutes(r.legs[0].plannedTimeOut), minutes(r.legs.at(-1)!.plannedTimeIn)]);
  for (let start = 6 * 60; start + 240 <= 18 * 60; start += 40) {
    if (!busy.some(([a, b]) => start < b + 15 && a < start + 240)) return start;
  }
  throw new Error("The Mirage is booked all day today; reset the local database.");
}

/**
 * Cancels today's Company trips on the Mirage that an earlier local run left
 * unfinished, so this run's stops start a trip of their own rather than
 * joining one as draft changes. A refused cancel (a finished trip) is fine.
 */
async function clearMirage(admin: Page, today: string) {
  for (const s of await schedulesOf(admin)) {
    if (s.kind !== "COMPANY" || s.status !== "ACTIVE" || s.date !== today || !s.revisions.some((r) => r.plate === PLATE)) continue;
    await admin.request.post(`/api/schedules/${s.id}/cancel`, { data: { reason: "Left over from an earlier e2e run." } });
  }
}

/**
 * The Scheduler opens an approved Company trip's Propose revision, moves
 * Leg `leg`'s Time Out to `time` and resubmits; the Admin approves it.
 */
async function reviseAndApprove(scheduler: Page, admin: Page, tripId: string, leg: number, time: string) {
  await scheduler.goto(`/schedules?open=${tripId}`);
  await scheduler.getByRole("button", { name: "Propose revision" }).click();
  await scheduler.waitForURL((url) => url.pathname === "/scheduling", saved);
  const card = scheduler.locator(".sc-vehicle").filter({ hasText: PLATE });
  // The one trip on the card that can still change (an earlier run's ended
  // trip can share it). Before it starts, changes are opened with Propose
  // changes; on the road the legs not reached yet are open straight away.
  const propose = scheduler.getByRole("button", { name: "Propose changes" });
  const trip = card.locator(".sc-trip").filter({ has: propose.or(scheduler.locator("input[type=time]:enabled")) });
  await expect(trip).toHaveCount(1, saved);
  if (await trip.getByRole("button", { name: "Propose changes" }).count()) await trip.getByRole("button", { name: "Propose changes" }).click();
  const times = trip.locator(".sc-leg").nth(leg).locator("input[type=time]:enabled");
  await expect(times.first()).toBeVisible(saved);
  await times.first().fill(time);
  await times.first().press("Enter");
  await expect(scheduler.locator(".notice.success")).toContainText(`Leg ${leg + 1}: `, saved);
  await card.getByRole("button", { name: /Resubmit for approval|Submit for approval/ }).click();
  await expect(scheduler.locator(".notice.success")).toContainText(/Resubmitted|Submitted/, saved);

  await admin.goto(`/schedules?open=${tripId}`);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible(saved);
}

test("an approved Company trip can be revised before and during the trip", async ({ browser }) => {
  test.setTimeout(240_000);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const admin = await pageFor(browser, "admin1");
  await clearMirage(admin, today);

  // req1 asks for a two-stop Company trip today with the Mirage and Jun.
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
  const { requests } = (await (await requester.request.get("/api/bootstrap")).json()) as { requests: Stop[] };
  const mine = requests.filter((r) => r.date === today && r.group?.form === "COMPANY");
  const number = Math.max(...mine.map((r) => r.group!.number));
  const stopIds = mine.filter((r) => r.group!.number === number).map((r) => r.id);

  // sched1 plans both stops on the Mirage and submits; admin1 approves.
  const scheduler = await pageFor(browser, "sched1");
  await scheduler.goto(`/scheduling?date=${today}&type=COMPANY`);
  for (const letter of ["A", "B"]) {
    const stop = scheduler.locator(".sc-panel .sc-stop").filter({ hasText: `${number}-${letter}` });
    const add = scheduler.locator(".sc-option").filter({ hasText: "Mirage" }).getByRole("button", { name: "Add" });
    await expect(async () => {
      if (!(await add.isVisible())) await stop.click();
      await expect(add).toBeEnabled({ timeout: 5_000 });
    }).toPass(saved);
    await add.click();
    await expect(scheduler.locator(".notice.success")).toContainText("Added to", saved);
  }
  const card = scheduler.locator(".sc-vehicle").filter({ hasText: PLATE });
  const start = await freeStart(scheduler, today, stopIds);
  const first = card.locator("input[type=time]:enabled").first();
  await first.fill(hhmm(start));
  await first.press("Enter");
  await expect(scheduler.locator(".notice.success")).toContainText("Leg 1: ", saved);
  await card.getByRole("button", { name: "Submit for approval", exact: true }).click();
  await expect(scheduler.locator(".notice.success")).toContainText("Submitted", saved);
  const trip = (await schedulesOf(scheduler)).find((s) => s.revisions.some((r) => r.requestIds.includes(stopIds[0])))!;
  await admin.goto(`/schedules?open=${trip.id}`);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible(saved);

  // Before it starts: leave 40 minutes later. The approved trip carries the new times.
  await reviseAndApprove(scheduler, admin, trip.id, 0, hhmm(start + 40));
  const revised = published((await schedulesOf(admin)).find((s) => s.id === trip.id)!);
  expect(revised.legs[0].plannedTimeOut).toBe(hhmm(start + 40));
  expect(revised.requestIds.sort()).toEqual([...stopIds].sort());

  // Jun, the Driver, sees it on My Trips and sets off: Start trip, then the first stop.
  const driver = await pageFor(browser, "carjun");
  await driver.context().grantPermissions(["geolocation"]);
  await driver.context().setGeolocation({ latitude: 16.103769, longitude: 120.436222, accuracy: 10 });
  await driver.goto(`/my-trips?open=${trip.id}`);
  const action = driver.locator(".my-trip-action .trip-step-button");
  await driver.getByLabel("Starting odometer (km)").fill("51000");
  await action.click();
  await expect(action).toHaveText("Arrived at UAT Destination", saved);
  await action.click();
  await expect(action).toHaveText("Leaving UAT Destination", saved);

  // On the road: Leg 2 leaves 20 minutes later than planned. The taps so far stay.
  const leg2 = revised.legs[1];
  await reviseAndApprove(scheduler, admin, trip.id, 1, hhmm(minutes(leg2.plannedTimeOut) + 20));
  const onTheRoad = published((await schedulesOf(admin)).find((s) => s.id === trip.id)!);
  expect(onTheRoad.legs[1].plannedTimeOut).toBe(hhmm(minutes(leg2.plannedTimeOut) + 20));
  await driver.reload();
  await expect(action).toHaveText("Leaving UAT Destination", saved);

  // And the Driver finishes the trip as usual.
  await action.click();
  await expect(action).toHaveText("Arrived at UAT Second Destination · End trip", saved);
  await driver.getByLabel("Ending odometer (km)").fill("51040");
  await action.click();
  await expect(driver.getByText("Trip ended and submitted.")).toBeVisible(saved);
});
