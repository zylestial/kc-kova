import { expect, test } from "@playwright/test";
import { createRequestVia, pageFor, publishTrip, randomDate, requestAs } from "./helpers";

test("a requester cancels a request before it is scheduled", async ({ browser }) => {
  const requester = await pageFor(browser, "req1");
  const request = await createRequestVia(requester, randomDate(14, 83));

  await requester.goto(`/requests?open=${request.id}`);
  await requester.getByRole("dialog").getByRole("button", { name: "Cancel request" }).click();
  await requester.getByRole("dialog").getByRole("button", { name: "Cancel request" }).click();
  await expect(requester.getByRole("dialog")).toBeHidden();

  expect((await requestAs(requester, request.id))?.status).toBe("CANCELLED");
});

test("an admin confirms a requester's ask to cancel a scheduled trip", async ({ browser }) => {
  const admin = await pageFor(browser, "admin1");
  const requester = await pageFor(browser, "req1");
  const { request } = await publishTrip(admin, requester, 14, 83);
  const reason = `e2e cancel ${request.id}`;

  // The request is in a schedule, so req1 can only ask.
  await requester.goto(`/requests?open=${request.id}`);
  await requester.getByRole("dialog").getByRole("button", { name: "Request cancellation" }).click();
  await requester.getByRole("dialog").getByLabel(/Reason/).fill(reason);
  await requester.getByRole("dialog").getByRole("button", { name: "Send to Admin" }).click();
  await expect(requester.getByRole("dialog")).toBeHidden();
  expect((await requestAs(requester, request.id))?.cancellationPending).toBe(true);

  // admin1 confirms it from the Schedules screen.
  await admin.goto("/schedules");
  await admin.getByRole("region", { name: "Cancellation requests" }).getByRole("row").filter({ hasText: reason })
    .getByRole("button", { name: "Confirm" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Cancel request" }).click();
  await expect(admin.getByRole("dialog")).toBeHidden();

  expect((await requestAs(requester, request.id))?.status).toBe("CANCELLED");
});

test("an admin cancels an approved schedule", async ({ browser }) => {
  const admin = await pageFor(browser, "admin1");
  const requester = await pageFor(browser, "req1");
  const { request, schedule } = await publishTrip(admin, requester, 14, 83);

  await admin.goto(`/schedules?open=${schedule.id}`);
  const dialog = admin.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel schedule" }).click();
  await dialog.getByLabel(/Why is this schedule being cancelled/).fill("e2e: trip no longer needed");
  await dialog.getByRole("button", { name: "Cancel schedule" }).click();
  await expect(admin.getByText("Schedule cancelled.")).toBeVisible();

  // The request goes back to be scheduled again, and driver1 loses the trip.
  expect((await requestAs(requester, request.id))?.progress).toBe("NOT_YET_SCHEDULED");
  const driver = await pageFor(browser, "driver1");
  const { schedules } = await (await driver.request.get("/api/bootstrap")).json();
  expect((schedules as { id: string; status: string }[]).find((s) => s.id === schedule.id)?.status ?? "gone").not.toBe("ACTIVE");
});
