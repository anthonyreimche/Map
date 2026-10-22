// The slice of a map the view drives. MapLibre implements it in
// maplibre-port.ts, the Canvas 2D stand-in in canvas-port.ts; tests hand the
// view a fake.

import type { Bounds, LonLat } from "./geo";
import type { PinImage } from "./pins";
import type { MapStyle } from "./style";

export interface RenderedHit {
  layer: string;
  /** The photo id of a pin, null for a cluster. */
  id: string | null;
  clusterId: number | null;
  lon: number;
  lat: number;
}

/** "full" is MapLibre over the vector basemap; "basic" is the Canvas 2D map
 *  over a world outline, for a machine where WebGL is unavailable. */
export type MapKind = "full" | "basic";

/** "ready" fires once, when the style is parsed and our sources and layers may
 *  be added; basemap tiles may still be loading. "webglcontextrestored" means
 *  the GPU is back after a "webglcontextlost". */
export type MapEvent = "ready" | "movestart" | "moveend" | "webglcontextlost" | "webglcontextrestored";

export interface MapPort {
  readonly kind: MapKind;
  on(event: MapEvent, handler: () => void): void;
  /** sourceId is undefined for an error that didn't originate from a source
   *  (a style/WebGL error); callers gate on it to tell a basemap tile failure
   *  apart from one of our own sources or an unrelated error. */
  onError(handler: (sourceId: string | undefined, message: string) => void): void;
  onSourceLoaded(handler: (sourceId: string) => void): void;
  onImageMissing(handler: (imageId: string) => void): void;
  addSource(id: string, spec: object): void;
  removeSource(id: string): void;
  addLayer(spec: object): void;
  removeLayer(id: string): void;
  setFilter(layerId: string, filter: unknown[] | boolean): void;
  setData(sourceId: string, data: object): void;
  clusterExpansionZoom(sourceId: string, clusterId: number): Promise<number>;
  hasImage(id: string): boolean;
  addImage(id: string, image: PinImage, pixelRatio: number): void;
  updateImage(id: string, image: PinImage): void;
  /** Swap the basemap, keeping our sources and layers (keepPhotoLayers). */
  setStyle(style: MapStyle): void;
  easeTo(center: LonLat, zoom: number | null, durationMs: number): void;
  fitBounds(b: Bounds, paddingPx: number, maxZoom: number): void;
  getBounds(): Bounds;
  getCenter(): LonLat;
  getZoom(): number;
  unproject(x: number, y: number): LonLat;
  hitTest(x: number, y: number, layers: readonly string[]): RenderedHit[];
  setCursor(cursor: string): void;
  /** Device pixels per layout pixel: the display's scale times Safelight's
   *  interface zoom. */
  setPixelRatio(ratio: number): void;
  remove(): void;
}

export type MapFactory = (container: HTMLElement, style: MapStyle, center: LonLat, zoom: number, pixelRatio: number) => Promise<MapPort>;
