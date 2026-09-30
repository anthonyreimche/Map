// Pin images for the symbol layer: each located photo's preview drawn into a
// rounded square with a border. Rasterisation is async and bounded; the cache
// is keyed by photo id and preview URL so an edited preview redraws its pin.

import { parseHex } from "./palette";

export const PIN_PREFIX = "pin:";
export const PIN_SIZE = 48;
const CORNER = 6;
const BORDER = 2;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_CAPACITY = 2000;

export const pinImageId = (id: string): string => `${PIN_PREFIX}${id}`;
export const photoIdOf = (imageId: string): string | null =>
  imageId.startsWith(PIN_PREFIX) ? imageId.slice(PIN_PREFIX.length) : null;

export interface PinImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type PinDrawer = (url: string, size: number, pixelRatio: number, border: string) => Promise<PinImage | null>;

export interface PinRasteriser {
  request(id: string, url: string, onReady: (image: PinImage) => void): void;
  has(id: string, url: string): boolean;
  /** A new border colour (theme change) invalidates every cached pin. */
  setBorder(border: string): void;
  size(): number;
}

export interface PinRasteriserOptions {
  draw: PinDrawer;
  border: string;
  pixelRatio?: number;
  concurrency?: number;
  capacity?: number;
}

export function createPinRasteriser(opts: PinRasteriserOptions): PinRasteriser {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const pixelRatio = opts.pixelRatio ?? 1;
  let border = opts.border;
  const cache = new Map<string, { url: string; image: PinImage }>();
  const waiting = new Map<string, { url: string; callbacks: ((image: PinImage) => void)[] }>();
  const queue: string[] = [];
  let active = 0;

  const touch = (id: string, entry: { url: string; image: PinImage }) => {
    cache.delete(id);
    cache.set(id, entry);
    while (cache.size > capacity) cache.delete(cache.keys().next().value as string);
  };

  const pump = () => {
    while (active < concurrency && queue.length) {
      const id = queue.shift() as string;
      const job = waiting.get(id);
      if (!job) continue;
      active++;
      const borderAtStart = border;
      const urlAtStart = job.url;
      void opts
        .draw(job.url, PIN_SIZE, pixelRatio, border)
        .catch(() => null)
        .then((image) => {
          active--;
          // A draw (success or failure) is only conclusive for the border/URL it
          // ran with. If either moved on while it was in flight, requeue the job
          // (callbacks and all) to redraw against what's current now — whether it
          // succeeded or failed — instead of caching, delivering, or dropping it.
          const stale = job.url !== urlAtStart || border !== borderAtStart;
          if (stale) {
            queue.push(id);
          } else if (image) {
            waiting.delete(id);
            touch(id, { url: job.url, image });
            for (const cb of job.callbacks) cb(image);
          } else {
            waiting.delete(id);
          }
          pump();
        });
    }
  };

  return {
    request(id, url, onReady) {
      const hit = cache.get(id);
      if (hit && hit.url === url) {
        touch(id, hit);
        onReady(hit.image);
        return;
      }
      const job = waiting.get(id);
      if (job) {
        job.url = url;
        job.callbacks.push(onReady);
        return;
      }
      waiting.set(id, { url, callbacks: [onReady] });
      queue.push(id);
      pump();
    },
    has: (id, url) => cache.get(id)?.url === url,
    setBorder(next) {
      if (next === border) return;
      border = next;
      cache.clear();
    },
    size: () => cache.size,
  };
}

/** A plain disc with a border, computed per pixel (no canvas): what a pin
 *  shows until its preview is drawn, and the whole pin when thumbnails are off. */
export function placeholderPin(size: number, pixelRatio: number, fill: string, border: string): PinImage {
  const px = Math.round(size * pixelRatio);
  const data = new Uint8ClampedArray(px * px * 4);
  const f = parseHex(fill) ?? [64, 64, 64];
  const b = parseHex(border) ?? [255, 255, 255];
  const c = px / 2;
  const outer = c;
  const inner = c - BORDER * pixelRatio;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (d > outer) continue;
      const rgb = d > inner ? b : f;
      const i = (y * px + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { width: px, height: px, data };
}

/** The in-app drawer: decode the preview, cover-fit it into a rounded square,
 *  stroke the border, read the pixels back. Needs a real canvas — not unit-tested. */
export const drawPinFromUrl: PinDrawer = async (url, size, pixelRatio, border) => {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const px = Math.round(size * pixelRatio);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const r = CORNER * pixelRatio;
  ctx.beginPath();
  ctx.roundRect(0, 0, px, px, r);
  ctx.clip();
  const scale = Math.max(px / image.naturalWidth, px / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  ctx.drawImage(image, (px - w) / 2, (px - h) / 2, w, h);
  ctx.lineWidth = BORDER * 2 * pixelRatio;
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.roundRect(0, 0, px, px, r);
  ctx.stroke();
  const { width, height, data } = ctx.getImageData(0, 0, px, px);
  return { width, height, data };
};
