import { describe, expect, it } from "vitest";
import {
  LAYER_CLUSTERS,
  LAYER_PINS,
  LAYER_RING,
  LAYER_TRACK,
  OUR_LAYER_IDS,
  PHOTO_SOURCE,
  TRACK_SOURCE,
  keepPhotoLayers,
  photoLayerSpecs,
  photoSourceSpec,
  selectionFilter,
} from "../src/map-layers";
import { NEUTRAL_TOKENS, palette } from "../src/palette";
import { buildStyle } from "../src/style";

const p = palette(NEUTRAL_TOKENS);

describe("specs", () => {
  it("clusters the photo source at the given radius", () => {
    expect(photoSourceSpec({ type: "FeatureCollection", features: [] }, 55)).toMatchObject({ type: "geojson", cluster: true, clusterRadius: 55 });
  });

  it("draws thumbnail pins as symbols and plain pins as circles", () => {
    const symbol = photoLayerSpecs(p, true).find((l) => l.id === LAYER_PINS);
    const circle = photoLayerSpecs(p, false).find((l) => l.id === LAYER_PINS);
    expect(symbol?.type).toBe("symbol");
    expect(symbol?.layout?.["icon-image"]).toEqual(["get", "icon"]);
    expect(circle?.type).toBe("circle");
  });

  it("orders the ring under the pins and every layer above the basemap", () => {
    const ids = photoLayerSpecs(p, true).map((l) => l.id);
    expect(ids.indexOf(LAYER_RING)).toBeLessThan(ids.indexOf(LAYER_PINS));
    expect(ids.indexOf(LAYER_CLUSTERS)).toBeLessThan(ids.indexOf(LAYER_PINS));
    for (const id of ids) expect(OUR_LAYER_IDS).toContain(id);
  });

  it("filters the ring to the selected ids, and to nothing for an empty selection", () => {
    expect(selectionFilter(["a", "b"])).toEqual(["match", ["get", "id"], ["a", "b"], true, false]);
    expect(selectionFilter([])).toBe(false);
    expect(photoLayerSpecs(p, true).find((l) => l.id === LAYER_RING)?.filter).toBe(false);
  });
});

describe("keepPhotoLayers", () => {
  it("carries the photo and track sources and layers into a new basemap", () => {
    const prev = {
      ...buildStyle(p),
      sources: { ...buildStyle(p).sources, [PHOTO_SOURCE]: { type: "geojson", data: { n: 1 } }, [TRACK_SOURCE]: { type: "geojson", data: {} } },
      layers: [...buildStyle(p).layers, { id: LAYER_TRACK }, { id: LAYER_PINS }],
    };
    const next = buildStyle(p, "https://other.test");
    const out = keepPhotoLayers(prev, next);
    expect(out.sources[PHOTO_SOURCE]).toEqual({ type: "geojson", data: { n: 1 } });
    expect(out.layers.map((l) => l.id).slice(-2)).toEqual([LAYER_TRACK, LAYER_PINS]);
    expect(Object.keys(out.sources)).toContain("openmaptiles");
  });

  it("returns the new style untouched when there is no previous style", () => {
    const next = buildStyle(p);
    expect(keepPhotoLayers(undefined, next)).toBe(next);
  });
});
