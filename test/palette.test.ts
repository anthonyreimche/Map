import { describe, expect, it } from "vitest";
import {
  BASEMAP_KEYS,
  MAX_CHROMA,
  NEUTRAL_TOKENS,
  chroma,
  luminance,
  mix,
  palette,
  parseHex,
  readThemeTokens,
  toHex,
} from "../src/palette";

const LIGHT = {
  surface0: "#ffffff",
  surface1: "#f4f4f4",
  surface2: "#e8e8e8",
  surface3: "#dcdcdc",
  border: "#c8c8c8",
  textMuted: "#6a6a6a",
  textSecondary: "#3a3a3a",
};
const DARK = {
  surface0: "#0a0a0a",
  surface1: "#111111",
  surface2: "#1a1a1a",
  surface3: "#242424",
  border: "#333333",
  textMuted: "#848484",
  textSecondary: "#c0c0c0",
};

describe("colour helpers", () => {
  it("parses #rgb and #rrggbb, rejects anything else", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex(" #525252 ")).toEqual([82, 82, 82]);
    expect(parseHex("rgb(1,2,3)")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });

  it("round-trips through toHex and mixes linearly", () => {
    expect(toHex([82, 82, 82])).toBe("#525252");
    expect(mix([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
  });

  it("orders luminance and measures chroma", () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(luminance([0, 0, 0])).toBe(0);
    expect(chroma([10, 20, 30])).toBe(20);
  });
});

describe("readThemeTokens", () => {
  it("reads every token from the CSS variables and falls back to Neutral", () => {
    const vars: Record<string, string> = { "--color-surface-0": "#123456" };
    const t = readThemeTokens((name) => vars[name] ?? "");
    expect(t.surface0).toBe("#123456");
    expect(t.textMuted).toBe(NEUTRAL_TOKENS.textMuted);
  });

  it("ignores values that are not hex colours", () => {
    const t = readThemeTokens(() => "oklch(50% 0 0)");
    expect(t).toEqual(NEUTRAL_TOKENS);
  });
});

describe("palette", () => {
  it("names the scheme from the surface luminance", () => {
    expect(palette(NEUTRAL_TOKENS).scheme).toBe("dark");
    expect(palette(LIGHT).scheme).toBe("light");
    expect(palette(DARK).scheme).toBe("dark");
  });

  it("keeps the land as the app surface and roads contrasting against it", () => {
    for (const tokens of [LIGHT, DARK, NEUTRAL_TOKENS]) {
      const p = palette(tokens);
      expect(p.background).toBe(tokens.surface0);
      const land = luminance(parseHex(p.background)!);
      const minor = luminance(parseHex(p.roadMinor)!);
      const major = luminance(parseHex(p.roadMajor)!);
      if (p.scheme === "dark") {
        expect(minor).toBeGreaterThan(land);
        expect(major).toBeGreaterThan(minor);
      } else {
        expect(minor).toBeLessThan(land);
        expect(major).toBeLessThan(minor);
      }
    }
  });

  it("keeps every basemap colour nearly neutral", () => {
    for (const tokens of [LIGHT, DARK, NEUTRAL_TOKENS]) {
      const p = palette(tokens);
      for (const key of BASEMAP_KEYS) {
        const rgb = parseHex(p[key]);
        expect(rgb, key).not.toBeNull();
        expect(chroma(rgb!), key).toBeLessThanOrEqual(MAX_CHROMA);
      }
    }
  });

  it("distinguishes water and wood from land", () => {
    const p = palette(NEUTRAL_TOKENS);
    expect(p.water).not.toBe(p.background);
    expect(p.wood).not.toBe(p.background);
    expect(p.water).not.toBe(p.wood);
  });
});
