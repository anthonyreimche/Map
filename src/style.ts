import { NEUTRAL_TOKENS, palette, type Palette } from "./palette";

export const DEFAULT_ORIGIN = "https://tiles.openfreemap.org";
export const FONT_REGULAR = "Noto Sans Regular";
export const FONT_BOLD = "Noto Sans Bold";

/** Credits for the tile and data sources, rendered by MapView as plain links
 *  (never MapLibre's own AttributionControl — see GHSA-jrc7-96c5-q579). */
export const ATTRIBUTION: readonly { label: string; href: string }[] = [
  { label: "© OpenFreeMap", href: "https://openfreemap.org" },
  { label: "© OpenMapTiles", href: "https://www.openmaptiles.org/" },
  { label: "Data © OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
];

/** The basic map's credit: its world outline is Natural Earth's (public domain). */
export const LAND_ATTRIBUTION: readonly { label: string; href: string }[] = [
  { label: "Made with Natural Earth", href: "https://www.naturalearthdata.com" },
];

/** OpenMapTiles schema layers present in OpenFreeMap's planet tiles. */
export const OMT_LAYERS = [
  "water",
  "waterway",
  "landcover",
  "landuse",
  "park",
  "building",
  "transportation",
  "transportation_name",
  "boundary",
  "place",
  "aeroway",
  "water_name",
  "aerodrome_label",
] as const;

export interface StyleLayer {
  id: string;
  type: "background" | "fill" | "line" | "symbol" | "circle";
  source?: string;
  "source-layer"?: (typeof OMT_LAYERS)[number];
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown[] | boolean;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}

export interface MapStyle {
  version: 8;
  sources: Record<string, { type: "vector"; url: string }>;
  glyphs: string;
  layers: StyleLayer[];
}

/** The basemap vector source's id — exported so callers (MapView's tile-error
 *  gating) can tell a basemap error/load apart from our own photo/overlay sources. */
export const BASEMAP_SOURCE = "openmaptiles";
const LAYER_LAND = "base-background";
const LAYER_WATER = "base-water";
const LAYER_BORDER = "base-boundary-2";
const SOURCE = BASEMAP_SOURCE;
const NAME = ["coalesce", ["get", "name:latin"], ["get", "name"]];
const classIn = (...classes: string[]) => ["match", ["get", "class"], classes, true, false];
const zoomWidth = (z0: number, w0: number, z1: number, w1: number) => [
  "interpolate",
  ["linear"],
  ["zoom"],
  z0,
  w0,
  z1,
  w1,
];

function road(
  id: string,
  classes: string[],
  minzoom: number,
  z0: number,
  w0: number,
  z1: number,
  w1: number,
  colour: string,
  casing: string,
): StyleLayer[] {
  const base = { source: SOURCE, "source-layer": "transportation" as const, minzoom, filter: classIn(...classes) };
  return [
    {
      id: `${id}-casing`,
      type: "line",
      ...base,
      layout: { "line-cap": "round", "line-join": "round" },
      // Wider than the fill at both stops, so the casing shows as an outline
      // rather than being fully hidden underneath it.
      paint: { "line-color": casing, "line-width": zoomWidth(z0, w0 + 1, z1, w1 + 2) },
    },
    {
      id,
      type: "line",
      ...base,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": colour, "line-width": zoomWidth(z0, w0, z1, w1) },
    },
  ];
}

function label(id: string, filter: unknown[], font: string, size: unknown, p: Palette, extra: Partial<StyleLayer> = {}): StyleLayer {
  return {
    id,
    type: "symbol",
    source: SOURCE,
    "source-layer": "place",
    filter,
    layout: { "text-field": NAME, "text-font": [font], "text-size": size, "text-max-width": 8, ...(extra.layout ?? {}) },
    paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.2 },
    ...(extra.minzoom !== undefined ? { minzoom: extra.minzoom } : {}),
    ...(extra.maxzoom !== undefined ? { maxzoom: extra.maxzoom } : {}),
  };
}

