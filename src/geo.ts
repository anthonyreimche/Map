export interface LonLat {
  lon: number;
  lat: number;
}

/** A photo's position: what the catalog's exif gps fields hold. */
export interface GpsFix {
  lat: number;
  lon: number;
  alt?: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface PointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { id: string; icon: string };
}

export interface LineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: Record<string, never>;
}

export interface FeatureCollection<F = PointFeature | LineFeature> {
  type: "FeatureCollection";
  features: F[];
}

interface Located {
  exif: { gpsLatitude?: number; gpsLongitude?: number };
}

const SINGLE_POINT_PAD = 0.01;

export function locationOf(p: Located): LonLat | null {
  const { gpsLatitude: lat, gpsLongitude: lon } = p.exif;
  if (lat === undefined || lon === undefined) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lon, lat };
}

export function hasLocation(p: Located): boolean {
  return locationOf(p) !== null;
}

export function inBounds(point: LonLat, b: Bounds): boolean {
  if (point.lat < b.south || point.lat > b.north) return false;
  return b.west <= b.east
    ? point.lon >= b.west && point.lon <= b.east
    : point.lon >= b.west || point.lon <= b.east;
}

/** Into [-180, 180). A value already there is returned as is: the arithmetic
 *  below is not exact (2.35 comes back as 2.3500000000000227). */
export function wrapLon(lon: number): number {
  if (lon >= -180 && lon < 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Normalise the box a map reports (longitudes run past ±180 as it wraps). */
export function boundsFromMap(west: number, south: number, east: number, north: number): Bounds {
  const clampLat = (v: number) => Math.max(-90, Math.min(90, v));
  if (east - west >= 360) return { west: -180, south: clampLat(south), east: 180, north: clampLat(north) };
  return { west: wrapLon(west), south: clampLat(south), east: wrapLon(east), north: clampLat(north) };
}

export function boundsOf(points: readonly LonLat[]): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  if (east - west === 0) {
    west -= SINGLE_POINT_PAD;
    east += SINGLE_POINT_PAD;
  }
  if (north - south === 0) {
    south -= SINGLE_POINT_PAD;
    north += SINGLE_POINT_PAD;
  }
  return { west, south, east, north };
}

export function photoFeatures<T extends Located & { id: string }>(
  photos: readonly T[],
  iconId: (id: string) => string,
): FeatureCollection<PointFeature> {
  const features: PointFeature[] = [];
  for (const p of photos) {
    const loc = locationOf(p);
    if (!loc) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [loc.lon, loc.lat] },
      properties: { id: p.id, icon: iconId(p.id) },
    });
  }
  return { type: "FeatureCollection", features };
}
