import { expect, test } from "@playwright/test";
import { createRequestVia, freeDate, pageFor } from "./helpers";

test("a request becomes an approved schedule", async ({ browser }) => {
  // A day with nothing on it yet, so the pool holds only this request and
  // the first vehicle is free at 08:00.
  const scheduler = await pageFor(browser, "sched1");
  const date = await freeDate(scheduler, 14, 83);

  // Requester files a request for the day.
  const requester = await pageFor(browser, "req1");
  const request = await createRequestVia(requester, date);

  // Scheduler builds one trip from it and submits.
  await scheduler.goto("/schedules/new");
  await scheduler.getByLabel("Jump to date").fill(date);
  await scheduler.getByRole("button", { name: /continue/i }).click();
  await scheduler.getByRole("combobox", { name: "Vehicle" }).click();
  await scheduler.getByRole("option").filter({ hasNotText: "no Driver" }).first().click();
  await scheduler.getByRole("combobox", { name: /Leg 1 destination/ }).click();
  await scheduler.getByRole("option").first().click();
  await scheduler.getByLabel("Leg 1 planned Time Out").fill("08:00");
  await scheduler.getByLabel("Leg 1 planned Time In").fill("09:00");
  await scheduler.getByLabel("Leg 2 planned Time In").fill("10:00");
  await scheduler.getByRole("button", { name: /submit for approval/i }).first().click();
  await scheduler.getByRole("dialog").getByRole("button", { name: "Submit for approval" }).click();
  await scheduler.waitForURL("**/schedules**");

  // Admin approves it.
  const admin = await pageFor(browser, "admin1");
  await admin.goto("/schedules");
  const monday = new Date(date + "T12:00:00");
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const week = "Week of " + monday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  for (let i = 0; i < 14 && !(await admin.getByRole("heading", { name: week }).count()); i++) {
    await admin.getByRole("button", { name: "Next week" }).click();
  }
  await admin.locator(".week-day-label").nth((new Date(date + "T12:00:00").getDay() + 6) % 7).click();
  await admin.locator(".schedule-card").first().click();
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible();

  // The requester's request is now approved.
  const mine = (await (await requester.request.get("/api/bootstrap")).json()).requests as { id: string; progress: string }[];
  expect(mine.find((r) => r.id === request.id)?.progress).toBe("APPROVED");
});
