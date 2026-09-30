import { describe, expect, it } from "vitest";
import type { CatalogPhoto } from "../src/safelight";
import type { UndoEntry } from "../src/store";
import {
  applyPlacements,
  applyUndo,
  fixOf,
  place,
  placeLabel,
  removeLabel,
  removeLocation,
  trackLabel,
  withFix,
  withoutFix,
} from "../src/geotag";
import { located, photo } from "./harness";

function deps(initial: CatalogPhoto[], failWrites = false) {
  let photos = initial;
  const writes: CatalogPhoto[][] = [];
  const undos: UndoEntry[] = [];
  return {
    writes,
    undos,
    current: () => photos,
    deps: {
      photos: () => photos,
      relocate: async (updated: CatalogPhoto[]) => {
        if (failWrites) throw new Error("disk full");
        writes.push(updated);
        const byId = new Map(updated.map((p) => [p.id, p] as const));
        photos = photos.map((p) => byId.get(p.id) ?? p);
      },
      pushUndo: (e: UndoEntry) => void undos.push(e),
    },
  };
}

describe("record helpers", () => {
  it("writes lat/lon, altitude only when given, and clears a stale altitude", () => {
    const p = photo({ id: "a", exif: { gpsLatitude: 1, gpsLongitude: 1, gpsAltitude: 500, cameraModel: "X" } });
    expect(withFix(p, { lat: 2, lon: 3 }).exif).toEqual({ gpsLatitude: 2, gpsLongitude: 3, cameraModel: "X" });
    expect(withFix(p, { lat: 2, lon: 3, alt: 12 }).exif.gpsAltitude).toBe(12);
    expect(withoutFix(p).exif).toEqual({ cameraModel: "X" });
    expect(fixOf(p)).toEqual({ lat: 1, lon: 1, alt: 500 });
    expect(fixOf(photo({ id: "b" }))).toBeNull();
  });

  it("never mutates the input record", () => {
    const p = located("a", 1, 1);
    withFix(p, { lat: 2, lon: 2 });
    withoutFix(p);
    expect(p.exif).toEqual({ gpsLatitude: 1, gpsLongitude: 1 });
  });
});

describe("place / removeLocation", () => {
  it("relocates the named photos in one write and records their previous fixes", async () => {
    const d = deps([photo({ id: "a" }), located("b", 5, 5), photo({ id: "c" })]);
    const n = await place(["a", "b", "zzz"], { lat: 48.85, lon: 2.35 }, d.deps);
    expect(n).toBe(2);
    expect(d.writes.length).toBe(1);
    expect(d.writes[0].map((p) => [p.id, p.exif.gpsLatitude])).toEqual([["a", 48.85], ["b", 48.85]]);
    expect(d.undos[0].label).toBe(placeLabel(2));
    expect(d.undos[0].previous.get("a")).toBeNull();
    expect(d.undos[0].previous.get("b")).toEqual({ lat: 5, lon: 5 });
  });

  it("removes only photos that have a location", async () => {
    const d = deps([located("a", 1, 1), photo({ id: "b" })]);
    expect(await removeLocation(["a", "b"], d.deps)).toBe(1);
    expect(d.current()[0].exif.gpsLatitude).toBeUndefined();
    expect(d.undos[0].label).toBe(removeLabel(1));
  });

  it("does nothing for an empty set", async () => {
    const d = deps([photo({ id: "a" })]);
    expect(await place([], { lat: 0, lon: 0 }, d.deps)).toBe(0);
    expect(d.writes).toEqual([]);
    expect(d.undos).toEqual([]);
  });

  it("pushes no undo entry when the write fails", async () => {
    const d = deps([photo({ id: "a" })], true);
    await expect(place(["a"], { lat: 0, lon: 0 }, d.deps)).rejects.toThrow("disk full");
    expect(d.undos).toEqual([]);
  });
});

describe("applyPlacements / applyUndo", () => {
  it("applies per-photo fixes from a track and undoes them exactly", async () => {
    const d = deps([photo({ id: "a" }), located("b", 9, 9, "2024:01:01 00:00:00")]);
    await applyPlacements(
      [
        { id: "a", fix: { lat: 1, lon: 2, alt: 3 } },
        { id: "b", fix: { lat: 4, lon: 5 } },
      ],
      trackLabel(2),
      d.deps,
    );
    expect(d.current().map((p) => p.exif.gpsAltitude)).toEqual([3, undefined]);
    await applyUndo(d.undos[0], d.deps);
    expect(d.current()[0].exif).toEqual({});
    expect(d.current()[1].exif).toMatchObject({ gpsLatitude: 9, gpsLongitude: 9 });
  });

  it("skips photos that no longer exist when undoing", async () => {
    const d = deps([photo({ id: "a" })]);
    const entry: UndoEntry = { label: "x", previous: new Map([["gone", null], ["a", { lat: 1, lon: 1 }]]) };
    await applyUndo(entry, d.deps);
    expect(d.writes[0].map((p) => p.id)).toEqual(["a"]);
  });
});

describe("labels", () => {
  it("count and pluralise", () => {
    expect(placeLabel(1)).toBe("Undo placing 1 photo");
    expect(placeLabel(3)).toBe("Undo placing 3 photos");
    expect(removeLabel(2)).toBe("Undo removing 2 locations");
    expect(trackLabel(12)).toBe("Undo tagging 12 photos from the track");
  });
});
