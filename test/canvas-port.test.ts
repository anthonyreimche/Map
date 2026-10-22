import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvasFactory, type CanvasEnv, type Painter } from "../src/canvas-port";
import { photoFeatures, type LonLat } from "../src/geo";
import {
  LAYER_CLUSTERS,
  LAYER_PINS,
  LAYER_RING,
  OVERLAY_LINE_SOURCE,
  PHOTO_COUNT_SOURCE,
  PHOTO_SOURCE,
  overlayLineLayerSpec,
  overlaySourceSpec,
  photoLayerSpecs,
  photoSourceSpec,
  selectionFilter,
} from "../src/map-layers";
import type { MapPort } from "../src/map-port";
import { toUnit, worldSize } from "../src/mercator";
import { EMPTY_OVERLAY_DATA } from "../src/overlays";
import { NEUTRAL_TOKENS, palette } from "../src/palette";
import { pinImageId, type PinImage } from "../src/pins";
import { buildStyle } from "../src/style";
import { located } from "./harness";

const pal = palette(NEUTRAL_TOKENS);
const style = buildStyle(pal);

interface Op {
  op: string;
  args: unknown[];
  fill: string;
  stroke: string;
  alpha: number;
  font: string;
  lineWidth: number;
}

/** A 2D context that records what is drawn, with the paint state at the time. */
function recordingPainter(): { painter: Painter; ops: Op[] } {
  const ops: Op[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]): void =>
      void ops.push({ op, args, fill: String(painter.fillStyle), stroke: String(painter.strokeStyle), alpha: painter.globalAlpha, font: painter.font, lineWidth: painter.lineWidth });
  const painter: Painter = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    lineCap: "butt",
    lineJoin: "miter",
    setTransform: record("setTransform"),
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    fill: record("fill"),
    stroke: record("stroke"),
    arc: record("arc"),
    drawImage: record("drawImage"),
    fillText: record("fillText"),
  };
  return { painter, ops };
}

interface View {
  center?: LonLat;
  zoom?: number;
  width?: number;
  height?: number;
  ratio?: number;
}

function sized(el: HTMLElement, width: number, height: number) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
}

const opened: { el: HTMLElement; port: MapPort }[] = [];
afterEach(() => {
  for (const { el, port } of opened.splice(0)) {
    port.remove();
    el.remove();
  }
  vi.useRealTimers();
});

async function openMap({ center = { lon: 0, lat: 0 }, zoom = 1, width = 1024, height = 512, ratio = 1 }: View = {}) {
  const frames: ((time: number) => void)[] = [];
  const { painter, ops } = recordingPainter();
  let now = 0;
  const env: CanvasEnv = {
    context: () => painter,
    bitmap: (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      return canvas;
    },
    frame: (callback) => void frames.push(callback),
  };
  const el = document.createElement("div");
  sized(el, width, height);
  document.body.appendChild(el);
  const port = await createCanvasFactory(env)(el, style, center, zoom, ratio);
  opened.push({ el, port });
  return {
    port,
    el,
    ops,
    canvas: el.querySelector("canvas")!,
    /** Runs the queued frames `ms` after the last ones. */
    step(ms = 16) {
      now += ms;
      for (const callback of frames.splice(0)) callback(now);
    },
    frames,
    /** Where a position is drawn in this view. */
    screenOf(at: LonLat) {
      const c = toUnit(port.getCenter());
      const u = toUnit(at);
      const ws = worldSize(port.getZoom());
      return { x: (u.x - c.x) * ws + width / 2, y: (u.y - c.y) * ws + height / 2 };
    },
  };
}

function addPhotos(port: MapPort, photos = [located("a", 48.85, 2.29), located("b", 48.85, 2.3), located("c", 45.76, 4.83)]) {
  const data = photoFeatures(photos, pinImageId);
  port.addSource(PHOTO_SOURCE, photoSourceSpec(data, 40));
  port.addSource(PHOTO_COUNT_SOURCE, photoSourceSpec(data, 40));
  port.addSource(OVERLAY_LINE_SOURCE, overlaySourceSpec(EMPTY_OVERLAY_DATA.lines));
  port.addLayer(overlayLineLayerSpec(pal));
  for (const spec of photoLayerSpecs(pal, true)) port.addLayer(spec);
}

