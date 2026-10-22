import { describe, expect, it } from "vitest";
import { EMPTY_OVERLAY_DATA, OVERLAYS_VAR, checkOverlay, overlayData } from "../src/overlays";

const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });
const lineString = (coordinates: unknown) => ({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} });

describe("checkOverlay", () => {
  it("keeps lines, multi-lines and points, with their bounds", () => {
    const { overlay, problems } = checkOverlay("gps-track", {
      label: "ride.gpx",
      geojson: fc([
        lineString([[1, 1], [2, 2]]),
        { type: "Feature", geometry: { type: "MultiLineString", coordinates: [[[3, 3], [4, 4]], [[5, 5], [6, 6]]] } },
        { type: "Feature", geometry: { type: "Point", coordinates: [7, 0.5] } },
      ]),
    });
    expect(problems).toEqual([]);
    expect(overlay).toEqual({
      key: "gps-track",
      label: "ride.gpx",
      lines: [[[1, 1], [2, 2]], [[3, 3], [4, 4]], [[5, 5], [6, 6]]],
      points: [[7, 0.5]],
      bounds: { west: 1, south: 0.5, east: 7, north: 6 },
    });
  });

  it("drops geometry types it doesn't draw, silently", () => {
    const { overlay, problems } = checkOverlay("k", {
      label: "x",
      geojson: fc([{ type: "Feature", geometry: { type: "Polygon", coordinates: [] } }, lineString([[0, 0], [1, 1]])]),
    });
    expect(problems).toEqual([]);
    expect(overlay?.lines).toHaveLength(1);
  });

  it("drops features with bad coordinates and says which", () => {
    const { overlay, problems } = checkOverlay("k", {
      label: "x",
      geojson: fc([lineString([[0, 0]]), lineString([[0, 0], [200, 0]]), { type: "Feature", geometry: { type: "Point", coordinates: [0, Number.NaN] } }, { type: "Feature" }, lineString([[0, 0], [1, 1]])]),
    });
    expect(overlay?.lines).toEqual([[[0, 0], [1, 1]]]);
    expect(overlay?.points).toEqual([]);
    expect(problems).toEqual([
      "feature 0 has invalid coordinates",
      "feature 1 has invalid coordinates",
      "feature 2 has invalid coordinates",
      "feature 3 has no geometry",
    ]);
  });

  it("refuses an entry without a string label or a FeatureCollection", () => {
    expect(checkOverlay("k", { geojson: fc([]) })).toEqual({ overlay: null, problems: ["needs a string label"] });
    expect(checkOverlay("k", "nope")).toEqual({ overlay: null, problems: ["needs a string label"] });
    expect(checkOverlay("k", { label: "x", geojson: { type: "Feature" } })).toEqual({
      overlay: null,
      problems: ["geojson must be a FeatureCollection"],
    });
  });

  it("gives an empty overlay no bounds", () => {
    expect(checkOverlay("k", { label: "x", geojson: fc([]) }).overlay?.bounds).toBeNull();
  });

  it("handles a MultiLineString with 200,000 parts without throwing", () => {
    const parts = Array.from({ length: 200_000 }, (_, i) => [[0, i % 80], [1, i % 80]]);
    const { overlay, problems } = checkOverlay("k", {
      label: "x",
      geojson: fc([{ type: "Feature", geometry: { type: "MultiLineString", coordinates: parts } }]),
    });
    expect(problems).toEqual([]);
    expect(overlay?.lines).toHaveLength(200_000);
  });

  it("drops a MultiLineString with an empty slot as invalid coordinates", () => {
    // eslint-disable-next-line no-sparse-arrays -- the hole is the case under test
    const coordinates = [, [[0, 0], [1, 1]]];
    const { overlay, problems } = checkOverlay("k", {
      label: "x",
      geojson: fc([{ type: "Feature", geometry: { type: "MultiLineString", coordinates } }]),
    });
    expect(overlay?.lines).toEqual([]);
    expect(problems).toEqual(["feature 0 has invalid coordinates"]);
  });
});

describe("overlayData", () => {
  it("flattens every overlay into one line and one point collection", () => {
    const a = checkOverlay("a", { label: "a", geojson: fc([lineString([[0, 0], [1, 1]])]) }).overlay!;
    const b = checkOverlay("b", { label: "b", geojson: fc([{ type: "Feature", geometry: { type: "Point", coordinates: [2, 2] } }]) }).overlay!;
    const d = overlayData([a, b]);
    expect(d.lines.features).toEqual([{ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: {} }]);
    expect(d.points.features).toEqual([{ type: "Feature", geometry: { type: "Point", coordinates: [2, 2] }, properties: {} }]);
    expect(overlayData([])).toBe(EMPTY_OVERLAY_DATA);
    expect(OVERLAYS_VAR).toBe("map.overlays");
  });
});
