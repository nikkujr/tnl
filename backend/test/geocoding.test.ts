import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPlaces } from "../src/features/delivery/geocoding.js";
test("place search bounds and normalizes provider results without exposing the key", async () => {
  const places = await searchPlaces(
    "San Pablo & Laguna",
    "test-key",
    async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.geoapify.com");
      assert.equal(url.searchParams.get("text"), "San Pablo & Laguna");
      assert.equal(url.searchParams.get("filter"), "countrycode:ph");
      assert.equal(url.searchParams.get("limit"), "5");
      assert(init?.signal);
      return Response.json({
        results: [
          {
            lat: 14.07,
            lon: 121.32,
            formatted: "San Pablo, Laguna, Philippines",
          },
          { lat: 100, lon: 121, formatted: "Invalid" },
          { lat: 1, lon: 1 },
        ],
      });
    },
  );
  assert.deepEqual(places, [
    {
      latitude: 14.07,
      longitude: 121.32,
      label: "San Pablo, Laguna, Philippines",
    },
  ]);
  assert.deepEqual(
    await searchPlaces("No match", "test-key", async () =>
      Response.json({ results: [] }),
    ),
    [],
  );
});
test("place search returns safe errors for missing keys and provider failures", async () => {
  await assert.rejects(
    searchPlaces("San Pablo", "", async () => {
      throw new Error("Must not call provider");
    }),
    { status: 503 },
  );
  for (const request of [
    async () => new Response("secret provider error", { status: 429 }),
    async () => Response.json({ invalid: true }),
    async () => {
      throw new Error("apiKey=test-key");
    },
  ]) {
    await assert.rejects(
      searchPlaces("San Pablo", "test-key", request),
      (error: any) =>
        error.status === 502 && !error.message.includes("test-key"),
    );
  }
});
