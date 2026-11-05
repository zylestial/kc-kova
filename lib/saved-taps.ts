import type { AttendanceInput, BootstrapData, CompanyRunInput, StopTaskInput, StopTapInput } from "@/lib/kova-api";

/**
 * Taps made with no signal (0077). The phone keeps each one, with the time
 * it was tapped, and sends them in order once it can (sendSavedTaps in
 * lib/kova-api.ts). Until then they show on the trip as done, marked as
 * waiting, so the Driver can go on to the next step.
 *
 * Kept in this browser's localStorage, so they survive closing the app; a
 * phone that blocks storage still works, it just can't keep them across a
 * restart.
 */
export type SavedTap = { id: string; accountId: string; scheduleId: string } & (
  | { path: "attendance"; body: AttendanceInput & { tappedAt: string } }
  | { path: "stop-taps" | "company-stops"; body: StopTapInput & { tappedAt: string } }
  | { path: "company-run"; body: CompanyRunInput & { tappedAt: string } }
  | { path: "stop-tasks"; body: StopTaskInput & { tappedAt: string } }
);

const KEY = "kova-saved-taps";

export function loadSavedTaps(): SavedTap[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function storeSavedTaps(list: SavedTap[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the taps still send while this page stays open.
  }
}

/**
 * The loaded data with the account's saved taps added, as if already sent:
 * Start and End trip in attendance or the Company trip's run, Arrived and
 * Leaving in stopTaps, Done and its Undo in stopTasks, each marked `saved`. A tap the server already has
 * (sent, but the answer was lost) is left as the server has it.
 */
export function withSavedTaps(data: BootstrapData, saved: SavedTap[], accountId: string | undefined): BootstrapData {
  const mine = saved.filter((tap) => tap.accountId === accountId);
  if (!mine.length) return data;
  let { attendance, stopTaps, stopTasks, companyRuns } = data;
  const revisionOf = (scheduleId: string) => data.schedules.find((schedule) => schedule.id === scheduleId)?.publishedRevisionId ?? "";

  for (const tap of mine) {
    const { scheduleId, body } = tap;
    const at = body.tappedAt;
    if (tap.path === "attendance") {
      const record = attendance.find((item) => item.scheduleId === scheduleId);
      if (tap.body.kind === "START" && !record) {
        attendance = [
          ...attendance,
          {
            id: `saved-${tap.id}`,
            scheduleId,
            revisionId: revisionOf(scheduleId),
            driverId: tap.accountId,
            start: { at, recordedByAccountId: tap.accountId, location: null, saved: true },
          },
        ];
      } else if (tap.body.kind === "END" && record && !record.end) {
        attendance = attendance.map((item) =>
          item === record ? { ...item, end: { at, recordedByAccountId: tap.accountId, location: null, saved: true } } : item,
        );
      }
    } else if (tap.path === "company-run") {
      const run = companyRuns.find((item) => item.scheduleId === scheduleId);
      if (tap.body.kind === "START" && !run) {
        companyRuns = [
          ...companyRuns,
          { id: `saved-${tap.id}`, scheduleId, revisionId: revisionOf(scheduleId), startAt: at, startOdometer: tap.body.odometer, saved: true },
        ];
      } else if (tap.body.kind === "END" && run && !run.endAt) {
        const endOdometer = tap.body.odometer;
        companyRuns = companyRuns.map((item) => (item === run ? { ...item, endAt: at, endOdometer, saved: true } : item));
      }
    } else if (tap.path === "stop-tasks") {
      const { legId, requestId, kind } = tap.body;
      const same = (item: { legId: string; requestId: string }) => item.legId === legId && item.requestId === requestId;
      if (kind === "UNDO") {
        stopTasks = stopTasks.filter((item) => !same(item));
      } else if (!stopTasks.some(same)) {
        stopTasks = [
          ...stopTasks,
          { id: `saved-${tap.id}`, scheduleId, revisionId: revisionOf(scheduleId) ?? "", legId, requestId, at, recordedByAccountId: tap.accountId, saved: true },
        ];
      }
    } else {
      const { legId, kind } = tap.body;
      if (!stopTaps.some((item) => item.legId === legId && item.kind === kind)) {
        stopTaps = [
          ...stopTaps,
          {
            id: `saved-${tap.id}`,
            scheduleId,
            revisionId: revisionOf(scheduleId),
            legId,
            driverId: tap.accountId,
            kind,
            at,
            recordedByAccountId: tap.accountId,
            location: null,
            saved: true,
          },
        ];
      }
    }
  }
  return { ...data, attendance, stopTaps, stopTasks, companyRuns };
}
