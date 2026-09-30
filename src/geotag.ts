// The only path that writes a location: build new catalog records, hand them
// to core's relocatePhotos (which persists them and updates this window's
// catalog only), and remember what they held for the session undo.

import type { GpsFix } from "./geo";
import { api } from "./rt";
import type { CatalogPhoto } from "./safelight";
import { store, type UndoEntry } from "./store";

export interface Placement {
  id: string;
  fix: GpsFix;
}

export interface GeotagDeps {
  photos(): readonly CatalogPhoto[];
  relocate(updated: CatalogPhoto[]): Promise<void>;
  pushUndo(entry: UndoEntry): void;
}

export function fixOf(p: CatalogPhoto): GpsFix | null {
  const { gpsLatitude: lat, gpsLongitude: lon, gpsAltitude: alt } = p.exif;
  if (lat === undefined || lon === undefined) return null;
  return alt === undefined ? { lat, lon } : { lat, lon, alt };
}

export function withFix(p: CatalogPhoto, fix: GpsFix): CatalogPhoto {
  const { gpsAltitude: _dropped, ...rest } = p.exif;
  const exif = { ...rest, gpsLatitude: fix.lat, gpsLongitude: fix.lon };
  return { ...p, exif: fix.alt === undefined ? exif : { ...exif, gpsAltitude: fix.alt } };
}

export function withoutFix(p: CatalogPhoto): CatalogPhoto {
  const { gpsLatitude: _lat, gpsLongitude: _lon, gpsAltitude: _alt, ...exif } = p.exif;
  return { ...p, exif };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const placeLabel = (n: number) => `Undo placing ${plural(n, "photo", "photos")}`;
export const removeLabel = (n: number) => `Undo removing ${plural(n, "location", "locations")}`;
export const trackLabel = (n: number) => `Undo tagging ${plural(n, "photo", "photos")} from the track`;

async function write(
  updates: readonly { before: CatalogPhoto; after: CatalogPhoto }[],
  label: string,
  deps: GeotagDeps,
): Promise<number> {
  if (updates.length === 0) return 0;
  await deps.relocate(updates.map((u) => u.after));
  deps.pushUndo({ label, previous: new Map(updates.map((u) => [u.before.id, fixOf(u.before)])) });
  return updates.length;
}

export async function applyPlacements(placements: readonly Placement[], label: string, deps: GeotagDeps): Promise<number> {
  const byId = new Map(deps.photos().map((p) => [p.id, p] as const));
  const updates = placements.flatMap((pl) => {
    const before = byId.get(pl.id);
    return before ? [{ before, after: withFix(before, pl.fix) }] : [];
  });
  return write(updates, label, deps);
}

export async function place(ids: readonly string[], fix: GpsFix, deps: GeotagDeps): Promise<number> {
  const known = new Set(deps.photos().map((p) => p.id));
  const placements = ids.filter((id) => known.has(id)).map((id) => ({ id, fix }));
  return applyPlacements(placements, placeLabel(placements.length), deps);
}

export async function removeLocation(ids: readonly string[], deps: GeotagDeps): Promise<number> {
  const wanted = new Set(ids);
  const updates = deps
    .photos()
    .filter((p) => wanted.has(p.id) && fixOf(p) !== null)
    .map((before) => ({ before, after: withoutFix(before) }));
  return write(updates, removeLabel(updates.length), deps);
}

/** Restore the fixes an entry recorded. Not itself undoable. */
export async function applyUndo(entry: UndoEntry, deps: GeotagDeps): Promise<void> {
  const byId = new Map(deps.photos().map((p) => [p.id, p] as const));
  const restored: CatalogPhoto[] = [];
  for (const [id, fix] of entry.previous) {
    const p = byId.get(id);
    if (!p) continue;
    restored.push(fix ? withFix(p, fix) : withoutFix(p));
  }
  if (restored.length) await deps.relocate(restored);
}

/** The live catalog as GeotagDeps. */
export function catalogDeps(): GeotagDeps {
  const catalog = api.stores.useCatalogStore;
  return {
    photos: () => catalog.getState().photos,
    relocate: (updated) => catalog.getState().relocatePhotos(updated),
    pushUndo: (entry) => store().getState().pushUndo(entry),
  };
}
