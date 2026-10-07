import { expect, test } from "@playwright/test";
import { pageFor, publishTrip, requestAs } from "./helpers";

test("a driver records a finished trip and an admin marks it done", async ({ browser }) => {
  // A trip can only be recorded once it has ended, and only an Admin may
  // request a past date, so admin1 owns the request.
  const admin = await pageFor(browser, "admin1");
  const { request, schedule } = await publishTrip(admin, admin, -80, -3);

  // driver1 taps Start and End at ANONANG, then records the odometers.
  const driver = await pageFor(browser, "driver1");
  await driver.context().grantPermissions(["geolocation"]);
  await driver.context().setGeolocation({ latitude: 16.103769, longitude: 120.436222, accuracy: 10 });
  await driver.goto(`/my-schedule?open=${schedule.id}`);
  const record = driver.getByRole("dialog");
  await record.getByRole("button", { name: "Start trip" }).click();
  await expect(record.getByText(/^Started .+, at ANONANG\./)).toBeVisible();
  await record.getByRole("button", { name: "End trip" }).click();
  await expect(record.getByText(/Ended .+, at ANONANG\./)).toBeVisible();
  await record.getByRole("button", { name: "Complete trip" }).click();
  await record.getByLabel(/Starting odometer/).fill("1000");
  await record.getByLabel(/Ending odometer/).fill("1042");
  await expect(record.getByText("42 km")).toBeVisible();
  await record.getByRole("button", { name: "Next" }).click();
  await record.getByRole("button", { name: "Submit trip" }).click();
  await expect(driver.getByText(/submitted\./)).toBeVisible();

  // admin1 reviews it in Finished Trips and marks it done.
  await admin.goto(`/finished?open=${schedule.id}`);
  const review = admin.getByRole("dialog");
  await expect(review.getByText(/1000 → 1042 \(42 km\)/)).toBeVisible();
  await review.getByRole("button", { name: "Mark as done" }).click();
  await review.getByRole("button", { name: "Mark as done" }).click();
  await expect(admin.getByText(/marked as done\./)).toBeVisible();

  expect((await requestAs(admin, request.id))?.progress).toBe("DONE");

  // The taps show on Attendance, flagged as late: the trip was days ago.
  await admin.goto("/attendance");
  await admin.getByRole("combobox", { name: "Dates" }).click();
  await admin.getByRole("option", { name: "Any date" }).click();
  await expect(admin.getByText("Tapped after the trip day").first()).toBeVisible();
});