export function buildStyle(p: Palette, origin: string = DEFAULT_ORIGIN): MapStyle {
  const fill = (id: string, sourceLayer: StyleLayer["source-layer"], colour: string, filter?: unknown[], minzoom?: number): StyleLayer => ({
    id,
    type: "fill",
    source: SOURCE,
    "source-layer": sourceLayer,
    ...(filter ? { filter } : {}),
    ...(minzoom !== undefined ? { minzoom } : {}),
    paint: { "fill-color": colour },
  });

  const layers: StyleLayer[] = [
    { id: LAYER_LAND, type: "background", paint: { "background-color": p.background } },
    fill("base-landcover-wood", "landcover", p.wood, classIn("wood")),
    fill("base-landcover-grass", "landcover", p.park, classIn("grass", "farmland")),
    fill("base-landuse", "landuse", p.builtUp, classIn("residential", "suburb", "neighbourhood", "industrial", "commercial", "retail"), 8),
    fill("base-park", "park", p.park),
    fill(LAYER_WATER, "water", p.water),
    {
      id: "base-waterway",
      type: "line",
      source: SOURCE,
      "source-layer": "waterway",
      paint: { "line-color": p.water, "line-width": zoomWidth(8, 0.5, 14, 2) },
    },
    fill("base-building", "building", p.building, undefined, 14),
    ...road("base-road-minor", ["minor", "service"], 12, 12, 1.5, 16, 5, p.roadMinor, p.roadCasing),
    ...road("base-road-secondary", ["secondary", "tertiary"], 9, 9, 1.5, 16, 7, p.roadSecondary, p.roadCasing),
    ...road("base-road-major", ["motorway", "trunk", "primary"], 5, 5, 1.5, 16, 9, p.roadMajor, p.roadCasing),
    {
      id: "base-boundary-4",
      type: "line",
      source: SOURCE,
      "source-layer": "boundary",
      minzoom: 4,
      filter: ["==", ["get", "admin_level"], 4],
      paint: { "line-color": p.boundary, "line-width": 0.8, "line-dasharray": [3, 2] },
    },
    {
      id: LAYER_BORDER,
      type: "line",
      source: SOURCE,
      "source-layer": "boundary",
      filter: ["==", ["get", "admin_level"], 2],
      paint: { "line-color": p.boundary, "line-width": 1.2 },
    },
    {
      id: "base-road-name",
      type: "symbol",
      source: SOURCE,
      "source-layer": "transportation_name",
      minzoom: 13,
      layout: { "symbol-placement": "line", "text-field": NAME, "text-font": [FONT_REGULAR], "text-size": 11 },
      paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1 },
    },
    label("base-place-village", classIn("village", "hamlet"), FONT_REGULAR, 11, p, { minzoom: 10 }),
    label("base-place-town", classIn("town"), FONT_REGULAR, 12, p, { minzoom: 8 }),
    label("base-place-city", classIn("city"), FONT_BOLD, zoomWidth(4, 11, 10, 15), p, { minzoom: 4 }),
    label("base-place-state", classIn("state", "province"), FONT_REGULAR, 11, p, {
      maxzoom: 8,
      layout: { "text-transform": "uppercase", "text-letter-spacing": 0.1 },
    }),
    label("base-place-country", classIn("country"), FONT_BOLD, zoomWidth(1, 10, 5, 14), p, { maxzoom: 7 }),
  ];

  return {
    version: 8,
    sources: { [SOURCE]: { type: "vector", url: `${origin}/planet` } },
    glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
    layers,
  };
}

export interface BasemapColours {
  land: string;
  water: string;
  line: string;
}

/** The colours the basic map paints its world outline with, read off the
 *  style the full map draws, so both follow the theme the same way. */
export function basemapColours(style: MapStyle): BasemapColours {
  const neutral = palette(NEUTRAL_TOKENS);
  const paint = (id: string, key: string, fallback: string) => {
    const v = style.layers.find((l) => l.id === id)?.paint?.[key];
    return typeof v === "string" ? v : fallback;
  };
  return {
    land: paint(LAYER_LAND, "background-color", neutral.background),
    water: paint(LAYER_WATER, "fill-color", neutral.water),
    line: paint(LAYER_BORDER, "line-color", neutral.boundary),
  };
}

const originOf = (url: string) => new URL(url).origin;

/** Every origin the style will fetch from: what the manifest must declare. */
export function styleOrigins(style: MapStyle): string[] {
  const origins = new Set<string>();
  for (const s of Object.values(style.sources)) origins.add(originOf(s.url));
  origins.add(originOf(style.glyphs));
  return [...origins];
}

/** Every "#…" colour in the style's paint properties. */
export function styleColours(style: MapStyle): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.startsWith("#")) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const l of style.layers) walk(l.paint);
  return [...out];
}
