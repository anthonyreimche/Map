// Which map a view gets: the full MapLibre map where it can start, else the
// basic Canvas 2D map. The full map fails to start wherever WebGL is missing
// or refused: no usable GPU driver, a remote desktop or VM without Direct3D 11,
// a GPU that Chromium has blocked for a while after a reset.

import { canvasFactory } from "./canvas-port";
import type { MapFactory } from "./map-port";
import { maplibreFactory } from "./maplibre-port";

export function withFallback(full: MapFactory, basic: MapFactory): MapFactory {
  return async (container, style, center, zoom, pixelRatio) => {
    try {
      return await full(container, style, center, zoom, pixelRatio);
    } catch (e) {
      console.warn("[map] The full map could not start; using the basic map.", e);
      // MapLibre leaves its canvas container behind when it throws part-way.
      container.replaceChildren();
      return basic(container, style, center, zoom, pixelRatio);
    }
  };
}

export const defaultFactory: MapFactory = withFallback(maplibreFactory, canvasFactory);
