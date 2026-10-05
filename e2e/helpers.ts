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
type Request = { id: string; date: string; status: string; progress: string; destinations: { id: string; destinationId: string }[] };

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

/** The page's account's view of one request, as /api/bootstrap returns it. */
export async function requestAs(page: Page, id: string): Promise<Request | undefined> {
  const { requests } = await (await page.request.get("/api/bootstrap")).json();
  return (requests as Request[]).find((r) => r.id === id);
}
