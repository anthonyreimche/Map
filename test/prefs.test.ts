import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  PREF_KEYS,
  SETTINGS_FIELDS,
  readPrefs,
  readSavedView,
  validate,
} from "../src/prefs";

const JUNK: readonly unknown[] = ["x", null, "true", Number.NaN, {}];

describe("validate", () => {
  it.each(PREF_KEYS)("%s falls back to its default on junk", (key) => {
    for (const junk of JUNK) expect(validate(key, junk)).toEqual(DEFAULT_PREFS[key]);
  });

  it("clamps the numeric prefs", () => {
    expect(validate("clusterRadius", 5)).toBe(20);
    expect(validate("clusterRadius", 500)).toBe(80);
  });

  it("accepts booleans as they are", () => {
    expect(validate("pinThumbnails", false)).toBe(false);
    expect(validate("flyToActive", true)).toBe(true);
  });
});

describe("readPrefs", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(readPrefs((_k, fallback) => fallback)).toEqual(DEFAULT_PREFS);
  });

  it("declares one settings field per pref, with the default", () => {
    expect(SETTINGS_FIELDS.map((f) => [f.key, f.default])).toEqual(PREF_KEYS.map((k) => [k, DEFAULT_PREFS[k]]));
  });
});

describe("saved view", () => {
  it("reads a valid view and rejects a malformed one", () => {
    const stored = { lastView: { lon: 2.35, lat: 48.85, zoom: 12 } };
    const get = <T,>(k: string, fb: T): T => (k in stored ? (stored[k as keyof typeof stored] as T) : fb);
    expect(readSavedView(get)).toEqual({ lon: 2.35, lat: 48.85, zoom: 12 });
    expect(readSavedView(<T,>(_k: string, _fb: T) => ({ lon: 200, lat: 0, zoom: 1 }) as T)).toBeNull();
    expect(readSavedView(<T,>(_k: string, fb: T) => fb)).toBeNull();
  });
});
