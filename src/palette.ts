export type Rgb = readonly [number, number, number];

export interface ThemeTokens {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  border: string;
  textMuted: string;
  textSecondary: string;
}

/** Safelight Neutral, the default theme — the fallback when a token is unreadable. */
export const NEUTRAL_TOKENS: ThemeTokens = {
  surface0: "#525252",
  surface1: "#5e5e5e",
  surface2: "#666666",
  surface3: "#707070",
  border: "#3b3b3b",
  textMuted: "#9c9c9c",
  textSecondary: "#c4c4c4",
};

const TOKEN_VARS: Record<keyof ThemeTokens, string> = {
  surface0: "--color-surface-0",
  surface1: "--color-surface-1",
  surface2: "--color-surface-2",
  surface3: "--color-surface-3",
  border: "--color-border",
  textMuted: "--color-text-muted",
  textSecondary: "--color-text-secondary",
};

/** Largest max−min channel spread a basemap colour may have: a hint of hue, never a colour. */
export const MAX_CHROMA = 28;

const DARK_BELOW = 0.35;
const WATER_TINT: Rgb = [70, 105, 135];
const WOOD_TINT: Rgb = [98, 128, 84];
const OVERLAY_TINT: Rgb = [230, 150, 60];
const BLACK: Rgb = [0, 0, 0];

export function parseHex(s: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex(c: Rgb): string {
  return `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** WCAG relative luminance, 0..1. */
export function luminance(c: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

export function chroma(c: Rgb): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

export function readThemeTokens(getVar: (name: string) => string): ThemeTokens {
  const out = { ...NEUTRAL_TOKENS };
  for (const key of Object.keys(TOKEN_VARS) as (keyof ThemeTokens)[]) {
    const rgb = parseHex(getVar(TOKEN_VARS[key]) ?? "");
    if (rgb) out[key] = toHex(rgb);
  }
  return out;
}

/** The live theme's tokens, off :root. */
export function cssVarReader(): (name: string) => string {
  const cs = getComputedStyle(document.documentElement);
  return (name) => cs.getPropertyValue(name).trim();
}

export interface Palette {
  scheme: "light" | "dark";
  background: string;
  water: string;
  wood: string;
  park: string;
  builtUp: string;
  building: string;
  roadMinor: string;
  roadSecondary: string;
  roadMajor: string;
  roadCasing: string;
  boundary: string;
  label: string;
  labelHalo: string;
  /** Pins, clusters and overlays: UI colours, exempt from the chroma ceiling. */
  pinFill: string;
  pinBorder: string;
  clusterFill: string;
  clusterStroke: string;
  clusterText: string;
  ring: string;
  overlay: string;
}

export const BASEMAP_KEYS = [
  "background",
  "water",
  "wood",
  "park",
  "builtUp",
  "building",
  "roadMinor",
  "roadSecondary",
  "roadMajor",
  "roadCasing",
  "boundary",
  "label",
  "labelHalo",
] as const satisfies readonly (keyof Palette)[];

export function palette(tokens: ThemeTokens): Palette {
  const rgb = (key: keyof ThemeTokens): Rgb => parseHex(tokens[key]) ?? parseHex(NEUTRAL_TOKENS[key])!;
  const bg = rgb("surface0");
  const scheme = luminance(bg) < DARK_BELOW ? "dark" : "light";
  const inkSoft = rgb("textMuted");
  const ink = rgb("textSecondary");
  // Water sits a touch below the land in both schemes; the tint stays faint.
  const water = mix(mix(bg, WATER_TINT, 0.14), BLACK, scheme === "dark" ? 0.12 : 0.05);
  return {
    scheme,
    background: toHex(bg),
    water: toHex(water),
    wood: toHex(mix(bg, WOOD_TINT, 0.12)),
    park: toHex(mix(bg, WOOD_TINT, 0.07)),
    builtUp: toHex(mix(bg, inkSoft, 0.05)),
    building: toHex(mix(bg, inkSoft, 0.16)),
    roadMinor: toHex(mix(bg, inkSoft, 0.28)),
    roadSecondary: toHex(mix(bg, inkSoft, 0.42)),
    roadMajor: toHex(mix(bg, ink, 0.55)),
    roadCasing: toHex(rgb("border")),
    boundary: toHex(inkSoft),
    label: toHex(ink),
    labelHalo: toHex(bg),
    pinFill: toHex(rgb("surface3")),
    pinBorder: toHex(ink),
    clusterFill: toHex(rgb("surface3")),
    clusterStroke: toHex(ink),
    clusterText: toHex(ink),
    ring: toHex(ink),
    overlay: toHex(mix(ink, OVERLAY_TINT, 0.6)),
  };
}
