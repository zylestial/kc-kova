import { describe, expect, it } from "vitest";
import { catchUpMessages, deviceGone, pushMessage } from "@/lib/push-message";

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

describe("catchUpMessages", () => {
  const unread = (id: string, createdAt: string) => ({
    id,
    type: "REQUEST_SCHEDULED" as const,
    message: `Scheduled ${id}`,
    relatedRequestId: id,
    createdAt,
  });

  it("shows up to three, oldest first", () => {
    const messages = catchUpMessages(
      [unread("b", "2026-10-19T09:00:00Z"), unread("a", "2026-10-19T08:00:00Z")],
      noSchedule,
      "Requester",
    );
    expect(messages.map((message) => message.body)).toEqual(["Scheduled a", "Scheduled b"]);
    expect(messages[0].url).toBe("/requests?open=a");
  });

  it("sums up more than three in one", () => {
    const four = ["a", "b", "c", "d"].map((id) => unread(id, "2026-10-19T08:00:00Z"));
    expect(catchUpMessages(four, noSchedule, "Requester")).toEqual([
      { title: "KOVA", body: "You have 4 new notifications.", url: "/home", tag: "catch-up" },
    ]);
  });

  it("shows nothing when nothing came", () => {
    expect(catchUpMessages([], noSchedule, "Requester")).toEqual([]);
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
