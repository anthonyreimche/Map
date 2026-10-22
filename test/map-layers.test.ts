import { describe, expect, it } from "vitest";
import {
  LAYER_CLUSTERS,
  LAYER_CLUSTER_COUNT,
  LAYER_OVERLAY_LINE,
  LAYER_OVERLAY_POINT,
  LAYER_PINS,
  LAYER_RING,
  OUR_LAYER_IDS,
  OUR_SOURCE_IDS,
  OVERLAY_LINE_SOURCE,
  OVERLAY_POINT_SOURCE,
  PHOTO_COUNT_SOURCE,
  PHOTO_SOURCE,
  keepPhotoLayers,
  overlayLineLayerSpec,
  overlayPointLayerSpec,
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

  it("counts clusters from their own source, so no pin waits on the label font", () => {
    const layers = photoLayerSpecs(p, true);
    expect(layers.find((l) => l.id === LAYER_CLUSTER_COUNT)?.source).toBe(PHOTO_COUNT_SOURCE);
    for (const l of layers.filter((l) => l.id !== LAYER_CLUSTER_COUNT)) expect(l.source).toBe(PHOTO_SOURCE);
    expect(OUR_SOURCE_IDS).toEqual([PHOTO_SOURCE, PHOTO_COUNT_SOURCE, OVERLAY_LINE_SOURCE, OVERLAY_POINT_SOURCE]);
  });

  it("filters the ring to the selected ids, and to nothing for an empty selection", () => {
    expect(selectionFilter(["a", "b"])).toEqual(["match", ["get", "id"], ["a", "b"], true, false]);
    expect(selectionFilter([])).toBe(false);
    expect(photoLayerSpecs(p, true).find((l) => l.id === LAYER_RING)?.filter).toBe(false);
  });
});

describe("overlay layers", () => {
  it("draw lines and points in the palette's overlay colour, below the pins", () => {
    expect(overlayLineLayerSpec(p)).toMatchObject({ id: LAYER_OVERLAY_LINE, type: "line", source: OVERLAY_LINE_SOURCE, paint: { "line-color": p.overlay } });
    expect(overlayPointLayerSpec(p)).toMatchObject({ id: LAYER_OVERLAY_POINT, type: "circle", source: OVERLAY_POINT_SOURCE, paint: { "circle-color": p.overlay } });
    expect(OUR_LAYER_IDS.indexOf(LAYER_OVERLAY_POINT)).toBeLessThan(OUR_LAYER_IDS.indexOf(LAYER_CLUSTERS));
  });
});

describe("keepPhotoLayers", () => {
  it("carries the photo and overlay sources and layers into a new basemap", () => {
    const prev = {
      ...buildStyle(p),
      sources: {
        ...buildStyle(p).sources,
        [PHOTO_SOURCE]: { type: "geojson", data: { n: 1 } },
        [PHOTO_COUNT_SOURCE]: { type: "geojson", data: { n: 1 } },
        [OVERLAY_LINE_SOURCE]: { type: "geojson", data: {} },
      },
      layers: [...buildStyle(p).layers, { id: LAYER_OVERLAY_LINE }, { id: LAYER_PINS }],
    };
    const next = buildStyle(p, "https://other.test");
    const out = keepPhotoLayers(prev, next);
    expect(out.sources[PHOTO_SOURCE]).toEqual({ type: "geojson", data: { n: 1 } });
    expect(out.sources[PHOTO_COUNT_SOURCE]).toEqual({ type: "geojson", data: { n: 1 } });
    expect(out.layers.map((l) => l.id).slice(-2)).toEqual([LAYER_OVERLAY_LINE, LAYER_PINS]);
    expect(Object.keys(out.sources)).toContain("openmaptiles");
  });

  it("returns the new style untouched when there is no previous style", () => {
    const next = buildStyle(p);
    expect(keepPhotoLayers(undefined, next)).toBe(next);
  });
});
