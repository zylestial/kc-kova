export type Coordinates = { lat: number; lng: number };

const NUMBER = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
// Most specific first: a Google Maps place link carries the pin as
// !3d<lat>!4d<lng>, and its @<lat>,<lng> is the map's centre, not the pin.
const PATTERNS = [
  new RegExp(String.raw`!3d${NUMBER}!4d${NUMBER}`),
  new RegExp(String.raw`[?&](?:q|query|ll|destination)=${NUMBER},\s*${NUMBER}`),
  new RegExp(String.raw`@${NUMBER},${NUMBER}`),
  new RegExp(String.raw`^\s*${NUMBER}\s*[,\s]\s*${NUMBER}\s*$`),
];

/**
 * Reads a position from what an Admin pastes: "16.103769, 120.436222" (what
 * Google Maps copies on a right-click) or a full Google Maps link. Blank is
 * "none" (null); anything else unreadable or out of range is "invalid".
 * Short links (maps.app.goo.gl) don't carry the position, so they're invalid.
 */
export function parseCoordinates(text: string): Coordinates | null | "invalid" {
  let value = text.trim();
  if (!value) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    return "invalid";
  }
  for (const pattern of PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return "invalid";
    return { lat, lng };
  }
  return "invalid";
}
