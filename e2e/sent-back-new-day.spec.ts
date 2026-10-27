import { expect, test } from "@playwright/test";
import { freeDate, pageFor, requestAs } from "./helpers";

type Option = { id: string; status: string; isOtherStop?: boolean };
type Stop = { id: string; date: string; progress: string; stopLetter: string; group?: { id: string; number: number }; destinations: { id: string; destinationId: string }[] };

const saved = { timeout: 30_000 };

test("a sent-back stop moves to another day while the rest of its request is scheduled", async ({ browser }) => {
  test.setTimeout(120_000);
  const [requester, scheduler] = await Promise.all([pageFor(browser, "booker1"), pageFor(browser, "sched1")]);
  const date = await freeDate(scheduler, 20, 60);

  // booker1 asks for two stops on one day.
  const { options } = (await (await requester.request.get("/api/bootstrap")).json()) as { options: Record<string, Option[]> };
  const active = (list: Option[]) => list.filter((o) => o.status === "Active" && !o.isOtherStop);
  const stop = (destination: Option) => ({ projectId: active(options.projects)[0].id, destinationId: destination.id, purposeId: active(options.purposes)[0].id });
  const [first, second] = active(options.destinations);
  const created = await requester.request.post("/api/request-groups", { data: { form: "DAILY", date, stops: [stop(first), stop(second)] } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const [a, b] = ((await created.json()) as Stop[]).sort((x, y) => x.stopLetter.localeCompare(y.stopLetter));

  // sched1 puts stop A on a trip and sends stop B back.
  const draft = await scheduler.request.post("/api/schedules", {
    data: {
      date,
      plate: "UAT-001",
      requestIds: [a.id],
      legs: [
        { destinationId: a.destinations[0].destinationId, plannedTimeOut: "08:00", plannedTimeIn: "08:30", stops: [a.destinations[0].id] },
        { isFinal: true, plannedTimeOut: "08:40", plannedTimeIn: "09:10" },
      ],
    },
  });
  expect(draft.ok(), await draft.text()).toBeTruthy();
  const sentBack = await scheduler.request.post("/api/requests/send-back", { data: { requestIds: [b.id], reason: "The van is full that day" } });
  expect(sentBack.ok(), await sentBack.text()).toBeTruthy();

  // booker1 opens stop B: its request's date is locked, so it moves on its own.
  const later = new Date(`${date}T12:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 2);
  const newDay = later.toISOString().slice(0, 10);
  await requester.goto(`/requests?open=${b.id}`);
  const dialog = requester.getByRole("dialog");
  await expect(dialog).toContainText("The van is full that day", saved);
  await expect(dialog).toContainText("is being scheduled, so its date can't change");
  await dialog.getByLabel("New day").fill(newDay);
  await dialog.getByRole("button", { name: "Move to this day" }).click();
  await expect(requester.locator(".notice.success")).toContainText(`Stop ${b.group!.number}-B is now a request of its own`, saved);

  // It's request N-A on the new day, waiting for the Scheduler; stop A stays where it was.
  const moved = (await requestAs(scheduler, b.id)) as unknown as Stop;
  expect(moved.date).toBe(newDay);
  expect(moved.progress).toBe("NOT_YET_SCHEDULED");
  expect(moved.stopLetter).toBe("A");
  expect(moved.group!.number).not.toBe(b.group!.number);
  const kept = (await requestAs(scheduler, a.id)) as unknown as Stop;
  expect(kept.date).toBe(date);
  expect(kept.group!.number).toBe(a.group!.number);
});
