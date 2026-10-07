import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPhoneLocation } from "@/lib/phone-location";

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

let onReading: Success;
let onError: Failure;
const clearWatch = vi.fn();

const reading = (accuracy: number, lat = 16.1, lng = 120.4) =>
  ({ coords: { latitude: lat, longitude: lng, accuracy } }) as GeolocationPosition;
const denied = { code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError;
const unavailable = { code: 2, PERMISSION_DENIED: 1 } as GeolocationPositionError;

beforeEach(() => {
  vi.useFakeTimers();
  clearWatch.mockReset();
  vi.stubGlobal("navigator", {
    geolocation: {
      watchPosition: (success: Success, failure: Failure) => {
        onReading = success;
        onError = failure;
        return 7;
      },
      clearWatch,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getPhoneLocation", () => {
  it("stops at the first reading that is accurate enough", async () => {
    const result = getPhoneLocation();
    onReading(reading(30));
    expect(await result).toEqual({ lat: 16.1, lng: 120.4, accuracyM: 30 });
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it("keeps the most accurate rough reading until the wait is over", async () => {
    const result = getPhoneLocation(10000);
    onReading(reading(400, 1, 1));
    onReading(reading(120, 2, 2));
    onReading(reading(300, 3, 3));
    vi.advanceTimersByTime(10000);
    expect(await result).toEqual({ lat: 2, lng: 2, accuracyM: 120 });
  });

  it("gives null when permission is denied", async () => {
    const result = getPhoneLocation();
    onError(denied);
    expect(await result).toBeNull();
  });

  it("keeps waiting through a missing fix, then gives what it has", async () => {
    const result = getPhoneLocation(10000);
    onError(unavailable);
    onReading(reading(200));
    vi.advanceTimersByTime(10000);
    expect((await result)?.accuracyM).toBe(200);
  });

  it("gives null with no location support", async () => {
    vi.stubGlobal("navigator", {});
    expect(await getPhoneLocation()).toBeNull();
  });
});
