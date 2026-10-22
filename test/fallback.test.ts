import { afterEach, describe, expect, it, vi } from "vitest";
import { withFallback } from "../src/fallback";
import type { MapFactory, MapPort } from "../src/map-port";
import { NEUTRAL_TOKENS, palette } from "../src/palette";
import { buildStyle } from "../src/style";

const style = buildStyle(palette(NEUTRAL_TOKENS));
const port = (kind: MapPort["kind"]) => ({ kind }) as MapPort;
const open = (factory: MapFactory, container = document.createElement("div")) => factory(container, style, { lon: 1, lat: 2 }, 3, 1.5);

afterEach(() => vi.restoreAllMocks());

describe("withFallback", () => {
  it("uses the full map where it starts", async () => {
    const basic = vi.fn<MapFactory>(async () => port("basic"));
    expect((await open(withFallback(async () => port("full"), basic))).kind).toBe("full");
    expect(basic).not.toHaveBeenCalled();
  });

  it("falls back to the basic map, on a cleared container with the same view, when the full map cannot start", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = document.createElement("div");
    const basic = vi.fn<MapFactory>(async (el) => {
      expect(el.childElementCount).toBe(0);
      return port("basic");
    });
    const full: MapFactory = async (el) => {
      el.appendChild(document.createElement("canvas"));
      throw new Error("Failed to initialize WebGL");
    };
    expect((await open(withFallback(full, basic), container)).kind).toBe("basic");
    expect(basic).toHaveBeenCalledWith(container, style, { lon: 1, lat: 2 }, 3, 1.5);
  });

  it("logs why the full map could not start", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reason = new Error("Failed to initialize WebGL");
    await open(
      withFallback(
        async () => {
          throw reason;
        },
        async () => port("basic"),
      ),
    );
    expect(warn).toHaveBeenCalledWith("[map] The full map could not start; using the basic map.", reason);
  });

  it("fails when neither map can start", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: MapFactory = async () => {
      throw new Error("nope");
    };
    await expect(open(withFallback(failing, failing))).rejects.toThrow("nope");
  });
});
