// Web Mercator for the basic map, in MapLibre's units: the world is 512 px
// wide at zoom 0, so a centre and zoom mean the same view in either map (the
// saved view, the fit and fly limits).

import type { Bounds, LonLat } from "./geo";

export const TILE_SIZE = 512;
/** The latitude where the Mercator square ends. */
export const MAX_LAT = 85.051129;
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 22;

/** A world position as a fraction of the world square: x runs 0..1 west to
 *  east (past either end on a world copy), y 0..1 north to south. */
export interface Unit {
  x: number;
  y: number;
}

/** What the view shows: the unit point at its centre, in a box of layout px. */
export interface Camera {
  center: Unit;
  zoom: number;
  width: number;
  height: number;
}

export const worldSize = (zoom: number): number => TILE_SIZE * 2 ** zoom;

export function toUnit({ lon, lat }: LonLat): Unit {
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return { x: lon / 360 + 0.5, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
}

export function fromUnit({ x, y }: Unit): LonLat {
  return { lon: (x - 0.5) * 360, lat: (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90 };
}

/** The unit point under a layout-px point of the view. */
export function unitAt(cam: Camera, x: number, y: number): Unit {
  const ws = worldSize(cam.zoom);
  return { x: cam.center.x + (x - cam.width / 2) / ws, y: cam.center.y + (y - cam.height / 2) / ws };
}

/** The camera that shows `b` inside the view less `padding` on every side. */
export function fitCamera(b: Bounds, width: number, height: number, padding: number, maxZoom: number): Camera {
  const nw = toUnit({ lon: b.west, lat: b.north });
  const se = toUnit({ lon: b.east, lat: b.south });
  const fit = Math.min(Math.max(1, width - 2 * padding) / (se.x - nw.x), Math.max(1, height - 2 * padding) / (se.y - nw.y));
  return constrain({
    center: { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 },
    zoom: Math.min(maxZoom, Math.log2(fit / TILE_SIZE)),
    width,
    height,
  });
}

/** Within the zoom range, on the first world copy, and showing no sky past
 *  either pole while the world is taller than the view. */
export function constrain(cam: Camera): Camera {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom));
  const ws = worldSize(zoom);
  const x = cam.center.x - Math.floor(cam.center.x);
  const half = cam.height / 2 / ws;
  const y = half >= 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, cam.center.y));
  return { ...cam, zoom, center: { x, y } };
}
