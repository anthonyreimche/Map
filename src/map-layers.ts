import type { FeatureCollection, LineFeature, PointFeature } from "./geo";
import type { Palette } from "./palette";
import { FONT_BOLD, type StyleLayer } from "./style";

export const PHOTO_SOURCE = "photos";
export const TRACK_SOURCE = "track";
export const LAYER_TRACK = "track-line";
export const LAYER_CLUSTERS = "photos-clusters";
export const LAYER_CLUSTER_COUNT = "photos-cluster-count";
export const LAYER_RING = "photos-ring";
export const LAYER_PINS = "photos-pins";
export const OUR_LAYER_IDS = [LAYER_TRACK, LAYER_CLUSTERS, LAYER_CLUSTER_COUNT, LAYER_RING, LAYER_PINS] as const;
const CLUSTER_MAX_ZOOM = 17;
const ours = (id: string) => id.startsWith("photos-") || id.startsWith("track-");

export const EMPTY_LINES: FeatureCollection<LineFeature> = { type: "FeatureCollection", features: [] };

export function photoSourceSpec(data: FeatureCollection<PointFeature>, clusterRadius: number) {
  return { type: "geojson", data, cluster: true, clusterRadius, clusterMaxZoom: CLUSTER_MAX_ZOOM } as const;
}

export function trackSourceSpec(data: FeatureCollection<LineFeature>) {
  return { type: "geojson", data } as const;
}

/** `match` looks each feature's id up instead of scanning the whole list, but
 *  needs at least one label, so an empty selection is the constant `false`. */
export function selectionFilter(ids: readonly string[]): unknown[] | false {
  return ids.length > 0 ? ["match", ["get", "id"], [...ids], true, false] : false;
}

export function trackLayerSpec(p: Palette): StyleLayer {
  return {
    id: LAYER_TRACK,
    type: "line",
    source: TRACK_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.track, "line-width": 3, "line-opacity": 0.85 },
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
      source: PHOTO_SOURCE,
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
  for (const id of [PHOTO_SOURCE, TRACK_SOURCE]) if (prev.sources[id]) sources[id] = prev.sources[id];
  return { ...next, sources, layers: [...next.layers, ...prev.layers.filter((l) => ours(l.id))] } as S;
}
