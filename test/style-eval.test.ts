import { describe, expect, it } from "vitest";
import { NEUTRAL_TOKENS, palette } from "../src/palette";
import { overlayLineLayerSpec, overlayPointLayerSpec, photoLayerSpecs, selectionFilter } from "../src/map-layers";
import { evaluate, passes } from "../src/style-eval";

const cluster = { cluster: true, cluster_id: 33, point_count: 12, point_count_abbreviated: "12" };
const pin = { id: "a", icon: "pin:a" };

describe("style-eval", () => {
  it("reads properties", () => {
    expect(evaluate(["get", "icon"], pin)).toBe("pin:a");
    expect(evaluate(["get", "missing"], pin)).toBeNull();
    expect(evaluate(["has", "point_count"], cluster)).toBe(true);
    expect(evaluate(["!", ["has", "point_count"]], pin)).toBe(true);
    expect(evaluate(7, pin)).toBe(7);
  });

  it("steps through stops", () => {
    const radius = ["step", ["get", "point_count"], 16, 10, 20, 100, 26];
    expect(evaluate(radius, { point_count: 2 })).toBe(16);
    expect(evaluate(radius, { point_count: 10 })).toBe(20);
    expect(evaluate(radius, { point_count: 500 })).toBe(26);
  });

  it("matches a value against single labels and label lists", () => {
    expect(evaluate(["match", ["get", "id"], ["a", "b"], true, false], pin)).toBe(true);
    expect(evaluate(["match", ["get", "id"], "x", 1, "a", 2, 0], pin)).toBe(2);
    expect(evaluate(["match", ["get", "id"], ["x"], true, false], pin)).toBe(false);
  });

  it("treats a boolean as a constant filter", () => {
    expect(passes(true, pin)).toBe(true);
    expect(passes(false, pin)).toBe(false);
    expect(passes(undefined, pin)).toBe(true);
    expect(passes(selectionFilter(["a"]), pin)).toBe(true);
    expect(passes(selectionFilter([]), pin)).toBe(false);
  });

  it("refuses an operator it does not know, so a new spec cannot draw wrong unnoticed", () => {
    expect(() => evaluate(["interpolate", ["linear"], ["zoom"], 1, 2], pin)).toThrow(/interpolate/);
  });

  it("covers every expression in the photo and overlay layers", () => {
    const p = palette(NEUTRAL_TOKENS);
    for (const spec of [...photoLayerSpecs(p, true), ...photoLayerSpecs(p, false), overlayLineLayerSpec(p), overlayPointLayerSpec(p)]) {
      // text-font is a literal font stack, never an expression.
      const { "text-font": _fontStack, ...layout } = spec.layout ?? {};
      for (const props of [cluster, pin]) {
        expect(() => passes(spec.filter, props)).not.toThrow();
        for (const v of [...Object.values(spec.paint ?? {}), ...Object.values(layout)]) expect(() => evaluate(v, props)).not.toThrow();
      }
    }
  });
});
