import { describe, expect, it } from "vitest";
import { parsePushEndpointInput, parsePushSubscriptionInput } from "@/lib/push-input";

const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";

describe("parsePushSubscriptionInput", () => {
  it("keeps the endpoint and keys of a browser subscription", () => {
    expect(
      parsePushSubscriptionInput({ endpoint, expirationTime: null, keys: { p256dh: "BNc", auth: "tBH" } }),
    ).toEqual({ endpoint, p256dh: "BNc", auth: "tBH" });
  });

  it("refuses a missing key or a plain-http endpoint", () => {
    expect(parsePushSubscriptionInput({ endpoint, keys: { p256dh: "BNc" } })).toBeNull();
    expect(parsePushSubscriptionInput({ endpoint: "http://push.test/x", keys: { p256dh: "BNc", auth: "tBH" } })).toBeNull();
    expect(parsePushSubscriptionInput(null)).toBeNull();
  });
});

describe("parsePushEndpointInput", () => {
  it("keeps the endpoint, or refuses a bad one", () => {
    expect(parsePushEndpointInput({ endpoint })).toBe(endpoint);
    expect(parsePushEndpointInput({ endpoint: "nope" })).toBeNull();
  });
});
