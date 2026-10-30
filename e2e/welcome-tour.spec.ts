import { expect, test } from "@playwright/test";
import { signInAndWaitForHome } from "./helpers";

// seed-uat.mjs marks the QA accounts' tour seen, so it doesn't open by
// itself here; Help opens it at step 1, with the screenshots for the screen.
test("Help opens the welcome tour and Done closes it", async ({ page }) => {
  await signInAndWaitForHome(page, "sched1");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Help" }).click();
  const tour = page.getByRole("dialog");
  await expect(tour.getByText("Scheduler tour")).toBeVisible();
  await expect(tour.getByText("1 of 6")).toBeVisible();
  await expect(tour.getByText("You can open")).toBeVisible();
  await expect(tour.getByRole("img", { name: "The Scheduler menu" })).toHaveAttribute("src", "/tour/pc/scheduler-menu.webp");

  for (let step = 2; step <= 6; step++) {
    await tour.getByRole("button", { name: "Next", exact: true }).click();
    await expect(tour.getByText(`${step} of 6`)).toBeVisible();
  }
  await expect(tour.getByRole("button", { name: "Skip tour" })).toHaveCount(0);
  await tour.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the tour uses phone screenshots on a phone-sized screen", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signInAndWaitForHome(page, "driver1");
  await page.getByRole("button", { name: /open menu/i }).first().click();
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "The Driver menu" })).toHaveAttribute("src", "/tour/phone/driver-menu.webp");
});
