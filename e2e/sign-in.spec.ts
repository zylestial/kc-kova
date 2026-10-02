import { expect, test } from "@playwright/test";
import { signIn, signInAndWaitForHome } from "./helpers";

test("rejects a wrong password", async ({ page }) => {
  await signIn(page, "admin1", "not-the-password");
  await expect(page.getByText(/invalid username or password/i)).toBeVisible();
  await expect(page).toHaveURL(/sign-in/);
});

test("sends signed-out visitors to the sign-in page", async ({ page }) => {
  await page.goto("/schedules");
  await expect(page).toHaveURL(/sign-in/);
});

// One page per role that only that role (or more) should reach, plus a probe
// element that proves the screen rendered its data rather than an error.
const roles = [
  { user: "admin1", pages: [["/settings", "table"], ["/finished", "table, .empty"], ["/schedules", ".schedule-card, .empty"]] },
  { user: "sched1", pages: [["/schedules", ".schedule-card, .empty"], ["/schedules/new", ".date-card"]] },
  { user: "req1", pages: [["/requests", "table, .empty"], ["/requests/new", ".date-card"]] },
  { user: "driver1", pages: [["/my-schedule", "table, .empty"]] },
] as const;

for (const { user, pages } of roles) {
  test(`${user} signs in and reaches their screens`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await signInAndWaitForHome(page, user);
    for (const [path, probe] of pages) {
      await page.goto(path);
      await expect(page.locator(probe).first(), `${user} ${path}`).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
