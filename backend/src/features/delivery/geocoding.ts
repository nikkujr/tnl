import { HttpError } from "../../shared/http.js";
export async function searchPlaces(
  query: string,
  key: string,
  request = fetch,
) {
  if (!key)
    throw new HttpError(
      503,
      "Place search is unavailable. Use the map or coordinates instead.",
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
      results?: Array<{ lat: number; lon: number; formatted: string }>;
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
      .slice(0, 5)
      .map((p) => ({ latitude: p.lat, longitude: p.lon, label: p.formatted }));
  } catch {
    throw new HttpError(
      502,
      "Place search could not be reached. Try again or use the map.",
    );
  }
}
