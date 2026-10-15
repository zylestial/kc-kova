import { expect, test } from "@playwright/test";
import { freeDate, pageFor } from "./helpers";

test("a Daily request's stops reach Scheduling, the urgent one first", async ({ browser }) => {
  const scheduler = await pageFor(browser, "sched1");
  const date = await freeDate(scheduler, 14, 83);

  // req1 asks for two stops: a regular one, then an urgent one with its
  // reason, which needs Details.
  const requester = await pageFor(browser, "req1");
  await requester.goto("/requests/new");
  await requester.getByLabel("Jump to date").fill(date);
  await requester.getByRole("combobox", { name: "Project / Site" }).click();
  await requester.getByRole("option", { name: "UAT Project" }).click();
  await requester.getByRole("combobox", { name: "Destination" }).click();
  await requester.getByRole("option", { name: "UAT Destination" }).click();
  await requester.getByRole("combobox", { name: "Purpose" }).click();
  await requester.getByRole("option", { name: "UAT Purpose" }).click();
  await requester.getByRole("button", { name: "Add another destination" }).click();
  const urgent = requester.locator(".request-stop").nth(1);
  await urgent.locator(".request-priority label.urgent").click();
  await urgent.getByRole("combobox", { name: "Why is this stop urgent?" }).click();
  await requester.getByRole("option", { name: "Critical materials delivery" }).click();
  await urgent.getByRole("combobox", { name: "Destination" }).click();
  await requester.getByRole("option", { name: "UAT Second Destination" }).click();
  await requester.getByRole("button", { name: "Send request" }).click();
  await expect(urgent.getByText(/Say what's needed at this stop/)).toBeVisible();
  await urgent.getByPlaceholder(/20 bags cement/).fill("Pick up 40 bags cement");
  await requester.getByRole("button", { name: "Send request" }).click();
  await requester.waitForURL((url) => url.pathname === "/requests");
  await expect(requester.locator(".notice.success")).toBeVisible({ timeout: 30_000 });

  // Scheduling lists the urgent stop first in To plan, with its reason,
  // and shows it in an Urgent banner.
  await scheduler.goto(`/scheduling?date=${date}&type=DAILY`);
  const toPlan = scheduler.locator(".sc-panel .sc-list").first().locator(".sc-stop");
  await expect(toPlan).toHaveCount(2);
  await expect(toPlan.first()).toContainText("Urgent");
  await expect(toPlan.first()).toContainText("Critical materials delivery");
  await expect(toPlan.nth(1)).toContainText("UAT Destination");
  await expect(scheduler.locator(".sc-banner").filter({ hasText: "Urgent" })).toContainText("Pick up 40 bags cement");
});
