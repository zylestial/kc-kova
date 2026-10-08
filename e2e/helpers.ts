import { expect, type Browser, type Page } from "@playwright/test";

// Accounts created by scripts/seed-uat.mjs (all share this password).
export const PASSWORD = "test1234";

export async function signIn(page: Page, username: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

export async function signInAndWaitForHome(page: Page, username: string) {
  await signIn(page, username);
  await page.waitForURL("**/home");
}

/** A fresh browser session signed in as `username`. */
export async function pageFor(browser: Browser, username: string) {
  const page = await (await browser.newContext()).newPage();
  await signInAndWaitForHome(page, username);
  return page;
}

/** A random Manila date `min`..`max` days from today (negative is past), so repeated runs rarely collide. */
export function randomDate(min: number, max: number) {
  const day = new Date(Date.now() + (min + Math.floor(Math.random() * (max - min + 1))) * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(day);
}

type Option = { id: string; status: string; isOtherStop?: boolean };
type Request = { id: string; date: string; status: string; progress: string; cancellationPending: boolean; destinations: { id: string; destinationId: string }[] };

/** Files a one-destination request as the page's account and returns it. */
export async function createRequestVia(page: Page, date: string): Promise<Request> {
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const options = bootstrap.options as Record<"projects" | "destinations" | "purposes", Option[]>;
  const active = (list: Option[]) => list.filter((o) => o.status === "Active" && !o.isOtherStop);
  const response = await page.request.post("/api/requests", {
    data: {
      date,
      projectId: active(options.projects)[0].id,
      projectOther: "",
      destinations: [
        { destinationId: active(options.destinations)[0].id, destinationOther: "", purposeId: active(options.purposes)[0].id, purposeOther: "" },
      ],
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

type Schedule = { id: string; date: string; status: string; revisions: { status: string; rowVersion: number }[] };

/**
 * Sets up an approved trip without the UI: `owner` files a request on a
 * random day `min`..`max` days out and `admin` builds, submits and approves
 * a one-leg schedule for it on UAT-001 (driver1's vehicle). Retries on a
 * fresh day and hour if the vehicle is already booked then.
 */
export async function publishTrip(admin: Page, owner: Page, min: number, max: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  let failure = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const request = await createRequestVia(owner, randomDate(min, max));
    const hour = 1 + Math.floor(Math.random() * 18);
    const stop = request.destinations[0];
    const saved = await admin.request.post("/api/schedules", {
      data: {
        date: request.date,
        plate: "UAT-001",
        requestIds: [request.id],
        legs: [
          { destinationId: stop.destinationId, plannedTimeOut: `${pad(hour)}:00`, plannedTimeIn: `${pad(hour)}:30`, stops: [stop.id] },
          { isFinal: true, plannedTimeOut: `${pad(hour)}:40`, plannedTimeIn: `${pad(hour + 1)}:10` },
        ],
      },
    });
    if (!saved.ok()) {
      failure = await saved.text();
      continue;
    }
    const draft = (await saved.json()) as Schedule;
    const submitted = await admin.request.post(`/api/schedules/${draft.id}/submit`, {
      data: { rowVersion: draft.revisions.find((r) => r.status === "DRAFT")!.rowVersion },
    });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    const pending = (await submitted.json()) as Schedule;
    const approved = await admin.request.post(`/api/schedules/${draft.id}/approve`, {
      data: { rowVersion: pending.revisions.find((r) => r.status === "SUBMITTED")!.rowVersion },
    });
    expect(approved.ok(), await approved.text()).toBeTruthy();
    return { request, schedule: (await approved.json()) as Schedule };
  }
  throw new Error("Could not book UAT-001 for a test trip: " + failure);
}

/**
 * A random day `min`..`max` days out with no schedule and no request at all,
 * as `page` (a Scheduler or Admin, who see every one) sees them. Earlier
 * local runs leave trips and requests behind, so a test that plans "the
 * first vehicle at 08:00" or counts a day's requests needs an empty day.
 */
export async function freeDate(page: Page, min: number, max: number): Promise<string> {
  const { schedules, requests } = await (await page.request.get("/api/bootstrap")).json();
  const busy = new Set([...(schedules as Schedule[]), ...(requests as Request[])].map((item) => item.date));
  for (let attempt = 0; attempt < 50; attempt++) {
    const date = randomDate(min, max);
    if (!busy.has(date)) return date;
  }
  throw new Error(`No free day ${min}..${max} days out; reset the local database.`);
}

/** The page's account's view of one request, as /api/bootstrap returns it. */
export async function requestAs(page: Page, id: string): Promise<Request | undefined> {
  const { requests } = await (await page.request.get("/api/bootstrap")).json();
  return (requests as Request[]).find((r) => r.id === id);
}
