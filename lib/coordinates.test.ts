import { describe, expect, it } from "vitest";
import { parseCoordinates } from "@/lib/coordinates";

describe("parseCoordinates", () => {
  it("reads plain coordinates, with a comma or a space", () => {
    expect(parseCoordinates("16.103769, 120.436222")).toEqual({ lat: 16.103769, lng: 120.436222 });
    expect(parseCoordinates("  16.1037 120.4362 ")).toEqual({ lat: 16.1037, lng: 120.4362 });
    expect(parseCoordinates("-33.86,151.2")).toEqual({ lat: -33.86, lng: 151.2 });
  });

  it("reads the pin from a Google Maps place link, not the map centre", () => {
    expect(
      parseCoordinates("https://www.google.com/maps/place/X/@16.10,120.43,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d16.103769!4d120.436222"),
    ).toEqual({ lat: 16.103769, lng: 120.436222 });
  });

  it("reads q= links and @ links", () => {
    expect(parseCoordinates("https://www.google.com/maps?q=16.103769,120.436222")).toEqual({ lat: 16.103769, lng: 120.436222 });
    expect(parseCoordinates("https://www.google.com/maps/search/?api=1&query=16.1%2C120.4")).toEqual({ lat: 16.1, lng: 120.4 });
    expect(parseCoordinates("https://www.google.com/maps/@16.103769,120.436222,15z")).toEqual({ lat: 16.103769, lng: 120.436222 });
  });

  it("treats blank as none", () => {
    expect(parseCoordinates("")).toBeNull();
    expect(parseCoordinates("   ")).toBeNull();
  });

  it("rejects out-of-range, short links and text", () => {
    expect(parseCoordinates("95, 120")).toBe("invalid");
    expect(parseCoordinates("16, 190")).toBe("invalid");
    expect(parseCoordinates("https://maps.app.goo.gl/abc123")).toBe("invalid");
    expect(parseCoordinates("Anonang")).toBe("invalid");
    expect(parseCoordinates("16.1,%E0%A4%A")).toBe("invalid");
  });
});
