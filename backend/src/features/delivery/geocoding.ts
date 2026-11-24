import { HttpError } from "../../shared/http.js";

interface GeocodedPlace {
  lat: number;
  lon: number;
  formatted: string;
  street?: string;
  housenumber?: string;
  suburb?: string;
  city?: string;
  county?: string;
  state?: string;
  postcode?: string;
}

async function geocode(
  query: string,
  key: string,
  request: typeof fetch,
  manualHint: string,
) {
  if (!key)
    throw new HttpError(
      503,
      `Place search is unavailable. ${manualHint}`,
    );
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.search = new URLSearchParams({
    text: query,
    format: "json",
    limit: "5",
    filter: "countrycode:ph",
    apiKey: key,
  }).toString();
  try {
    const response = await request(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Provider unavailable");
    const payload = (await response.json()) as {
      results?: GeocodedPlace[];
    };
    if (!Array.isArray(payload.results))
      throw new Error("Invalid provider response");
    return payload.results
      .filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Math.abs(p.lat) <= 90 &&
          Number.isFinite(p.lon) &&
          Math.abs(p.lon) <= 180 &&
          typeof p.formatted === "string" &&
          p.formatted.length > 0,
      )
      .slice(0, 5);
  } catch {
    throw new HttpError(
      502,
      `Place search could not be reached. ${manualHint}`,
    );
  }
}

export async function searchPlaces(query: string, key: string, request = fetch) {
  const places = await geocode(query, key, request, "Use the map or coordinates instead.");
  return places.map((p) => ({ latitude: p.lat, longitude: p.lon, label: p.formatted }));
}

function addressText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export async function searchAddresses(query: string, key: string, request = fetch) {
  const places = await geocode(query, key, request, "Enter the address manually or try again.");
  return places.map((p) => ({
    label: p.formatted,
    parts: {
      street: addressText([addressText(p.housenumber, 30), addressText(p.street, 180)].filter(Boolean).join(" "), 180),
      barangay: addressText(p.suburb, 90),
      city: addressText(p.city, 90),
      province: addressText(p.state, 90) || addressText(p.county, 90),
      postalCode: addressText(p.postcode, 10),
    },
  }));
}
