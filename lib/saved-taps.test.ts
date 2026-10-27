import { describe, expect, it } from "vitest";
import { getEmptyKovaData, type BootstrapData, type Schedule } from "@/lib/kova-api";
import { withSavedTaps, type SavedTap } from "@/lib/saved-taps";

const DAN = "driver-dan";
const at = (hhmm: string) => `2026-10-22T${hhmm}:00.000Z`;
const data = (extra: Partial<BootstrapData> = {}): BootstrapData => ({
  ...getEmptyKovaData(),
  schedules: [{ id: "s1", publishedRevisionId: "rev1" } as Schedule],
  ...extra,
});
let n = 0;
const saved = (tap: Omit<SavedTap, "id" | "accountId" | "scheduleId">, accountId = DAN): SavedTap =>
  ({ id: `t${++n}`, accountId, scheduleId: "s1", ...tap }) as SavedTap;

describe("withSavedTaps", () => {
  it("leaves the data alone with nothing saved", () => {
    const loaded = data();
    expect(withSavedTaps(loaded, [], DAN)).toBe(loaded);
  });

  it("shows saved Start, stop taps and End as done, marked saved", () => {
    const view = withSavedTaps(
      data(),
      [
        saved({ path: "attendance", body: { kind: "START", location: null, tappedAt: at("01:00") } }),
        saved({ path: "stop-taps", body: { legId: "leg1", kind: "ARRIVE", location: null, tappedAt: at("01:30") } }),
        saved({ path: "stop-taps", body: { legId: "leg1", kind: "LEAVE", location: null, tappedAt: at("01:45") } }),
        saved({ path: "attendance", body: { kind: "END", location: null, tappedAt: at("02:30") } }),
      ],
      DAN,
    );
    expect(view.attendance).toEqual([
      {
        id: expect.stringMatching(/^saved-/),
        scheduleId: "s1",
        revisionId: "rev1",
        driverId: DAN,
        start: { at: at("01:00"), recordedByAccountId: DAN, location: null, saved: true },
        end: { at: at("02:30"), recordedByAccountId: DAN, location: null, saved: true },
      },
    ]);
    expect(view.stopTaps.map((tap) => [tap.legId, tap.kind, tap.at, tap.saved])).toEqual([
      ["leg1", "ARRIVE", at("01:30"), true],
      ["leg1", "LEAVE", at("01:45"), true],
    ]);
  });

  it("keeps a tap KOVA already has as KOVA has it", () => {
    const loaded = data({
      stopTaps: [
        {
          id: "real",
          scheduleId: "s1",
          revisionId: "rev1",
          legId: "leg1",
          driverId: DAN,
          kind: "ARRIVE",
          at: at("01:31"),
          recordedByAccountId: DAN,
          location: null,
        },
      ],
    });
    const view = withSavedTaps(
      loaded,
      [saved({ path: "stop-taps", body: { legId: "leg1", kind: "ARRIVE", location: null, tappedAt: at("01:30") } })],
      DAN,
    );
    expect(view.stopTaps).toEqual(loaded.stopTaps);
  });

  it("adds End trip to a Start KOVA already has", () => {
    const loaded = data({
      attendance: [
        { id: "a1", scheduleId: "s1", revisionId: "rev1", driverId: DAN, start: { at: at("01:00"), recordedByAccountId: DAN, location: null } },
      ],
    });
    const view = withSavedTaps(loaded, [saved({ path: "attendance", body: { kind: "END", location: null, tappedAt: at("02:30") } })], DAN);
    expect(view.attendance[0].start.saved).toBeUndefined();
    expect(view.attendance[0].end).toEqual({ at: at("02:30"), recordedByAccountId: DAN, location: null, saved: true });
  });

  it("shows a Company trip's saved Start and End with the odometer", () => {
    const view = withSavedTaps(
      data(),
      [
        saved({ path: "company-run", body: { kind: "START", odometer: 48215, location: null, tappedAt: at("01:00") } }),
        saved({ path: "company-stops", body: { legId: "leg1", kind: "ARRIVE", location: null, tappedAt: at("01:20") } }),
        saved({ path: "company-run", body: { kind: "END", odometer: 48262, location: null, tappedAt: at("02:00") } }),
      ],
      DAN,
    );
    expect(view.companyRuns).toEqual([
      {
        id: expect.stringMatching(/^saved-/),
        scheduleId: "s1",
        revisionId: "rev1",
        startAt: at("01:00"),
        startOdometer: 48215,
        endAt: at("02:00"),
        endOdometer: 48262,
        saved: true,
      },
    ]);
    expect(view.stopTaps).toHaveLength(1);
  });

  it("shows only the signed-in account's saved taps", () => {
    const loaded = data();
    const theirs = saved({ path: "attendance", body: { kind: "START", location: null, tappedAt: at("01:00") } }, "someone-else");
    expect(withSavedTaps(loaded, [theirs], DAN)).toBe(loaded);
    expect(withSavedTaps(loaded, [theirs], undefined)).toBe(loaded);
  });
});
