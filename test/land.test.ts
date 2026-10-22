import { describe, expect, it } from "vitest";
import { LAND_110M } from "../src/land-110m";

describe("LAND_110M", () => {
  it("holds Natural Earth's 110m land rings as closed lon/lat pairs in range", () => {
    expect(LAND_110M.length).toBe(128);
    for (const ring of LAND_110M) {
      expect(ring.length % 2).toBe(0);
      expect(ring.length).toBeGreaterThanOrEqual(8);
      expect([ring[0], ring[1]]).toEqual([ring[ring.length - 2], ring[ring.length - 1]]);
      for (let i = 0; i < ring.length; i += 2) {
        expect(Math.abs(ring[i])).toBeLessThanOrEqual(18_000);
        expect(Math.abs(ring[i + 1])).toBeLessThanOrEqual(9_000);
      }
    }
  });
});
