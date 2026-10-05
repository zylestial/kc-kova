import { type Page } from "@playwright/test";

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
