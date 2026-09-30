import { describe, expect, it } from "vitest";
import { PIN_SIZE, createPinRasteriser, photoIdOf, pinImageId, placeholderPin, type PinImage } from "../src/pins";
import { parseHex } from "../src/palette";

const img = (tag: string): PinImage => ({ width: 1, height: 1, data: new Uint8ClampedArray([tag.length, 0, 0, 255]) });

/** A drawer whose promises resolve only when the test says so. */
function controlledDrawer() {
  const pending: { url: string; resolve: (v: PinImage | null) => void }[] = [];
  const draw = (url: string) => new Promise<PinImage | null>((resolve) => pending.push({ url, resolve }));
  return { draw, pending, finish: (i: number) => pending[i].resolve(img(pending[i].url)) };
}

/** Like `controlledDrawer`, but also records the border each draw call used —
 *  needed to prove a stale in-flight draw is redrawn with the current border. */
function controlledBorderedDrawer() {
  const pending: { url: string; border: string; resolve: (v: PinImage | null) => void }[] = [];
  const draw = (url: string, _size: number, _pixelRatio: number, border: string) =>
    new Promise<PinImage | null>((resolve) => pending.push({ url, border, resolve }));
  return { draw, pending, finish: (i: number) => pending[i].resolve(img(pending[i].url)) };
}

describe("ids", () => {
  it("prefixes and strips", () => {
    expect(pinImageId("abc")).toBe("pin:abc");
    expect(photoIdOf("pin:abc")).toBe("abc");
    expect(photoIdOf("marker-15")).toBeNull();
  });
});