const pin = (size = 48): PinImage => ({ width: size, height: size, data: new Uint8ClampedArray(size * size * 4) });
/** A primary-button pointer event; the button reads as held except on pointerup. */
const pointer = (type: string, x: number, y: number, buttons = type === "pointerup" ? 0 : 1) =>
  new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons, pointerId: 1, isPrimary: true, bubbles: true });

describe("the basic map", () => {
  it("does not open where there is no 2D context, and leaves nothing behind", async () => {
    const el = document.createElement("div");
    const factory = createCanvasFactory({ context: () => null, bitmap: () => null, frame: () => {} });
    await expect(factory(el, style, { lon: 0, lat: 0 }, 1, 1)).rejects.toThrow();
    expect(el.childElementCount).toBe(0);
  });

  it("is the basic map, ready on its first frame", async () => {
    const m = await openMap();
    expect(m.port.kind).toBe("basic");
    const ready = vi.fn();
    m.port.on("ready", ready);
    expect(ready).not.toHaveBeenCalled();
    m.step();
    m.port.setCursor("pointer");
    m.step();
    expect(ready).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    m.port.on("ready", late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("opens at the given view and reports it the way the full map does", async () => {
    const m = await openMap({ center: { lon: 0, lat: 0 }, zoom: 1 });
    expect(m.port.getZoom()).toBe(1);
    expect(m.port.getCenter().lon).toBeCloseTo(0, 9);
    expect(m.port.getCenter().lat).toBeCloseTo(0, 9);
    expect(m.port.unproject(768, 256).lon).toBeCloseTo(90, 9);
    const b = m.port.getBounds();
    expect([b.west, b.east]).toEqual([-180, 180]);
    expect(b.north).toBeCloseTo(66.513, 3);
    expect(b.south).toBeCloseTo(-66.513, 3);
  });

  it("paints the land in the basemap's land colour over its water colour", async () => {
    const m = await openMap();
    m.step();
    expect(m.ops.find((o) => o.op === "fillRect")?.fill).toBe(pal.water);
    expect(m.ops.some((o) => o.op === "fill" && o.fill === pal.background && o.args[0] === "evenodd")).toBe(true);
  });

  it("follows a new basemap's colours", async () => {
    const m = await openMap();
    m.step();
    const dark = palette({ ...NEUTRAL_TOKENS, surface0: "#101010" });
    m.port.setStyle(buildStyle(dark));
    m.ops.length = 0;
    m.step();
    expect(m.ops.find((o) => o.op === "fillRect")?.fill).toBe(dark.water);
  });

  it("sizes its canvas to the container at the pixel ratio, and follows a new ratio", async () => {
    const m = await openMap({ ratio: 2 });
    expect([m.canvas.width, m.canvas.height]).toEqual([2048, 1024]);
    expect([m.canvas.style.width, m.canvas.style.height]).toEqual(["1024px", "512px"]);
    m.step();
    m.ops.length = 0;
    m.port.setPixelRatio(1.5);
    expect(m.canvas.width).toBe(1536);
    // Drawn at once: a resized canvas is blank until drawn again.
    expect(m.ops.find((o) => o.op === "setTransform")?.args).toEqual([1.5, 0, 0, 1.5, 0, 0]);
    expect(m.canvas.style.userSelect).toBe("none");
  });

  it("follows the container's size, as one move", async () => {
    const m = await openMap();
    const moveend = vi.fn();
    m.port.on("moveend", moveend);
    m.step();
    m.ops.length = 0;
    sized(m.el, 800, 400);
    window.dispatchEvent(new Event("resize"));
    expect(m.canvas.width).toBe(800);
    expect(m.ops.find((o) => o.op === "fillRect")?.args).toEqual([0, 0, 800, 400]);
    expect(moveend).toHaveBeenCalledTimes(1);
    expect(m.port.unproject(400, 200).lon).toBeCloseTo(0, 9);
  });

  it("keeps the new size when the container resizes during an ease", async () => {
    const m = await openMap();
    m.step();
    m.port.easeTo({ lon: 20, lat: 10 }, 4, 600);
    m.step();
    sized(m.el, 800, 400);
    window.dispatchEvent(new Event("resize"));
    m.step(700);
    expect(m.port.getZoom()).toBe(4);
    expect(m.port.unproject(400, 200).lon).toBeCloseTo(20, 9);
    expect(m.port.unproject(400, 200).lat).toBeCloseTo(10, 9);
  });

  it("pans with a drag, as one move", async () => {
    const m = await openMap();
    m.step();
    const movestart = vi.fn();
    const moveend = vi.fn();
    m.port.on("movestart", movestart);
    m.port.on("moveend", moveend);
    m.canvas.dispatchEvent(pointer("pointerdown", 512, 256));
    m.canvas.dispatchEvent(pointer("pointermove", 562, 256));
    m.canvas.dispatchEvent(pointer("pointermove", 612, 256));
    m.canvas.dispatchEvent(pointer("pointerup", 612, 256));
    expect(m.port.getCenter().lon).toBeCloseTo(-35.15625, 9);
    expect(movestart).toHaveBeenCalledTimes(1);
    expect(moveend).toHaveBeenCalledTimes(1);
  });

  it("ends a drag whose release it never saw, instead of panning on hover", async () => {
    const m = await openMap();
    m.step();
    const moveend = vi.fn();
    m.port.on("moveend", moveend);
    m.canvas.dispatchEvent(pointer("pointerdown", 512, 256));
    m.canvas.dispatchEvent(pointer("pointermove", 612, 256));
    m.canvas.dispatchEvent(pointer("pointermove", 712, 256, 0));
    expect(m.port.getCenter().lon).toBeCloseTo(-35.15625, 9);
    expect(moveend).toHaveBeenCalledTimes(1);
  });

  it("does not move for a click, or a press that strays less than the click tolerance", async () => {
    const m = await openMap();
    m.step();
    const movestart = vi.fn();
    m.port.on("movestart", movestart);
    m.canvas.dispatchEvent(pointer("pointerdown", 512, 256));
    m.canvas.dispatchEvent(pointer("pointermove", 514, 257));
    m.canvas.dispatchEvent(pointer("pointerup", 514, 257));
    expect(m.port.getCenter().lon).toBeCloseTo(0, 9);
    expect(movestart).not.toHaveBeenCalled();
  });

  it("zooms around the pointer with the wheel, and a trackpad pinch, as one move each", async () => {
    vi.useFakeTimers();
    const m = await openMap();
    m.step();
    const movestart = vi.fn();
    const moveend = vi.fn();
    m.port.on("movestart", movestart);
    m.port.on("moveend", moveend);
    const wheel = new WheelEvent("wheel", { deltaY: -300, clientX: 768, clientY: 256, cancelable: true });
    m.canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(m.port.getZoom()).toBeCloseTo(2, 9);
    expect(m.port.unproject(768, 256).lon).toBeCloseTo(90, 9);
    expect(movestart).toHaveBeenCalledTimes(1);
    expect(moveend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(moveend).toHaveBeenCalledTimes(1);
    m.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, ctrlKey: true, clientX: 768, clientY: 256, cancelable: true }));
    expect(m.port.getZoom()).toBeCloseTo(2.5, 9);
  });

  it("ignores a sideways scroll", async () => {
    const m = await openMap();
    m.step();
    const movestart = vi.fn();
    m.port.on("movestart", movestart);
    m.canvas.dispatchEvent(new WheelEvent("wheel", { deltaX: 80, deltaY: 0, clientX: 768, clientY: 256, cancelable: true }));
    expect(m.port.getZoom()).toBe(1);
    expect(movestart).not.toHaveBeenCalled();
  });

  it("eases to a view over the given time, and jumps there at zero", async () => {
    const m = await openMap();
    m.step();
    const moveend = vi.fn();
    m.port.on("moveend", moveend);
    m.port.easeTo({ lon: 10, lat: 20 }, 5, 0);
    expect(m.port.getCenter().lon).toBeCloseTo(10, 9);
    expect(m.port.getCenter().lat).toBeCloseTo(20, 9);
    expect(m.port.getZoom()).toBe(5);
    expect(moveend).toHaveBeenCalledTimes(1);

    m.port.easeTo({ lon: 20, lat: 20 }, 7, 600);
    m.step(300);
    m.step(400);
    expect(m.port.getZoom()).toBeGreaterThan(5);
    expect(m.port.getZoom()).toBeLessThan(7);
    expect(moveend).toHaveBeenCalledTimes(1);
    m.step(400);
    expect(m.port.getZoom()).toBe(7);
    expect(m.port.getCenter().lon).toBeCloseTo(20, 9);
    expect(moveend).toHaveBeenCalledTimes(2);
  });

  it("keeps the zoom of an ease that passes none", async () => {
    const m = await openMap({ zoom: 4 });
    m.port.easeTo({ lon: 10, lat: 10 }, null, 0);
    expect(m.port.getZoom()).toBe(4);
  });

  it("fits bounds inside the padding, no deeper than the zoom limit", async () => {
    const m = await openMap();
    m.step();
    const box = { west: 2.2, south: 48.8, east: 2.4, north: 48.9 };
    m.port.fitBounds(box, 48, 16);
    m.step(700);
    m.step(700);
    const b = m.port.getBounds();
    expect(b.west).toBeLessThanOrEqual(box.west);
    expect(b.east).toBeGreaterThanOrEqual(box.east);
    expect(b.south).toBeLessThanOrEqual(box.south);
    expect(b.north).toBeGreaterThanOrEqual(box.north);
    expect(m.port.getZoom()).toBeLessThanOrEqual(16);
    m.port.fitBounds({ west: 2.29, south: 48.85, east: 2.29, north: 48.85 }, 48, 16);
    m.step(700);
    m.step(700);
    expect(m.port.getZoom()).toBe(16);
  });

  it("clusters nearby photos when zoomed out, and expands a cluster to the zoom that splits it", async () => {
    const m = await openMap({ center: { lon: 3, lat: 47.5 }, zoom: 5 });
    m.step();
    addPhotos(m.port);
    m.step();
    const at = m.screenOf({ lon: 2.295, lat: 48.85 });
    const [hit] = m.port.hitTest(at.x, at.y, [LAYER_CLUSTERS]);
    expect(hit).toMatchObject({ layer: LAYER_CLUSTERS, id: null });
    expect(hit.lon).toBeCloseTo(2.295, 6);
    expect(hit.lat).toBeCloseTo(48.85, 6);
    const z = await m.port.clusterExpansionZoom(PHOTO_SOURCE, hit.clusterId!);
    expect(z).toBeGreaterThan(5);
    m.port.easeTo({ lon: 2.295, lat: 48.85 }, z, 0);
    m.step();
    expect(m.port.hitTest(m.screenOf({ lon: 2.295, lat: 48.85 }).x, m.screenOf({ lon: 2.295, lat: 48.85 }).y, [LAYER_CLUSTERS])).toEqual([]);
  });

  it("refuses a cluster id that is not current", async () => {
    const m = await openMap();
    m.step();
    addPhotos(m.port);
    await expect(m.port.clusterExpansionZoom(PHOTO_SOURCE, 999)).rejects.toThrow();
  });

  it("writes cluster counts in a local font, needing no font server", async () => {
    const m = await openMap({ center: { lon: 3, lat: 47.5 }, zoom: 5 });
    m.step();
    addPhotos(m.port);
    m.step();
    const count = m.ops.find((o) => o.op === "fillText");
    expect(count?.args[0]).toBe("2");
    expect(count?.font).toMatch(/bold .*sans-serif/);
    expect(count?.fill).toBe(pal.clusterText);
  });

  it("asks once for a pin it has no image for, then draws it centred on its photo", async () => {
    const m = await openMap({ center: { lon: 3, lat: 47.5 }, zoom: 5 });
    m.step();
    const missing = vi.fn();
    m.port.onImageMissing(missing);
    addPhotos(m.port);
    m.step();
    m.port.setFilter(LAYER_RING, false);
    m.step();
    expect(missing.mock.calls).toEqual([[pinImageId("c")]]);
    expect(m.port.hasImage(pinImageId("c"))).toBe(false);
    expect(m.port.hitTest(m.screenOf({ lon: 4.83, lat: 45.76 }).x, m.screenOf({ lon: 4.83, lat: 45.76 }).y, [LAYER_PINS])).toEqual([]);

    m.port.addImage(pinImageId("c"), pin(48), 2);
    expect(m.port.hasImage(pinImageId("c"))).toBe(true);
    m.ops.length = 0;
    m.step();
    const c = m.screenOf({ lon: 4.83, lat: 45.76 });
    const drawn = m.ops.find((o) => o.op === "drawImage")!;
    expect((drawn.args[0] as HTMLCanvasElement).width).toBe(48);
    expect(drawn.args.slice(1).map((v) => Math.round(Number(v) * 1000) / 1000)).toEqual([c.x - 12, c.y - 12, 24, 24].map((v) => Math.round(v * 1000) / 1000));
    const [hit] = m.port.hitTest(c.x + 11, c.y - 11, [LAYER_PINS]);
    expect(hit).toMatchObject({ layer: LAYER_PINS, id: "c", clusterId: null });
  });

  it("swaps a pin's image in place", async () => {
    const m = await openMap({ center: { lon: 3, lat: 47.5 }, zoom: 5 });
    m.step();
    addPhotos(m.port);
    m.port.addImage(pinImageId("c"), pin(48), 2);
    m.port.updateImage(pinImageId("c"), pin(96));
    m.ops.length = 0;
    m.step();
    const drawn = m.ops.find((o) => o.op === "drawImage")!;
    expect((drawn.args[0] as HTMLCanvasElement).width).toBe(96);
    expect(drawn.args[3]).toBe(48);
  });

  it("rings only the selected photos", async () => {
    const m = await openMap({ center: { lon: 3, lat: 47.5 }, zoom: 5 });
    m.step();
    addPhotos(m.port);
    m.port.setFilter(LAYER_RING, selectionFilter(["c"]));
    m.ops.length = 0;
    m.step();
    const rings = m.ops.filter((o) => o.op === "arc" && o.args[2] === 30);
    expect(rings).toHaveLength(1);
    const c = m.screenOf({ lon: 4.83, lat: 45.76 });
    expect(Number(rings[0].args[0])).toBeCloseTo(c.x, 6);
    expect(Number(rings[0].args[1])).toBeCloseTo(c.y, 6);
  });

  it("draws an overlay line in the overlay colour", async () => {
    const m = await openMap({ center: { lon: 3, lat: 47.5 }, zoom: 5 });
    m.step();
    addPhotos(m.port);
    m.port.setData(OVERLAY_LINE_SOURCE, {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[2.29, 48.85], [4.83, 45.76]] }, properties: {} }],
    });
    m.ops.length = 0;
    m.step();
    const stroke = m.ops.find((o) => o.op === "stroke" && o.stroke === pal.overlay);
    expect(stroke).toMatchObject({ alpha: 0.85, lineWidth: 3 });
    const lyon = m.screenOf({ lon: 4.83, lat: 45.76 });
    expect(m.ops.some((o) => o.op === "lineTo" && Math.abs(Number(o.args[0]) - lyon.x) < 1e-6 && Math.abs(Number(o.args[1]) - lyon.y) < 1e-6)).toBe(true);
  });

  it("finds a photo on the neighbouring world copy across the antimeridian", async () => {
    const m = await openMap({ center: { lon: 170, lat: 0 }, zoom: 2 });
    m.step();
    addPhotos(m.port, [located("fiji", -17.7, -178.1)]);
    m.port.addImage(pinImageId("fiji"), pin(48), 2);
    m.step();
    const x = 512 + ((-178.1 + 360 - 170) / 360) * worldSize(2);
    const y = m.screenOf({ lon: 170, lat: -17.7 }).y;
    const [hit] = m.port.hitTest(x, y, [LAYER_PINS]);
    expect(hit).toMatchObject({ id: "fiji" });
    expect(hit.lon).toBeCloseTo(-178.1, 9);
  });

  it("redraws once the browser restores a dropped canvas", async () => {
    const m = await openMap();
    m.step();
    m.ops.length = 0;
    m.canvas.dispatchEvent(new Event("contextrestored"));
    m.step();
    expect(m.ops.some((o) => o.op === "fillRect")).toBe(true);
  });

  it("removes its canvas and stops drawing", async () => {
    const m = await openMap();
    m.step();
    m.port.setCursor("pointer");
    expect(m.canvas.style.cursor).toBe("pointer");
    m.port.setFilter(LAYER_RING, false);
    m.port.remove();
    expect(m.el.childElementCount).toBe(0);
    m.ops.length = 0;
    m.step();
    window.dispatchEvent(new Event("resize"));
    m.step();
    expect(m.ops).toEqual([]);
  });
});
