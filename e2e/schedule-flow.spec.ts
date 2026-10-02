import { expect, test, type Page } from "@playwright/test";
import { signInAndWaitForHome } from "./helpers";

// A far-off random day keeps repeated runs from colliding on the same vehicle.
function runDate() {
  const day = new Date(Date.now() + (30 + Math.floor(Math.random() * 300)) * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(day);
}

async function createRequestVia(page: Page, date: string) {
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const options = bootstrap.options as Record<"projects" | "destinations" | "purposes", { id: string; status: string; isOtherStop?: boolean }[]>;
  const active = (list: typeof options.projects) => list.filter((o) => o.status === "Active" && !o.isOtherStop);
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
}

test("a request becomes an approved schedule", async ({ browser }) => {
  const date = runDate();
  const pageFor = async (user: string) => {
    const page = await (await browser.newContext()).newPage();
    await signInAndWaitForHome(page, user);
    return page;
  };

  // Requester files a request for the day.
  const requester = await pageFor("req1");
  await createRequestVia(requester, date);

  // Scheduler builds one trip from it and submits.
  const scheduler = await pageFor("sched1");
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
  const admin = await pageFor("admin1");
  await admin.goto("/schedules");
  await admin.goto("/schedules?date=" + date);
  await admin.locator(".schedule-card", { hasText: /submitted|waiting|pending/i }).first().click();
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.getByText(/approved and published/i)).toBeVisible();

  // The requester's own request for that day is now approved.
  const mine = (await (await requester.request.get("/api/bootstrap")).json()).requests as { date: string; progress: string }[];
  expect(mine.filter((r) => r.date === date).map((r) => r.progress)).toEqual(["APPROVED"]);
});
