// Preferences (global, persisted through the host's per-extension settings)
// and two stored-only values: the last map view and the last clock offset.
// Every stored value is untrusted and validated on read.

import { React, api } from "./rt";
import type { SettingsField } from "./safelight";

export interface Prefs {
  clusterRadius: number;
  pinThumbnails: boolean;
  flyToActive: boolean;
  maxGapMinutes: number;
}

export const DEFAULT_PREFS: Readonly<Prefs> = {
  clusterRadius: 40,
  pinThumbnails: true,
  flyToActive: true,
  maxGapMinutes: 10,
};

export const PREF_KEYS = ["clusterRadius", "pinThumbnails", "flyToActive", "maxGapMinutes"] as const satisfies readonly (keyof Prefs)[];

const RANGE = {
  clusterRadius: [20, 80],
  maxGapMinutes: [1, 120],
} as const;

export const SETTINGS_FIELDS: readonly SettingsField[] = [
  { key: "clusterRadius", label: "Cluster radius", hint: "Pixels within which nearby pins merge into a count.", type: "number", default: DEFAULT_PREFS.clusterRadius, min: RANGE.clusterRadius[0], max: RANGE.clusterRadius[1], step: 5 },
  { key: "pinThumbnails", label: "Pin thumbnails", hint: "Draw each photo's preview on its pin; off shows plain dots.", type: "boolean", default: DEFAULT_PREFS.pinThumbnails },
  { key: "flyToActive", label: "Fly to the active photo", hint: "When the selection changes in the Library or Develop, pan the map to that photo.", type: "boolean", default: DEFAULT_PREFS.flyToActive },
  { key: "maxGapMinutes", label: "Track gap limit (minutes)", hint: "Photos are not placed between two track points further apart than this.", type: "number", default: DEFAULT_PREFS.maxGapMinutes, min: RANGE.maxGapMinutes[0], max: RANGE.maxGapMinutes[1], step: 1 },
];

export const VIEW_KEY = "lastView";
export const OFFSET_KEY = "lastOffsetSeconds";

const clampNumber = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function validate<K extends keyof Prefs>(key: K, value: unknown): Prefs[K] {
  switch (key) {
    case "clusterRadius":
      return clampNumber(value, RANGE.clusterRadius, DEFAULT_PREFS.clusterRadius) as Prefs[K];
    case "maxGapMinutes":
      return clampNumber(value, RANGE.maxGapMinutes, DEFAULT_PREFS.maxGapMinutes) as Prefs[K];
    default:
      return (typeof value === "boolean" ? value : DEFAULT_PREFS[key]) as Prefs[K];
  }
}

export type Getter = <T>(key: string, fallback: T) => T;

export function readPrefs(get: Getter): Prefs {
  const out = { ...DEFAULT_PREFS };
  for (const key of PREF_KEYS) (out as Record<string, unknown>)[key] = validate(key, get(key, DEFAULT_PREFS[key]));
  return out;
}

/** Live prefs: re-read whenever any of this extension's settings change. */
export function usePrefs(): Prefs {
  const [prefs, setPrefs] = React.useState(() => readPrefs(api.settings.get));
  React.useEffect(() => api.settings.onChange(() => setPrefs(readPrefs(api.settings.get))), []);
  return prefs;
}

export interface SavedView {
  lon: number;
  lat: number;
  zoom: number;
}

export function readSavedView(get: Getter): SavedView | null {
  const v = get<unknown>(VIEW_KEY, null);
  if (!v || typeof v !== "object") return null;
  const { lon, lat, zoom } = v as Record<string, unknown>;
  if (typeof lon !== "number" || typeof lat !== "number" || typeof zoom !== "number") return null;
  if (![lon, lat, zoom].every(Number.isFinite)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90 || zoom < 0 || zoom > 22) return null;
  return { lon, lat, zoom };
}

export function writeSavedView(view: SavedView): void {
  api.settings.set(VIEW_KEY, view);
}

export function readSavedOffset(get: Getter): number {
  const v = get<unknown>(OFFSET_KEY, 0);
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
}

export function writeSavedOffset(seconds: number): void {
  api.settings.set(OFFSET_KEY, Math.round(seconds));
}
