/**
 * Approximate street addresses for attendance taps, from OpenStreetMap's
 * free Nominatim service (no key). Server-only: called once per tap from
 * the attendance route, never from the browser, which keeps within
 * Nominatim's usage policy (at most 1 request a second, an identifying
 * User-Agent, credit to OpenStreetMap where the address is shown).
 */

/** The `address` part of a Nominatim reverse lookup; only the fields KOVA uses. */
export type NominatimAddress = Partial<
  Record<
    | "road"
    | "hamlet"
    | "neighbourhood"
    | "quarter"
    | "suburb"
    | "village"
    | "town"
    | "city"
    | "municipality"
    | "county"
    | "state"
    | "province",
    string
  >
>;

/**
 * A short address, smallest place first, e.g. "Rizal St, Mabato, Anonang,
 * Pangasinan": the road, the sitio or neighbourhood, the barangay, the town
 * and the province, skipping what's missing or repeated. Null when nothing
 * useful is there.
 */
export function shortAddress(address: NominatimAddress | undefined): string | null {
  if (!address) return null;
  const parts = [
    address.road,
    address.hamlet ?? address.neighbourhood ?? address.quarter,
    address.suburb ?? address.village,
    address.town ?? address.city ?? address.municipality,
    address.province ?? address.state ?? address.county,
  ];
  const seen = new Set<string>();
  const kept = parts.filter((part): part is string => {
    const key = part?.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return kept.length ? kept.map((part) => part.trim()).join(", ") : null;
}

/**
 * Looks up an approximate address for a position. Resolves to null instead
 * of failing (slow service, no network, nothing there), so a tap is never
 * held up for more than `timeoutMs` and is saved without an address instead.
 */
export async function reverseGeocode(lat: number, lng: number, timeoutMs = 4000): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    zoom: "18",
    addressdetails: "1",
    "accept-language": "en",
  }).toString();
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "KOVA fleet scheduling (https://kc-kova.vercel.app)" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { address?: NominatimAddress };
    return shortAddress(body.address);
  } catch {
    return null;
  }
}
