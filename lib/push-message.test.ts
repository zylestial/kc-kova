import { describe, expect, it } from "vitest";
import { catchUpMessages, deviceGone, pushFailure, pushMessage, vapidSubject } from "@/lib/push-message";

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

describe("vapidSubject", () => {
  const fallback = "https://kova.test";

  it("keeps a good subject", () => {
    expect(vapidSubject("https://kc-kova.vercel.app", fallback)).toBe("https://kc-kova.vercel.app");
    expect(vapidSubject("mailto:ops@kayelen.com", fallback)).toBe("mailto:ops@kayelen.com");
  });

  it("tidies what Apple would refuse", () => {
    expect(vapidSubject("  mailto: ops@kayelen.com ", fallback)).toBe("mailto:ops@kayelen.com");
    expect(vapidSubject("mailto:mailto:ops@kayelen.com", fallback)).toBe("mailto:ops@kayelen.com");
    expect(vapidSubject('"ops@kayelen.com"', fallback)).toBe("mailto:ops@kayelen.com");
  });

  it("falls back when there's nothing usable", () => {
    expect(vapidSubject(undefined, fallback)).toBe(fallback);
    expect(vapidSubject("mailto:", fallback)).toBe(fallback);
    expect(vapidSubject("kayelen", fallback)).toBe(fallback);
  });
});

describe("pushFailure", () => {
  it("names the status, the reply and the service", () => {
    expect(
      pushFailure({ statusCode: 403, body: '{"reason":"BadJwtToken"}\n', message: "Received unexpected response code" }, "https://web.push.apple.com/abc"),
    ).toBe('403 from web.push.apple.com: {"reason":"BadJwtToken"}');
  });

  it("still says something for a network error", () => {
    expect(pushFailure(new Error("socket hang up"), "https://fcm.googleapis.com/fcm/send/x")).toBe(
      "no status from fcm.googleapis.com: socket hang up",
    );
  });
});
