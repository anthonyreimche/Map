import type { FeatureCollection, PointFeature } from "./geo";
import type { OverlayData } from "./overlays";
import type { Palette } from "./palette";
import { FONT_BOLD, type StyleLayer } from "./style";

export const PHOTO_SOURCE = "photos";
/** The same clustered photos again, for the count labels alone. A tile waits
 *  for every glyph its symbol layers need, and the glyphs come from the tile
 *  host: were the counts on PHOTO_SOURCE, an unreachable or filtered host would
 *  hold back the pins and circles too, until its requests time out. */
export const PHOTO_COUNT_SOURCE = "photo-counts";
export const OVERLAY_LINE_SOURCE = "overlay-lines";
export const OVERLAY_POINT_SOURCE = "overlay-points";
export const OUR_SOURCE_IDS = [PHOTO_SOURCE, PHOTO_COUNT_SOURCE, OVERLAY_LINE_SOURCE, OVERLAY_POINT_SOURCE] as const;
export const LAYER_OVERLAY_LINE = "overlay-line";
export const LAYER_OVERLAY_POINT = "overlay-point";
export const LAYER_CLUSTERS = "photos-clusters";
export const LAYER_CLUSTER_COUNT = "photos-cluster-count";
export const LAYER_RING = "photos-ring";
export const LAYER_PINS = "photos-pins";
export const OUR_LAYER_IDS = [LAYER_OVERLAY_LINE, LAYER_OVERLAY_POINT, LAYER_CLUSTERS, LAYER_CLUSTER_COUNT, LAYER_RING, LAYER_PINS] as const;
const CLUSTER_MAX_ZOOM = 17;
const ours = (id: string) => id.startsWith("photos-") || id.startsWith("overlay-");

export function photoSourceSpec(data: FeatureCollection<PointFeature>, clusterRadius: number) {
  return { type: "geojson", data, cluster: true, clusterRadius, clusterMaxZoom: CLUSTER_MAX_ZOOM } as const;
}

export function overlaySourceSpec(data: OverlayData["lines"] | OverlayData["points"]) {
  return { type: "geojson", data } as const;
}

/** `match` looks each feature's id up instead of scanning the whole list, but
 *  needs at least one label, so an empty selection is the constant `false`. */
export function selectionFilter(ids: readonly string[]): unknown[] | false {
  return ids.length > 0 ? ["match", ["get", "id"], [...ids], true, false] : false;
}

export function overlayLineLayerSpec(p: Palette): StyleLayer {
  return {
    id: LAYER_OVERLAY_LINE,
    type: "line",
    source: OVERLAY_LINE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.overlay, "line-width": 3, "line-opacity": 0.85 },
  };
}

export function overlayPointLayerSpec(p: Palette): StyleLayer {
  return {
    id: LAYER_OVERLAY_POINT,
    type: "circle",
    source: OVERLAY_POINT_SOURCE,
    paint: { "circle-radius": 4, "circle-color": p.overlay, "circle-stroke-color": p.pinBorder, "circle-stroke-width": 1 },
  };
}

export function photoLayerSpecs(p: Palette, pinThumbnails: boolean): StyleLayer[] {
  const clustered = ["has", "point_count"];
  const single = ["!", ["has", "point_count"]];
  return [
    {
      id: LAYER_CLUSTERS,
      type: "circle",
      source: PHOTO_SOURCE,
      filter: clustered,
      paint: {
        "circle-color": p.clusterFill,
        "circle-stroke-color": p.clusterStroke,
        "circle-stroke-width": 2,
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 100, 26],
      },
    },
    {
      id: LAYER_CLUSTER_COUNT,
      type: "symbol",
      source: PHOTO_COUNT_SOURCE,
      filter: clustered,
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": [FONT_BOLD], "text-size": 12, "text-allow-overlap": true },
      paint: { "text-color": p.clusterText },
    },
    {
      id: LAYER_RING,
      type: "circle",
      source: PHOTO_SOURCE,
      filter: selectionFilter([]),
      paint: {
        "circle-radius": pinThumbnails ? 30 : 10,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": p.ring,
        "circle-stroke-width": 3,
      },
    },
    pinThumbnails
      ? {
          id: LAYER_PINS,
          type: "symbol",
          source: PHOTO_SOURCE,
          filter: single,
          layout: { "icon-image": ["get", "icon"], "icon-size": 1, "icon-allow-overlap": true, "icon-ignore-placement": true },
        }
      : {
          id: LAYER_PINS,
          type: "circle",
          source: PHOTO_SOURCE,
          filter: single,
          paint: { "circle-radius": 6, "circle-color": p.pinFill, "circle-stroke-color": p.pinBorder, "circle-stroke-width": 2 },
        },
  ];
}

interface LayeredStyle {
  sources: Record<string, unknown>;
  layers: { id: string }[];
}

/** A transformStyle for map.setStyle: keep our sources (with their data) and
 *  layers when the basemap is swapped for a new theme.
 *
 *  `prev` is typed structurally (not tied to `S`): a caller's previous style
 *  (this app's MapStyle, or MapLibre's own StyleSpecification mid-setStyle)
 *  only ever needs to satisfy this shape, and pinning both parameters to one
 *  `S` would force TypeScript to unify two call sites that are compatible but
 *  not identical types. */
export function keepPhotoLayers<S extends LayeredStyle>(prev: LayeredStyle | undefined, next: S): S {
  if (!prev) return next;
  const sources: Record<string, unknown> = { ...next.sources };
  for (const id of OUR_SOURCE_IDS) if (prev.sources[id]) sources[id] = prev.sources[id];
  return { ...next, sources, layers: [...next.layers, ...prev.layers.filter((l) => ours(l.id))] } as S;
}
