import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASEMAP_KEYS, NEUTRAL_TOKENS, palette } from "../src/palette";
import { DEFAULT_ORIGIN, FONT_BOLD, FONT_REGULAR, OMT_LAYERS, buildStyle, styleColours, styleOrigins } from "../src/style";
import type { StyleLayer } from "../src/style";

// Not `new URL("../safelight.json", import.meta.url)`: Vite statically
// recognises that exact literal pattern as an asset-URL import and rewrites it
// against the test environment's mocked http://localhost location instead of
// the real file, which fails readFileSync with "must be of scheme file".
const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), "..", "safelight.json");

const p = palette(NEUTRAL_TOKENS);
const style = buildStyle(p);

describe("buildStyle", () => {
  it("is a version-8 style over one OpenFreeMap vector source", () => {
    expect(style.version).toBe(8);
    expect(Object.values(style.sources).map((s) => [s.type, s.url])).toEqual([["vector", `${DEFAULT_ORIGIN}/planet`]]);
    expect(style.glyphs).toBe(`${DEFAULT_ORIGIN}/fonts/{fontstack}/{range}.pbf`);
  });

  it("uses only OpenMapTiles source layers and the two fonts OpenFreeMap serves", () => {
    const ids = style.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of style.layers) {
      if (l.type !== "background") expect(OMT_LAYERS as readonly string[], l.id).toContain(l["source-layer"]);
      const font = l.layout?.["text-font"];
      if (font) for (const f of font as string[]) expect([FONT_REGULAR, FONT_BOLD]).toContain(f);
    }
  });

  it("paints with basemap palette colours only", () => {
    const allowed = new Set(BASEMAP_KEYS.map((k) => p[k]));
    for (const c of styleColours(style)) expect(allowed, c).toContain(c);
  });

  it("covers water, land cover, roads, boundaries, buildings and place labels", () => {
    const sourceLayers = new Set(style.layers.map((l) => l["source-layer"]));
    for (const s of ["water", "waterway", "landcover", "landuse", "park", "building", "transportation", "boundary", "place", "transportation_name"])
      expect(sourceLayers).toContain(s);
  });

  it("points every URL at the given origin", () => {
    const s = buildStyle(p, "https://tiles.example.test");
    expect(styleOrigins(s)).toEqual(["https://tiles.example.test"]);
  });

  it("gives every road casing a wider line than its road at both zoom stops", () => {
    const byId = new Map(style.layers.map((l) => [l.id, l]));
    const casings = style.layers.filter((l) => l.id.endsWith("-casing"));
    expect(casings.length).toBeGreaterThan(0);
    for (const casingLayer of casings) {
      const roadLayer = byId.get(casingLayer.id.slice(0, -"-casing".length));
      expect(roadLayer, casingLayer.id).toBeDefined();
      const casingWidth = (casingLayer as StyleLayer).paint?.["line-width"] as [string, unknown, unknown, number, number, number, number];
      const roadWidth = (roadLayer as StyleLayer).paint?.["line-width"] as [string, unknown, unknown, number, number, number, number];
      expect(casingWidth[3], `${casingLayer.id} z0`).toBe(roadWidth[3]);
      expect(casingWidth[5], `${casingLayer.id} z1`).toBe(roadWidth[5]);
      expect(casingWidth[4], `${casingLayer.id} w0`).toBeGreaterThan(roadWidth[4]);
      expect(casingWidth[6], `${casingLayer.id} w1`).toBeGreaterThan(roadWidth[6]);
    }
  });
});

describe("manifest", () => {
  it("declares exactly the origin the style loads from", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      permissions: { network: string[] };
    };
    expect(manifest.permissions.network).toEqual(styleOrigins(style));
  });
});