describe("createPinRasteriser", () => {
  it("draws at most `concurrency` pins at once and delivers each when done", async () => {
    const d = controlledDrawer();
    const ready: string[] = [];
    const r = createPinRasteriser({ draw: d.draw, border: "#fff", concurrency: 2 });
    for (const id of ["a", "b", "c"]) r.request(id, `u-${id}`, () => ready.push(id));
    expect(d.pending.map((p) => p.url)).toEqual(["u-a", "u-b"]);
    d.finish(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toEqual(["a"]);
    expect(d.pending.map((p) => p.url)).toEqual(["u-a", "u-b", "u-c"]);
  });

  it("serves a cached pin synchronously and dedupes in-flight requests", async () => {
    const d = controlledDrawer();
    const r = createPinRasteriser({ draw: d.draw, border: "#fff" });
    let count = 0;
    r.request("a", "u", () => count++);
    r.request("a", "u", () => count++);
    expect(d.pending.length).toBe(1);
    d.finish(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(count).toBe(2);
    expect(r.has("a", "u")).toBe(true);
    r.request("a", "u", () => count++);
    expect(count).toBe(3);
    expect(d.pending.length).toBe(1);
  });

  it("re-draws when the thumbnail URL changes or the border colour changes", async () => {
    const d = controlledDrawer();
    const r = createPinRasteriser({ draw: d.draw, border: "#fff" });
    r.request("a", "u1", () => {});
    d.finish(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.has("a", "u1")).toBe(true);
    expect(r.has("a", "u2")).toBe(false);
    r.setBorder("#000");
    expect(r.has("a", "u1")).toBe(false);
    expect(r.size()).toBe(0);
  });

  it("evicts the least recently used pin past capacity", async () => {
    const d = controlledDrawer();
    const r = createPinRasteriser({ draw: d.draw, border: "#fff", capacity: 2, concurrency: 8 });
    r.request("a", "u", () => {});
    r.request("b", "u", () => {});
    d.finish(0);
    d.finish(1);
    await Promise.resolve();
    await Promise.resolve();
    r.request("a", "u", () => {});
    r.request("c", "u", () => {});
    d.finish(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.has("a", "u")).toBe(true);
    expect(r.has("b", "u")).toBe(false);
    expect(r.has("c", "u")).toBe(true);
  });

  it("drops a pin the drawer could not produce, without caching the failure", async () => {
    const d = controlledDrawer();
    let delivered = 0;
    const r = createPinRasteriser({ draw: d.draw, border: "#fff" });
    r.request("a", "u", () => delivered++);
    d.pending[0].resolve(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toBe(0);
    expect(r.has("a", "u")).toBe(false);
  });

  describe("in-flight staleness", () => {
    it("redraws for every waiting callback when setBorder changes the border mid-draw", async () => {
      const d = controlledBorderedDrawer();
      const delivered: PinImage[] = [];
      const r = createPinRasteriser({ draw: d.draw, border: "#fff" });

      r.request("a", "u", (image) => delivered.push(image));
      expect(d.pending[0].border).toBe("#fff");

      r.setBorder("#000");
      // The view re-requests every pin already on the map right after a theme change;
      // this id is still in flight, so the re-request joins the same job.
      r.request("a", "u", (image) => delivered.push(image));

      d.finish(0); // the stale (old-border) draw completes
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(delivered).toEqual([]);
      expect(r.has("a", "u")).toBe(false);
      expect(d.pending.length).toBe(2);
      expect(d.pending[1].border).toBe("#000");

      d.finish(1); // the redraw, made with the current border, completes
      await Promise.resolve();
      await Promise.resolve();

      expect(delivered.length).toBe(2);
      expect(r.has("a", "u")).toBe(true);
    });

    it("caches and delivers the new URL, never the stale image, when the preview URL changes mid-draw", async () => {
      const d = controlledBorderedDrawer();
      const delivered: PinImage[] = [];
      const r = createPinRasteriser({ draw: d.draw, border: "#fff" });

      r.request("a", "orig", (image) => delivered.push(image));
      expect(d.pending[0].url).toBe("orig");

      // The photo was edited: its preview now has a new URL, requested again while
      // the old draw (of "orig") is still in flight.
      r.request("a", "edited", (image) => delivered.push(image));

      d.finish(0); // the stale ("orig") draw completes
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(delivered).toEqual([]);
      expect(r.has("a", "orig")).toBe(false);
      expect(d.pending.length).toBe(2);
      expect(d.pending[1].url).toBe("edited");

      d.finish(1); // the redraw, made with the current URL, completes
      await Promise.resolve();
      await Promise.resolve();

      expect(delivered.length).toBe(2);
      for (const image of delivered) expect(image.data[0]).toBe("edited".length);
      expect(r.has("a", "edited")).toBe(true);
      expect(r.has("a", "orig")).toBe(false);
    });

    it("requeues, rather than drops, a failed draw when a still-current callback is waiting", async () => {
      const d = controlledDrawer();
      const delivered: PinImage[] = [];
      const r = createPinRasteriser({ draw: d.draw, border: "#fff" });

      r.request("a", "orig", (image) => delivered.push(image));
      expect(d.pending[0].url).toBe("orig");

      // The photo was edited while the "orig" draw was still in flight; the
      // re-request joins the same job and becomes the current URL.
      r.request("a", "edited", (image) => delivered.push(image));

      d.pending[0].resolve(null); // the stale ("orig") draw fails
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(delivered).toEqual([]);
      expect(d.pending.length).toBe(2);
      expect(d.pending[1].url).toBe("edited");

      d.finish(1); // the redraw, made with the current URL, succeeds
      await Promise.resolve();
      await Promise.resolve();

      expect(delivered.length).toBe(2);
      expect(r.has("a", "edited")).toBe(true);
    });
  });
});

describe("placeholderPin", () => {
  it("is a filled circle with a border, sized by pixel ratio", () => {
    const pin = placeholderPin(PIN_SIZE, 2, "#404040", "#ffffff");
    expect(pin.width).toBe(96);
    expect(pin.height).toBe(96);
    const px = (x: number, y: number) => Array.from(pin.data.slice((y * pin.width + x) * 4, (y * pin.width + x) * 4 + 4));
    expect(px(48, 48)).toEqual([...parseHex("#404040")!, 255]);
    expect(px(48, 2)).toEqual([...parseHex("#ffffff")!, 255]);
    expect(px(0, 0)[3]).toBe(0);
  });
});
