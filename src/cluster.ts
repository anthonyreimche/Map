// Point clustering for the basic map, standing in for the clustering MapLibre
// does on a clustered GeoJSON source: greedy, per whole zoom, with the radius
// in screen pixels. Positions are mercator units, so a zoom's clustering is
// the same wherever the view is panned.

import { worldSize, type Unit } from "./mercator";

export interface ClusterPoint extends Unit {
  id: string;
}

export type Clustered =
  | ({ kind: "point"; id: string } & Unit)
  | ({
      kind: "cluster";
      /** Index × 32 + zoom: unique within one data set, and names its zoom. */
      clusterId: number;
      count: number;
      members: string[];
    } & Unit);

const ZOOM_BITS = 32;

export const clusterZoomOf = (clusterId: number): number => clusterId % ZOOM_BITS;
export const clusterIndexOf = (clusterId: number): number => Math.floor(clusterId / ZOOM_BITS);

/** The points as they show at whole zoom `zoom`: each unclaimed point, in
 *  order, claims every unclaimed point within `radius` px of it. */
export function clusterAt(points: readonly ClusterPoint[], zoom: number, radius: number): Clustered[] {
  const r = radius / worldSize(zoom);
  const cell = (v: number) => Math.floor(v / r);
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = `${cell(p.x)},${cell(p.y)}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });

  const claimed = new Uint8Array(points.length);
  const out: Clustered[] = [];
  let clusters = 0;
  points.forEach((p, i) => {
    if (claimed[i]) return;
    claimed[i] = 1;
    const members = [i];
    const cx = cell(p.x);
    const cy = cell(p.y);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (claimed[j] || Math.hypot(points[j].x - p.x, points[j].y - p.y) > r) continue;
          claimed[j] = 1;
          members.push(j);
        }
      }
    }
    if (members.length === 1) {
      out.push({ kind: "point", id: p.id, x: p.x, y: p.y });
      return;
    }
    members.sort((a, b) => a - b);
    out.push({
      kind: "cluster",
      clusterId: clusters++ * ZOOM_BITS + zoom,
      count: members.length,
      members: members.map((j) => points[j].id),
      x: members.reduce((s, j) => s + points[j].x, 0) / members.length,
      y: members.reduce((s, j) => s + points[j].y, 0) / members.length,
    });
  });
  return out;
}

/** The first zoom after `fromZoom` at which `members` no longer share one
 *  cluster; one past `maxZoom` (where clustering stops) at the latest. */
export function expansionZoom(points: readonly ClusterPoint[], members: readonly string[], fromZoom: number, radius: number, maxZoom: number): number {
  const wanted = new Set(members);
  const subset = points.filter((p) => wanted.has(p.id));
  for (let z = fromZoom + 1; z <= maxZoom; z++) {
    if (!clusterAt(subset, z, radius).some((c) => c.kind === "cluster" && c.count === subset.length)) return z;
  }
  return maxZoom + 1;
}

/** A cluster's label, as MapLibre writes `point_count_abbreviated`. */
export function abbreviate(count: number): string {
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${Math.round(count / 100) / 10}k`;
  return String(count);
}
