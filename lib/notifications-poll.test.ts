import { describe, expect, it, vi } from "vitest";
import { renewDelay } from "./notifications-live";
import { LIVE_NOTIFICATION_POLL_MS, NOTIFICATION_POLL_MS, pollDue } from "./notifications-poll";

vi.mock("@/lib/kova-api", () => ({ refreshNotifications: vi.fn() }));

describe("pollDue", () => {
  const start = 1_000_000;

  it("checks every 5 minutes while Realtime is down", () => {
    expect(pollDue(false, start, start + NOTIFICATION_POLL_MS - 1)).toBe(false);
    expect(pollDue(false, start, start + NOTIFICATION_POLL_MS)).toBe(true);
  });

  it("checks every 15 minutes while Realtime works", () => {
    expect(pollDue(true, start, start + NOTIFICATION_POLL_MS)).toBe(false);
    expect(pollDue(true, start, start + LIVE_NOTIFICATION_POLL_MS)).toBe(true);
  });
});

describe("renewDelay", () => {
  const now = 1_700_000_000_000;

  it("renews a minute before the token expires", () => {
    expect(renewDelay(now / 1000 + 3600, now)).toBe(3_540_000);
  });

  it("waits a minute when the token is about to expire or already has", () => {
    expect(renewDelay(now / 1000 + 30, now)).toBe(60_000);
    expect(renewDelay(now / 1000 - 3600, now)).toBe(60_000);
  });
});
