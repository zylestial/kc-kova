import { afterEach, describe, expect, it, vi } from "vitest";
import { reverseGeocode, shortAddress } from "@/lib/reverse-geocode";

describe("shortAddress", () => {
  it("keeps the sitio, barangay and province, as at ANONANG", () => {
    expect(shortAddress({ hamlet: "Mabato", village: "Anonang", state: "Pangasinan" })).toBe("Mabato, Anonang, Pangasinan");
  });

  it("puts the road first and the town before the province", () => {
    expect(shortAddress({ road: "Rizal Street", village: "Bolaoen", town: "Bugallon", province: "Pangasinan", state: "Ilocos Region" })).toBe(
      "Rizal Street, Bolaoen, Bugallon, Pangasinan",
    );
  });

  it("skips repeated names and blanks", () => {
    expect(shortAddress({ road: " ", village: "San Jose", city: "San Jose", state: "Nueva Ecija" })).toBe("San Jose, Nueva Ecija");
  });

  it("is null when there is nothing to show", () => {
    expect(shortAddress(undefined)).toBeNull();
    expect(shortAddress({})).toBeNull();
  });
});

describe("reverseGeocode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks Nominatim for the position and shortens the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ address: { hamlet: "Mabato", village: "Anonang", state: "Pangasinan" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await reverseGeocode(16.103769, 120.436222)).toBe("Mabato, Anonang, Pangasinan");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("lat")).toBe("16.103769");
    expect(url.searchParams.get("lon")).toBe("120.436222");
  });

  it("gives null instead of failing when the service errors or can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("busy", { status: 503 })));
    expect(await reverseGeocode(1, 2)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await reverseGeocode(1, 2)).toBeNull();
  });
});
