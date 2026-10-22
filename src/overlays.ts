// The map.overlays contract: lines and points other extensions draw on the
// Map, one entry per extension under its own key, shared through core's
// api.variables. Any extension can write any JSON there, so Map checks every
// entry before drawing it.

import { boundsOf, type Bounds, type FeatureCollection, type LineFeature, type LonLat } from "./geo";

export const OVERLAYS_VAR = "map.overlays";
export const OVERLAYS_DESCRIPTION =
  "Lines and points drawn on the Map. One entry per extension, keyed by its id; add and remove your own with update().";

type Position = [number, number];

/** What an extension writes under its key. Coordinates are [lon, lat]; other
 *  geometry types are ignored. */
export interface MapOverlay {
  /** Shown in the toolbar's Overlays menu, e.g. "Morning ride.gpx". */
  label: string;
  geojson: { type: "FeatureCollection"; features: OverlayFeature[] };
}

export type MapOverlays = Record<string, MapOverlay>;

export interface OverlayFeature {
  type: "Feature";
  geometry:
    | { type: "LineString"; coordinates: Position[] }
    | { type: "MultiLineString"; coordinates: Position[][] }
    | { type: "Point"; coordinates: Position };
  properties?: Record<string, unknown> | null;
}

export interface OverlayPointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Position };
  properties: Record<string, never>;
}

/** One entry as Map draws it. */
export interface ValidOverlay {
  key: string;
  label: string;
  lines: Position[][];
  points: Position[];
  bounds: Bounds | null;
}

export interface OverlayData {
  lines: FeatureCollection<LineFeature>;
  points: FeatureCollection<OverlayPointFeature>;
}

export const EMPTY_OVERLAY_DATA: OverlayData = {
  lines: { type: "FeatureCollection", features: [] },
  points: { type: "FeatureCollection", features: [] },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function position(v: unknown): Position | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [lon, lat] = v as unknown[];
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

function line(v: unknown): Position[] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const out: Position[] = [];
  for (const p of v) {
    const q = position(p);
    if (!q) return null;
    out.push(q);
  }
  return out;
}

/** An entry as Map draws it, plus what was wrong with it. A bad label or
 *  collection drops the entry; a feature with bad coordinates is dropped from
 *  it; geometry Map doesn't draw is skipped without comment. */
export function checkOverlay(key: string, entry: unknown): { overlay: ValidOverlay | null; problems: string[] } {
  if (!isRecord(entry) || typeof entry.label !== "string") return { overlay: null, problems: ["needs a string label"] };
  const g = entry.geojson;
  if (!isRecord(g) || g.type !== "FeatureCollection" || !Array.isArray(g.features))
    return { overlay: null, problems: ["geojson must be a FeatureCollection"] };
  const lines: Position[][] = [];
  const points: Position[] = [];
  const problems: string[] = [];
  g.features.forEach((f: unknown, i: number) => {
    const geom = isRecord(f) ? f.geometry : null;
    if (!isRecord(geom)) {
      problems.push(`feature ${i} has no geometry`);
      return;
    }
    const bad = () => problems.push(`feature ${i} has invalid coordinates`);
    switch (geom.type) {
      case "LineString": {
        const l = line(geom.coordinates);
        if (l) lines.push(l);
        else bad();
        return;
      }
      case "MultiLineString": {
        const c: unknown[] | null = Array.isArray(geom.coordinates) ? geom.coordinates : null;
        if (!c || c.length === 0) {
          bad();
          return;
        }
        // An indexed loop, not map/every/spread: a hole reads as undefined and
        // fails line(), where map and every would skip it, and spreading a
        // large parts array as call arguments overflows the call stack.
        const parts: Position[][] = [];
        for (let j = 0; j < c.length; j++) {
          const part = line(c[j]);
          if (!part) {
            bad();
            return;
          }
          parts.push(part);
        }
        for (const part of parts) lines.push(part);
        return;
      }
      case "Point": {
        const p = position(geom.coordinates);
        if (p) points.push(p);
        else bad();
        return;
      }
      default:
        return;
    }
  });
  const all: LonLat[] = [...lines.flat(), ...points].map(([lon, lat]) => ({ lon, lat }));
  return { overlay: { key, label: entry.label, lines, points, bounds: boundsOf(all) }, problems };
}

/** Every overlay as the two GeoJSON sources the map draws. */
export function overlayData(list: readonly ValidOverlay[]): OverlayData {
  if (list.length === 0) return EMPTY_OVERLAY_DATA;
  return {
    lines: {
      type: "FeatureCollection",
      features: list.flatMap((o) =>
        o.lines.map((coordinates) => ({ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates }, properties: {} })),
      ),
    },
    points: {
      type: "FeatureCollection",
      features: list.flatMap((o) =>
        o.points.map((coordinates) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates }, properties: {} })),
      ),
    },
  };
}
