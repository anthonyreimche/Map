import { describe, expect, it } from "vitest";
import {
  boundsFromMap,
  boundsOf,
  hasLocation,
  inBounds,
  locationOf,
  photoFeatures,
  wrapLon,
} from "../src/geo";
import { located, photo } from "./harness";

describe("locationOf / hasLocation", () => {
  it("reads a valid fix", () => {
    expect(locationOf(located("a", 48.85, 2.35))).toEqual({ lon: 2.35, lat: 48.85 });
    expect(hasLocation(located("a", 48.85, 2.35))).toBe(true);
  });

  it("rejects missing, non-finite and out-of-range coordinates", () => {
    expect(locationOf(photo({ id: "a" }))).toBeNull();
    expect(locationOf(photo({ id: "a", exif: { gpsLatitude: 10 } }))).toBeNull();
    expect(locationOf(located("a", Number.NaN, 0))).toBeNull();
    expect(locationOf(located("a", 91, 0))).toBeNull();
    expect(locationOf(located("a", 0, 181))).toBeNull();
    expect(hasLocation(located("a", 0, -181))).toBe(false);
  });

  it("accepts the origin and the poles", () => {
    expect(hasLocation(located("a", 0, 0))).toBe(true);
    expect(hasLocation(located("a", -90, 180))).toBe(true);
  });
});

describe("inBounds", () => {
  const box = { west: -10, south: 40, east: 10, north: 50 };

  it("tests latitude and longitude", () => {
    expect(inBounds({ lon: 0, lat: 45 }, box)).toBe(true);
    expect(inBounds({ lon: 11, lat: 45 }, box)).toBe(false);
    expect(inBounds({ lon: 0, lat: 51 }, box)).toBe(false);
  });

  it("handles a box across the antimeridian", () => {
    const dateline = { west: 170, south: -10, east: -170, north: 10 };
    expect(inBounds({ lon: 175, lat: 0 }, dateline)).toBe(true);
    expect(inBounds({ lon: -175, lat: 0 }, dateline)).toBe(true);
    expect(inBounds({ lon: 0, lat: 0 }, dateline)).toBe(false);
  });
});

describe("wrapLon / boundsFromMap", () => {
  it("wraps longitudes into [-180, 180)", () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(540)).toBe(-180);
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(0)).toBe(0);
  });

  it("returns a longitude already in range exactly as it is", () => {
    for (const lon of [2.35, -73.9857, 179.99, -180]) expect(wrapLon(lon)).toBe(lon);
  });

  it("covers the whole world once the map shows 360° or more", () => {
    expect(boundsFromMap(-200, -30, 200, 30)).toEqual({ west: -180, south: -30, east: 180, north: 30 });
  });

  it("wraps a view that straddles the antimeridian", () => {
    expect(boundsFromMap(170, -10, 190, 10)).toEqual({ west: 170, south: -10, east: -170, north: 10 });
  });

  it("clamps latitude", () => {
    expect(boundsFromMap(0, -95, 1, 95)).toEqual({ west: 0, south: -90, east: 1, north: 90 });
  });
});

describe("boundsOf", () => {
  it("is null for no points", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("spans the points", () => {
    expect(boundsOf([{ lon: 1, lat: 2 }, { lon: -3, lat: 5 }])).toEqual({ west: -3, south: 2, east: 1, north: 5 });
  });

  it("pads a single point so fitBounds has an area", () => {
    const b = boundsOf([{ lon: 0, lat: 0 }])!;
    expect(b.east - b.west).toBeGreaterThan(0);
    expect(b.north - b.south).toBeGreaterThan(0);
  });
});

describe("photoFeatures", () => {
  it("emits one point per located photo, carrying id and icon", () => {
    const fc = photoFeatures([located("a", 1, 2), photo({ id: "b" }), located("c", 3, 4)], (id) => `pin:${id}`);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.map((f) => f.properties)).toEqual([
      { id: "a", icon: "pin:a" },
      { id: "c", icon: "pin:c" },
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([2, 1]);
  });
});
