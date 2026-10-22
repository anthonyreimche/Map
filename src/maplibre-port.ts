// MapLibre behind MapPort. Imported lazily: the UMD bundle touches window and
// URL.createObjectURL at load (its inline worker), which tests never need.
//
// attributionControl stays false (never `{ compact: true }`): MapLibre's own
// AttributionControl writes source attribution HTML into innerHTML through
// `DOM.sanitize()`, the one caller of the vulnerable path behind the 5.19
// advisory GHSA-jrc7-96c5-q579. MapView renders the credit itself as React
// elements instead (see ATTRIBUTION in style.ts).
//
// Rotation and pitch are disabled throughout: the bounds filter assumes an
// unrotated view, and right-click must stay the photo/map context menu rather
// than a rotate gesture. boxZoom is disabled too: its BoxZoomHandler activates
// on Shift+left-button and suppresses the next click even with zero movement,
// which would otherwise swallow every Shift+click (range-select). The keyboard
// handler is off so arrow and rating keys keep their Safelight meaning (core's
// culling shortcuts) instead of also panning the map.
//
// "ready" is MapLibre's first "style.load", not its "load": "load" waits until
// every visible basemap tile has arrived or failed, which on a slow or
// filtered connection can take minutes, and the photos must not wait for it.
//
// A lost WebGL context makes MapLibre destroy its style until the context
// comes back, and every call that reaches the style would then throw. The
// view replaces the map on "webglcontextrestored", so from the loss on this
// port stays inert: writes do nothing and reads answer as an empty map.

import type { FilterSpecification, GeoJSONSource, LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";
import type { GeoJSON, Point } from "geojson";
import { boundsFromMap } from "./geo";
import { keepPhotoLayers } from "./map-layers";
import type { MapFactory, MapPort, RenderedHit } from "./map-port";

export const maplibreFactory: MapFactory = async (container, style, center, zoom, pixelRatio) => {
  const maplibregl = await import("maplibre-gl");
  const map = new maplibregl.Map({
    container,
    style: style as unknown as StyleSpecification,
    center: [center.lon, center.lat],
    zoom,
    pixelRatio,
    attributionControl: false,
    maplibreLogo: false,
    doubleClickZoom: false,
    fadeDuration: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    boxZoom: false,
    keyboard: false,
  });
  map.touchZoomRotate.disableRotation();
  const geojson = (id: string) => map.getSource(id) as GeoJSONSource | undefined;

  let ready = false;
  const waiting: (() => void)[] = [];
  map.once("style.load", () => {
    ready = true;
    for (const handler of waiting.splice(0)) handler();
  });
  let lost = false;
  map.on("webglcontextlost", () => {
    lost = true;
  });
  const live = (write: () => void) => {
    if (!lost) write();
  };

  const port: MapPort = {
    kind: "full",
    on: (event, handler) => {
      if (event !== "ready") return void map.on(event, () => handler());
      if (ready) handler();
      else waiting.push(handler);
    },
    // A source-originated error bubbles up through Style → Map with a
    // sourceId merged onto the event (MapLibre's Evented forwards a
    // TileManager's own events to its parent with { isSourceLoaded, source,
    // sourceId }); that merge isn't reflected in MapLibre's own ErrorEvent
    // type, so the field is read via a narrow cast rather than a formal one.
    onError: (handler) =>
      void map.on("error", (e) => {
        const sourceId = (e as unknown as { sourceId?: string }).sourceId;
        handler(sourceId, e.error?.message ?? "map error");
      }),
    onSourceLoaded: (handler) =>
      void map.on("sourcedata", (e) => {
        if (e.isSourceLoaded) handler(e.sourceId);
      }),
    onImageMissing: (handler) => void map.on("styleimagemissing", (e) => handler(e.id)),
    addSource: (id, spec) => live(() => map.addSource(id, spec as SourceSpecification)),
    removeSource: (id) =>
      live(() => {
        if (map.getSource(id)) map.removeSource(id);
      }),
    addLayer: (spec) => live(() => map.addLayer(spec as LayerSpecification)),
    removeLayer: (id) =>
      live(() => {
        if (map.getLayer(id)) map.removeLayer(id);
      }),
    setFilter: (id, filter) => live(() => map.setFilter(id, filter as FilterSpecification)),
    setData: (id, data) => live(() => geojson(id)?.setData(data as GeoJSON)),
    clusterExpansionZoom: (id, clusterId) =>
      lost
        ? Promise.reject(new Error("the map renderer was lost"))
        : (geojson(id)?.getClusterExpansionZoom(clusterId) ?? Promise.resolve(map.getZoom())),
    hasImage: (id) => !lost && map.hasImage(id),
    addImage: (id, image, ratio) => live(() => map.addImage(id, image, { pixelRatio: ratio })),
    updateImage: (id, image) => live(() => map.updateImage(id, image)),
    setStyle: (next) =>
      live(() =>
        map.setStyle(next as unknown as StyleSpecification, {
          transformStyle: (prev, nextStyle) => keepPhotoLayers(prev, nextStyle),
        }),
      ),
    easeTo: (c, z, duration) => void map.easeTo({ center: [c.lon, c.lat], ...(z === null ? {} : { zoom: z }), duration }),
    fitBounds: (b, padding, maxZoom) =>
      void map.fitBounds(
        [
          [b.west, b.south],
          [b.east, b.north],
        ],
        { padding, maxZoom, duration: 600 },
      ),
    getBounds: () => {
      const b = map.getBounds();
      return boundsFromMap(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
    },
    getCenter: () => {
      const c = map.getCenter();
      return { lon: c.lng, lat: c.lat };
    },
    getZoom: () => map.getZoom(),
    unproject: (x, y) => {
      const l = map.unproject([x, y]);
      return { lon: l.lng, lat: l.lat };
    },
    hitTest: (x, y, layers) =>
      lost
        ? []
        : map.queryRenderedFeatures([x, y], { layers: [...layers] }).map((f): RenderedHit => {
            const [lon, lat] = (f.geometry as Point).coordinates;
            const props = (f.properties ?? {}) as Record<string, unknown>;
            return {
              layer: f.layer.id,
              id: typeof props.id === "string" ? props.id : null,
              clusterId: typeof props.cluster_id === "number" ? props.cluster_id : null,
              lon,
              lat,
            };
          }),
    setCursor: (cursor) => {
      map.getCanvas().style.cursor = cursor;
    },
    setPixelRatio: (ratio) => live(() => map.setPixelRatio(ratio)),
    remove: () => map.remove(),
  };
  return port;
};
