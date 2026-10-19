import { describe, expect, it } from "vitest";
import { deviceGone, pushMessage } from "@/lib/push-message";

const noSchedule = () => undefined;

describe("pushMessage", () => {
  it("carries the bell's text and opens where the bell would", () => {
    expect(
      pushMessage({ id: "n1", type: "TRIP_PUBLISHED", message: "A trip was published", relatedScheduleId: "s1" }, noSchedule, "Driver"),
    ).toEqual({ title: "KOVA", body: "A trip was published", url: "/my-schedule?open=s1", tag: "n1" });
  });

  it("opens Home when the type has no page", () => {
    expect(pushMessage({ id: "n2", type: "UNKNOWN" as never, message: "Hi" }, noSchedule, "Admin").url).toBe("/home");
  });
});

describe("deviceGone", () => {
  it("is true only for a device the push service says is gone", () => {
    expect(deviceGone(410)).toBe(true);
    expect(deviceGone(404)).toBe(true);
    expect(deviceGone(429)).toBe(false);
    expect(deviceGone(undefined)).toBe(false);
  });
});
