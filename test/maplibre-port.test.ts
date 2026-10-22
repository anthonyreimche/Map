import { beforeEach, describe, expect, it, vi } from "vitest";
import { maplibreFactory } from "../src/maplibre-port";
import { NEUTRAL_TOKENS, palette } from "../src/palette";
import { buildStyle } from "../src/style";

// A stand-in for maplibre-gl's Map with just the surface the port drives. Its
// `style` goes null when the WebGL context is lost, as MapLibre's does, and
// every call that would reach the style then throws the way MapLibre's would.
const { FakeMap, maps } = vi.hoisted(() => {
  type Handler = (e: Record<string, unknown>) => void;
  const maps: InstanceType<typeof FakeMap>[] = [];
  class FakeMap {
    options: Record<string, unknown>;
    pixelRatio: number | undefined;
    style: object | null = {};
    handlers = new Map<string, Handler[]>();
    touchZoomRotate = { disableRotation: () => {} };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.pixelRatio = options.pixelRatio as number | undefined;
      maps.push(this);
    }
    private styled<T>(value: T): T {
      if (!this.style) throw new TypeError("Cannot read properties of null (reading 'getSource')");
      return value;
    }
    on(event: string, h: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]);
      return this;
    }
    once(event: string, h: Handler) {
      const wrapped: Handler = (e) => {
        this.handlers.set(event, (this.handlers.get(event) ?? []).filter((x) => x !== wrapped));
        h(e);
      };
      return this.on(event, wrapped);
    }
    fire(event: string, e: Record<string, unknown> = {}) {
      for (const h of [...(this.handlers.get(event) ?? [])]) h(e);
    }
    loseContext() {
      this.style = null;
      this.fire("webglcontextlost");
    }
    getSource() {
      return this.styled({ setData: () => {}, getClusterExpansionZoom: async () => 5 });
    }
    addSource() {
      this.styled(null);
    }
    removeSource() {
      this.styled(null);
    }
    getLayer() {
      return this.styled({});
    }
    addLayer() {
      this.styled(null);
    }
    removeLayer() {
      this.styled(null);
    }
    setFilter() {
      this.styled(null);
    }
    hasImage() {
      return this.styled(false);
    }
    addImage() {
      this.styled(null);
    }
    updateImage() {
      this.styled(null);
    }
    setStyle() {
      this.styled(null);
    }
    queryRenderedFeatures() {
      return this.styled([]);
    }
    setPixelRatio(r: number) {
      this.styled(null);
      this.pixelRatio = r;
    }
    getZoom() {
      return 3;
    }
    getCanvas() {
      return document.createElement("canvas");
    }
    remove() {}
  }
  return { FakeMap, maps };
});

vi.mock("maplibre-gl", () => ({ Map: FakeMap }));

const style = buildStyle(palette(NEUTRAL_TOKENS));
const open = (pixelRatio = 1) => maplibreFactory(document.createElement("div"), style, { lon: 0, lat: 0 }, 2, pixelRatio);
const last = () => maps[maps.length - 1];

beforeEach(() => {
  maps.length = 0;
});

describe("maplibreFactory", () => {
  it("is the full map", async () => {
    expect((await open()).kind).toBe("full");
  });

  it("is ready once the style is parsed, without waiting for every basemap tile", async () => {
    const port = await open();
    const ready = vi.fn();
    port.on("ready", ready);
    last().fire("style.load");
    expect(ready).toHaveBeenCalledTimes(1);
    last().fire("load");
    last().fire("style.load");
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("answers a listener that subscribes after the style was parsed", async () => {
    const port = await open();
    last().fire("style.load");
    const ready = vi.fn();
    port.on("ready", ready);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("opens at the given pixel ratio and follows later changes", async () => {
    const port = await open(2);
    expect(last().options.pixelRatio).toBe(2);
    port.setPixelRatio(1.5);
    expect(last().pixelRatio).toBe(1.5);
  });

  it("goes inert once the WebGL context is lost, so nothing reaches the torn-down style", async () => {
    const port = await open();
    last().fire("style.load");
    last().loseContext();
    expect(() => {
      port.addSource("photos", {});
      port.removeSource("photos");
      port.addLayer({ id: "photos-pins" });
      port.removeLayer("photos-pins");
      port.setFilter("photos-ring", false);
      port.setData("photos", {});
      port.addImage("pin:a", { width: 1, height: 1, data: new Uint8ClampedArray(4) }, 1);
      port.updateImage("pin:a", { width: 1, height: 1, data: new Uint8ClampedArray(4) });
      port.setStyle(style);
      port.setPixelRatio(2);
    }).not.toThrow();
    expect(port.hasImage("pin:a")).toBe(false);
    expect(port.hitTest(1, 1, ["photos-pins"])).toEqual([]);
    await expect(port.clusterExpansionZoom("photos", 1)).rejects.toThrow();
  });

  it("passes the context's restoration on", async () => {
    const port = await open();
    const restored = vi.fn();
    port.on("webglcontextrestored", restored);
    last().loseContext();
    last().fire("webglcontextrestored");
    expect(restored).toHaveBeenCalledTimes(1);
  });
});
