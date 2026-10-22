import { describe, expect, it } from "vitest";
import { MAX_LAT, constrain, fitCamera, fromUnit, toUnit, unitAt, worldSize } from "../src/mercator";

describe("mercator", () => {
  it("uses MapLibre's world size, 512 px at zoom 0", () => {
    expect(worldSize(0)).toBe(512);
    expect(worldSize(3)).toBe(4096);
  });

  it("maps the world onto the unit square, north up", () => {
    expect(toUnit({ lon: -180, lat: 0 })).toEqual({ x: 0, y: 0.5 });
    expect(toUnit({ lon: 180, lat: 0 }).x).toBe(1);
    expect(toUnit({ lon: 0, lat: MAX_LAT }).y).toBeCloseTo(0, 6);
    expect(toUnit({ lon: 0, lat: -MAX_LAT }).y).toBeCloseTo(1, 6);
    expect(toUnit({ lon: 0, lat: 45 }).y).toBeLessThan(0.5);
  });

  it("round-trips a position", () => {
    const paris = fromUnit(toUnit({ lon: 2.2945, lat: 48.8584 }));
    expect(paris.lon).toBeCloseTo(2.2945, 9);
    expect(paris.lat).toBeCloseTo(48.8584, 9);
  });

  it("clamps the poles to the Mercator limit", () => {
    expect(toUnit({ lon: 0, lat: -90 })).toEqual(toUnit({ lon: 0, lat: -MAX_LAT }));
  });

  it("reads a longitude past ±180 off a world copy", () => {
    expect(fromUnit({ x: 1.25, y: 0.5 }).lon).toBeCloseTo(270, 9);
  });

  it("finds the unit point under a screen point", () => {
    const cam = { center: { x: 0.5, y: 0.5 }, zoom: 1, width: 800, height: 600 };
    expect(unitAt(cam, 400, 300)).toEqual({ x: 0.5, y: 0.5 });
    expect(unitAt(cam, 400 + 1024 / 4, 300)).toEqual({ x: 0.75, y: 0.5 });
  });

  it("fits bounds inside the padded box, centred, capped at the zoom limit", () => {
    const b = { west: 2.2, south: 48.8, east: 2.4, north: 48.9 };
    const cam = fitCamera(b, 800, 600, 48, 16);
    const box = { nw: unitAt(cam, 48, 48), se: unitAt(cam, 800 - 48, 600 - 48) };
    const nw = toUnit({ lon: b.west, lat: b.north });
    const se = toUnit({ lon: b.east, lat: b.south });
    expect(nw.x).toBeGreaterThanOrEqual(box.nw.x - 1e-9);
    expect(nw.y).toBeGreaterThanOrEqual(box.nw.y - 1e-9);
    expect(se.x).toBeLessThanOrEqual(box.se.x + 1e-9);
    expect(se.y).toBeLessThanOrEqual(box.se.y + 1e-9);
    const c = fromUnit(cam.center);
    expect(c.lon).toBeCloseTo(2.3, 9);
    expect(fitCamera({ west: 2.29, south: 48.85, east: 2.29, north: 48.85 }, 800, 600, 48, 16).zoom).toBe(16);
  });

  it("keeps the view on the world: no sky past the poles once the world is taller than the view", () => {
    const top = constrain({ center: { x: 0.5, y: 0 }, zoom: 2, width: 800, height: 600 });
    expect(unitAt(top, 0, 0).y).toBeCloseTo(0, 9);
    const small = constrain({ center: { x: 0.5, y: 0.1 }, zoom: 0, width: 800, height: 600 });
    expect(small.center.y).toBe(0.5);
  });

  it("wraps the centre back onto the first world, and clamps the zoom", () => {
    const cam = constrain({ center: { x: 1.25, y: 0.5 }, zoom: 30, width: 800, height: 600 });
    expect(cam.center.x).toBeCloseTo(0.25, 9);
    expect(cam.zoom).toBe(22);
    expect(constrain({ center: { x: 0.5, y: 0.5 }, zoom: -3, width: 800, height: 600 }).zoom).toBe(0);
  });
});
