import type { Bounds, FeatureCollection, LineFeature } from "./geo";
import { boundsOf } from "./geo";

export interface TrackPoint {
  /** Epoch ms, from the GPX <time> (UTC). */
  t: number;
  lon: number;
  lat: number;
  ele?: number;
}

export interface Track {
  name: string | null;
  /** One list per <trkseg> (or per <rte> when a file has no track), each sorted by time. */
  segments: TrackPoint[][];
  pointCount: number;
  start: number;
  end: number;
}

export type GpxParse = { ok: true; track: Track } | { ok: false; reason: "invalid-xml" | "no-points" };

const ANY_NS = "*";

function childText(el: Element, tag: string): string | null {
  for (const c of Array.from(el.children)) if (c.localName === tag) return c.textContent;
  return null;
}

/** A missing or blank attribute is absent, not zero — `Number(null)` and `Number("")` are both 0. */
function numAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name)?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** GPX 1.1 defines <time> as UTC; JS reads a zone-less date-time as local, so a
 *  missing zone designator is filled in as "Z" rather than left to the machine's offset. */
function parseGpxTime(raw: string | null): number {
  const s = raw?.trim();
  if (!s) return Number.NaN;
  const needsZone = s.includes("T") && !HAS_ZONE.test(s);
  return Date.parse(needsZone ? `${s}Z` : s);
}

function pointsOf(container: Element, tag: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const el of Array.from(container.children)) {
    if (el.localName !== tag) continue;
    const lat = numAttr(el, "lat");
    const lon = numAttr(el, "lon");
    const t = parseGpxTime(childText(el, "time"));
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || Number.isNaN(t)) continue;
    const eleText = childText(el, "ele");
    const ele = eleText === null ? Number.NaN : Number(eleText);
    points.push(Number.isFinite(ele) ? { t, lon, lat, ele } : { t, lon, lat });
  }
  return points.sort((a, b) => a.t - b.t);
}

export function parseGpx(text: string): GpxParse {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "gpx" || doc.getElementsByTagNameNS(ANY_NS, "parsererror").length > 0) {
    return { ok: false, reason: "invalid-xml" };
  }
  const segments: TrackPoint[][] = [];
  for (const seg of Array.from(doc.getElementsByTagNameNS(ANY_NS, "trkseg"))) {
    const pts = pointsOf(seg, "trkpt");
    if (pts.length) segments.push(pts);
  }
  if (segments.length === 0) {
    for (const rte of Array.from(doc.getElementsByTagNameNS(ANY_NS, "rte"))) {
      const pts = pointsOf(rte, "rtept");
      if (pts.length) segments.push(pts);
    }
  }
  if (segments.length === 0) return { ok: false, reason: "no-points" };

  const trk = doc.getElementsByTagNameNS(ANY_NS, "trk")[0];
  const name = (trk && childText(trk, "name")?.trim()) || null;
  return {
    ok: true,
    track: {
      name,
      segments,
      pointCount: segments.reduce((n, seg) => n + seg.length, 0),
      ...trackSpan(segments),
    },
  };
}

/** From each time-sorted segment's first and last point: spreading every point
 *  into Math.min/max overflows the call stack on long (1 Hz, multi-day) logs. */
export function trackSpan(segments: readonly (readonly TrackPoint[])[]): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const seg of segments) {
    if (seg.length === 0) continue;
    start = Math.min(start, seg[0].t);
    end = Math.max(end, seg[seg.length - 1].t);
  }
  return { start, end };
}

export function trackLines(track: Track): FeatureCollection<LineFeature> {
  return {
    type: "FeatureCollection",
    features: track.segments.map((seg) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: seg.map((p) => [p.lon, p.lat] as [number, number]) },
      properties: {},
    })),
  };
}

export function trackBounds(track: Track): Bounds | null {
  return boundsOf(track.segments.flat());
}
