import { exifTime } from "./exif-time";
import type { GpsFix } from "./geo";
import type { Track, TrackPoint } from "./gpx";

export type MatchReason = "no-time" | "outside-track" | "gap";

export interface Match {
  id: string;
  fix: GpsFix | null;
  reason?: MatchReason;
}

export interface CorrelateOptions {
  /** Added to every capture time before matching (camera clock correction). */
  offsetMs: number;
  /** Widest interval between two track points the position may be interpolated across. */
  maxGapMs: number;
}

export interface Summary {
  matched: number;
  unmatched: number;
  noTime: number;
  outside: number;
  gap: number;
}

type Located = { fix: GpsFix } | { reason: "outside-track" | "gap" };

function between(a: TrackPoint, b: TrackPoint, t: number): GpsFix {
  const span = b.t - a.t;
  const k = span === 0 ? 0 : (t - a.t) / span;
  const fix: GpsFix = { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k };
  if (a.ele !== undefined && b.ele !== undefined) fix.alt = a.ele + (b.ele - a.ele) * k;
  return fix;
}

function at(p: TrackPoint): GpsFix {
  return p.ele === undefined ? { lat: p.lat, lon: p.lon } : { lat: p.lat, lon: p.lon, alt: p.ele };
}

/** Index of the last point at or before t (segment sorted by t, t within its span). */
function lastBefore(seg: readonly TrackPoint[], t: number): number {
  let lo = 0;
  let hi = seg.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (seg[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

type Nearest = { distance: number; point: TrackPoint } | null;

/** best, or point if point is closer to t — a pure fold so callers keep plain reassignment (and TS narrowing). */
function nearer(best: Nearest, point: TrackPoint, t: number): Nearest {
  const distance = Math.abs(point.t - t);
  return !best || distance < best.distance ? { distance, point } : best;
}

export function locate(segments: readonly (readonly TrackPoint[])[], t: number, maxGapMs: number): Located {
  let sawGap = false;
  let nearest: Nearest = null;
  for (const seg of segments) {
    if (seg.length === 0) continue;
    const first = seg[0];
    const last = seg[seg.length - 1];
    if (t >= first.t && t <= last.t) {
      const i = lastBefore(seg, t);
      const a = seg[i];
      if (a.t === t || i === seg.length - 1) return { fix: at(a) };
      const b = seg[i + 1];
      if (b.t - a.t <= maxGapMs) return { fix: between(a, b, t) };
      sawGap = true;
      nearest = nearer(nearer(nearest, a, t), b, t);
      continue;
    }
    nearest = nearer(nearer(nearest, first, t), last, t);
  }
  if (nearest && nearest.distance <= maxGapMs / 2) return { fix: at(nearest.point) };
  return { reason: sawGap ? "gap" : "outside-track" };
}

export function correlate(
  photos: readonly { id: string; exif: { dateTimeOriginal?: string } }[],
  track: Track,
  opts: CorrelateOptions,
): Match[] {
  return photos.map((p) => {
    const t = exifTime(p.exif.dateTimeOriginal);
    if (t === undefined) return { id: p.id, fix: null, reason: "no-time" };
    const r = locate(track.segments, t + opts.offsetMs, opts.maxGapMs);
    return "fix" in r ? { id: p.id, fix: r.fix } : { id: p.id, fix: null, reason: r.reason };
  });
}

export function summarize(matches: readonly Match[]): Summary {
  const s: Summary = { matched: 0, unmatched: 0, noTime: 0, outside: 0, gap: 0 };
  for (const m of matches) {
    if (m.fix) s.matched++;
    else {
      s.unmatched++;
      if (m.reason === "no-time") s.noTime++;
      else if (m.reason === "outside-track") s.outside++;
      else if (m.reason === "gap") s.gap++;
    }
  }
  return s;
}
