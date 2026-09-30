import { describe, expect, it } from "vitest";
import { parseGpx, trackBounds, trackLines, trackSpan } from "../src/gpx";

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Morning walk</name></metadata>
  <trk><name>Walk</name>
    <trkseg>
      <trkpt lat="48.0" lon="2.0"><ele>100</ele><time>2024-06-01T10:00:00Z</time></trkpt>
      <trkpt lat="48.1" lon="2.1"><ele>110</ele><time>2024-06-01T10:10:00Z</time></trkpt>
      <trkpt lat="48.2" lon="2.2"><time>2024-06-01T10:05:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="49.0" lon="3.0"><time>2024-06-01T12:00:00Z</time></trkpt>
      <trkpt lat="49.1" lon="3.1"></trkpt>
      <trkpt lat="49.2" lon="3.2"><time>2024-06-01T12:30:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const ROUTE = `<gpx version="1.1"><rte>
  <rtept lat="1" lon="1"><time>2024-01-01T00:00:00Z</time></rtept>
  <rtept lat="2" lon="2"><time>2024-01-01T01:00:00Z</time></rtept>
</rte></gpx>`;

const MISSING_COORDS = `<gpx><trk><trkseg>
  <trkpt lat="48.0" lon="2.0"><time>2024-06-01T10:00:00Z</time></trkpt>
  <trkpt lon="2.1"><time>2024-06-01T10:01:00Z</time></trkpt>
  <trkpt lat="48.2"><time>2024-06-01T10:02:00Z</time></trkpt>
  <trkpt lat="" lon="2.3"><time>2024-06-01T10:03:00Z</time></trkpt>
  <trkpt lat="48.4" lon="2.4"><time>2024-06-01T10:04:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const OUT_OF_RANGE = `<gpx><trk><trkseg>
  <trkpt lat="48.0" lon="2.0"><time>2024-06-01T10:00:00Z</time></trkpt>
  <trkpt lat="91" lon="2.1"><time>2024-06-01T10:01:00Z</time></trkpt>
  <trkpt lat="48.2" lon="-181"><time>2024-06-01T10:02:00Z</time></trkpt>
  <trkpt lat="-90" lon="180"><time>2024-06-01T10:03:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const ZONELESS = `<gpx><trk><trkseg>
  <trkpt lat="1" lon="1"><time>2024-06-01T10:00:00</time></trkpt>
</trkseg></trk></gpx>`;

const ZONED = `<gpx><trk><trkseg>
  <trkpt lat="1" lon="1"><time>2024-06-01T12:00:00+02:00</time></trkpt>
</trkseg></trk></gpx>`;

const T = (s: string) => Date.parse(s);

describe("parseGpx", () => {
  it("reads segments, sorts points by time and drops untimed ones", () => {
    const r = parseGpx(GPX);
    if (!r.ok) throw new Error(r.reason);
    const { track } = r;
    expect(track.name).toBe("Walk");
    expect(track.segments.length).toBe(2);
    expect(track.segments[0].map((p) => [p.lat, p.lon, p.t, p.ele])).toEqual([
      [48.0, 2.0, T("2024-06-01T10:00:00Z"), 100],
      [48.2, 2.2, T("2024-06-01T10:05:00Z"), undefined],
      [48.1, 2.1, T("2024-06-01T10:10:00Z"), 110],
    ]);
    expect(track.segments[1].length).toBe(2);
    expect(track.pointCount).toBe(5);
    expect(track.start).toBe(T("2024-06-01T10:00:00Z"));
    expect(track.end).toBe(T("2024-06-01T12:30:00Z"));
  });

  it("falls back to route points when a file has no track", () => {
    const r = parseGpx(ROUTE);
    expect(r.ok && r.track.segments[0].length).toBe(2);
    expect(r.ok && r.track.name).toBeNull();
  });

  it("reports malformed XML and files without timed points", () => {
    expect(parseGpx("<gpx><trk><trkseg><trkpt lat=")).toEqual({ ok: false, reason: "invalid-xml" });
    expect(parseGpx("<html></html>")).toEqual({ ok: false, reason: "invalid-xml" });
    expect(parseGpx(`<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`)).toEqual({
      ok: false,
      reason: "no-points",
    });
  });

  it("drops points missing lat, missing lon, or with a blank lat, instead of treating them as (0, 0)", () => {
    const r = parseGpx(MISSING_COORDS);
    if (!r.ok) throw new Error(r.reason);
    expect(r.track.segments[0].map((p) => [p.lat, p.lon])).toEqual([
      [48.0, 2.0],
      [48.4, 2.4],
    ]);
    expect(r.track.pointCount).toBe(2);
  });

  it("drops only the points outside ±90 latitude or ±180 longitude", () => {
    const r = parseGpx(OUT_OF_RANGE);
    if (!r.ok) throw new Error(r.reason);
    expect(r.track.segments[0].map((p) => [p.lat, p.lon])).toEqual([
      [48.0, 2.0],
      [-90, 180],
    ]);
    expect(r.track.pointCount).toBe(2);
  });

  it("reads a zone-less <time> as UTC, the same instant as an explicit offset", () => {
    const zoneless = parseGpx(ZONELESS);
    const zoned = parseGpx(ZONED);
    if (!zoneless.ok) throw new Error(zoneless.reason);
    if (!zoned.ok) throw new Error(zoned.reason);
    const expected = Date.UTC(2024, 5, 1, 10, 0, 0);
    expect(zoneless.track.segments[0][0].t).toBe(expected);
    expect(zoned.track.segments[0][0].t).toBe(expected);
  });
});

describe("trackSpan", () => {
  it("spans a 200,000-point track from its segments' ends", () => {
    const long = Array.from({ length: 200_000 }, (_, i) => ({ t: 1_000 + i, lat: 0, lon: 0 }));
    const earlier = [{ t: 500, lat: 0, lon: 0 }];
    expect(trackSpan([long, earlier])).toEqual({ start: 500, end: 200_999 });
  });
});

describe("trackLines / trackBounds", () => {
  it("draws one line per segment and spans every point", () => {
    const r = parseGpx(GPX);
    if (!r.ok) throw new Error(r.reason);
    const lines = trackLines(r.track);
    expect(lines.features.length).toBe(2);
    expect(lines.features[0].geometry.coordinates[0]).toEqual([2.0, 48.0]);
    expect(trackBounds(r.track)).toEqual({ west: 2.0, south: 48.0, east: 3.2, north: 49.2 });
  });
});
