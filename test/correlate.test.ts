import { describe, expect, it } from "vitest";
import { correlate, locate, summarize } from "../src/correlate";
import type { Track, TrackPoint } from "../src/gpx";
import { photo } from "./harness";

const MIN = 60_000;
const T0 = Date.UTC(2024, 5, 1, 10, 0, 0);
const pt = (min: number, lat: number, lon: number, ele?: number): TrackPoint =>
  ele === undefined ? { t: T0 + min * MIN, lat, lon } : { t: T0 + min * MIN, lat, lon, ele };

const seg1 = [pt(0, 48.0, 2.0, 100), pt(10, 48.1, 2.1, 110), pt(40, 48.4, 2.4, 140)];
const seg2 = [pt(120, 49.0, 3.0), pt(130, 49.1, 3.1)];
const track: Track = { name: null, segments: [seg1, seg2], pointCount: 5, start: seg1[0].t, end: seg2[1].t };

describe("locate", () => {
  const fixOf = (r: ReturnType<typeof locate>) => {
    if (!("fix" in r)) throw new Error(`no fix: ${r.reason}`);
    return r.fix;
  };

  // One segment whose own two neighbouring points (5 min and 50 min) are
  // farther apart than maxGapMs, so a t between them can only be handled by
  // snapping to whichever bracketing point is close enough, never by
  // interpolating across them.
  const gapSeg = [pt(0, 1, 10, 100), pt(5, 2, 20, 200), pt(50, 3, 30, 300)];

  it("snaps to the nearer bracketing point when a segment's own gap is too wide to interpolate", () => {
    expect(locate([gapSeg], T0 + 48 * MIN, 10 * MIN)).toEqual({ fix: { lat: 3, lon: 30, alt: 300 } });
    expect(locate([gapSeg], T0 + 7 * MIN, 10 * MIN)).toEqual({ fix: { lat: 2, lon: 20, alt: 200 } });
  });

  it("still reports a gap when neither bracketing point is within half the max gap", () => {
    expect(locate([gapSeg], T0 + 27 * MIN, 10 * MIN)).toEqual({ reason: "gap" });
  });

  it("interpolates between two points closer than the max gap", () => {
    const fix = fixOf(locate(track.segments, T0 + 5 * MIN, 10 * MIN));
    expect(fix.lat).toBeCloseTo(48.05, 9);
    expect(fix.lon).toBeCloseTo(2.05, 9);
    expect(fix.alt).toBeCloseTo(105, 9);
  });

  it("refuses to interpolate across a gap wider than the max gap", () => {
    expect(locate(track.segments, T0 + 20 * MIN, 10 * MIN)).toEqual({ reason: "gap" });
  });

  it("snaps to a segment end within half the max gap", () => {
    expect(locate(track.segments, T0 + 44 * MIN, 10 * MIN)).toEqual({ fix: { lat: 48.4, lon: 2.4, alt: 140 } });
    expect(locate(track.segments, T0 - 4 * MIN, 10 * MIN)).toEqual({ fix: { lat: 48.0, lon: 2.0, alt: 100 } });
  });

  it("is outside the track beyond that", () => {
    expect(locate(track.segments, T0 + 80 * MIN, 10 * MIN)).toEqual({ reason: "outside-track" });
    expect(locate(track.segments, T0 - 30 * MIN, 10 * MIN)).toEqual({ reason: "outside-track" });
  });

  it("omits altitude when either neighbour lacks it", () => {
    const fix = fixOf(locate(track.segments, T0 + 125 * MIN, 10 * MIN));
    expect(fix.lat).toBeCloseTo(49.05, 9);
    expect(fix.lon).toBeCloseTo(3.05, 9);
    expect("alt" in fix).toBe(false);
  });

  it("returns the exact point on a timestamp hit", () => {
    expect(locate(track.segments, T0 + 10 * MIN, 10 * MIN)).toEqual({ fix: { lat: 48.1, lon: 2.1, alt: 110 } });
  });
});

describe("correlate", () => {
  // Capture strings are local wall clock; build them from the UTC track time
  // so the test is independent of the machine's zone.
  const local = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  it("matches by capture time plus the clock offset and reports reasons", () => {
    const photos = [
      photo({ id: "in", exif: { dateTimeOriginal: local(T0 + 5 * MIN) } }),
      photo({ id: "late", exif: { dateTimeOriginal: local(T0 + 20 * MIN) } }),
      photo({ id: "far", exif: { dateTimeOriginal: local(T0 + 300 * MIN) } }),
      photo({ id: "none" }),
    ];
    const matches = correlate(photos, track, { offsetMs: 0, maxGapMs: 10 * MIN });
    const round = (v: number | undefined) => (v === undefined ? null : Math.round(v * 1e6) / 1e6);
    expect(matches.map((m) => [m.id, round(m.fix?.lat), m.reason ?? null])).toEqual([
      ["in", 48.05, null],
      ["late", null, "gap"],
      ["far", null, "outside-track"],
      ["none", null, "no-time"],
    ]);
  });

  it("shifts capture times by the offset (camera clock 5 minutes slow → +5 min)", () => {
    const photos = [photo({ id: "a", exif: { dateTimeOriginal: local(T0) } })];
    const [m] = correlate(photos, track, { offsetMs: 5 * MIN, maxGapMs: 10 * MIN });
    expect(m.fix?.lat).toBeCloseTo(48.05, 6);
  });
});

describe("summarize", () => {
  it("counts matches and each reason", () => {
    expect(
      summarize([
        { id: "a", fix: { lat: 0, lon: 0 } },
        { id: "b", fix: null, reason: "gap" },
        { id: "c", fix: null, reason: "no-time" },
        { id: "d", fix: null, reason: "outside-track" },
        { id: "e", fix: null, reason: "gap" },
      ]),
    ).toEqual({ matched: 1, unmatched: 4, noTime: 1, outside: 1, gap: 2 });
  });
});
