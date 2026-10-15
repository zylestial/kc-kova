import { expect, test } from "@playwright/test";
import { createRequestVia, freeDate, pageFor } from "./helpers";

type Schedule = { id: string; revisions: { requestIds: string[] }[] };

/** Waits on a save, which the dev server can take a while over on its first run. */
const saved = { timeout: 30_000 };

test("a request becomes an approved schedule", async ({ browser }) => {
  // A day with nothing on it yet, so To plan holds only this request and
  // every Daily vehicle is free.
  const scheduler = await pageFor(browser, "sched1");
  const date = await freeDate(scheduler, 14, 83);

  // Requester files a request for the day.
  const requester = await pageFor(browser, "req1");
  const request = await createRequestVia(requester, date);

  // Scheduler adds it to the best vehicle on Scheduling and submits the trip.
  await scheduler.goto(`/scheduling?date=${date}&type=DAILY`);
  await scheduler.locator(".sc-panel .sc-stop").first().click();
  await scheduler.locator(".sc-option.best").getByRole("button", { name: "Add" }).click();
  await expect(scheduler.locator(".notice.success")).toContainText("Added to", saved);
  await scheduler.getByRole("button", { name: "Submit for approval" }).click();
  await expect(scheduler.locator(".notice.success")).toContainText("Submitted", saved);
  const { schedules } = (await (await scheduler.request.get("/api/bootstrap")).json()) as { schedules: Schedule[] };
  const trip = schedules.find((s) => s.revisions.some((r) => r.requestIds.includes(request.id)))!;

  // Admin approves it.
  const admin = await pageFor(browser, "admin1");
  await admin.goto(`/schedules?open=${trip.id}`);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible(saved);

  // The requester's request is now approved.
  const mine = (await (await requester.request.get("/api/bootstrap")).json()).requests as { id: string; progress: string }[];
  expect(mine.find((r) => r.id === request.id)?.progress).toBe("APPROVED");
});
