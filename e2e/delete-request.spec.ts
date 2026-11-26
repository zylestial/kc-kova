import { expect, test } from "@playwright/test";
import { freeDate, pageFor, requestAs } from "./helpers";

type Option = { id: string; status: string; isOtherStop?: boolean };
type Stop = { id: string; stopLetter: string; group?: { number: number }; destinations: { id: string; destinationId: string }[] };

const saved = { timeout: 30_000 };

test("a Scheduler deletes a waiting stop for good, but not one on a trip", async ({ browser }) => {
  test.setTimeout(120_000);
  const [requester, scheduler] = await Promise.all([pageFor(browser, "booker1"), pageFor(browser, "sched1")]);
  const date = await freeDate(scheduler, 20, 60);

  // booker1 asks for two stops on one day.
  const { options } = (await (await requester.request.get("/api/bootstrap")).json()) as { options: Record<string, Option[]> };
  const active = (list: Option[]) => list.filter((o) => o.status === "Active" && !o.isOtherStop);
  const stop = (destination: Option) => ({ projectId: active(options.projects)[0].id, destinationId: destination.id, purposeId: active(options.purposes)[0].id, details: "Cement" });
  const [first, second] = active(options.destinations);
  const created = await requester.request.post("/api/request-groups", { data: { form: "DAILY", date, stops: [stop(first), stop(second)] } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const [a, b] = ((await created.json()) as Stop[]).sort((x, y) => x.stopLetter.localeCompare(y.stopLetter));
  const label = `${a.group!.number}-A`;

  // The requester can't delete it themselves.
  expect((await requester.request.delete(`/api/requests/${a.id}`)).status()).toBe(403);

  // Stop B goes on a draft trip, so it can't be deleted.
  const draft = await scheduler.request.post("/api/schedules", {
    data: {
      date,
      plate: "UAT-001",
      requestIds: [b.id],
      legs: [
        { destinationId: b.destinations[0].destinationId, plannedTimeOut: "08:00", plannedTimeIn: "08:30", stops: [b.destinations[0].id] },
        { isFinal: true, plannedTimeOut: "08:40", plannedTimeIn: "09:10" },
      ],
    },
  });
  expect(draft.ok(), await draft.text()).toBeTruthy();
  const refused = await scheduler.request.delete(`/api/requests/${b.id}`);
  expect(refused.status()).toBe(422);
  expect((await refused.json()).message).toContain("was on a trip");

  // sched1 deletes stop A from its sheet on Scheduling.
  await scheduler.goto(`/scheduling?date=${date}&type=DAILY`);
  await scheduler.locator(".sc-stop", { hasText: label }).click();
  await scheduler.getByRole("dialog").getByRole("button", { name: `Delete ${label}` }).click();
  const confirm = scheduler.getByRole("alertdialog");
  await expect(confirm).toContainText(`Delete ${label} permanently?`);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(scheduler.locator(".notice.success")).toContainText(`${label} deleted.`, saved);
  await expect(scheduler.locator(".sc-stop", { hasText: label })).toHaveCount(0);

  // It's gone for everyone; stop B stays.
  expect(await requestAs(requester, a.id)).toBeUndefined();
  expect(await requestAs(scheduler, a.id)).toBeUndefined();
  expect(await requestAs(requester, b.id)).toBeDefined();
});
