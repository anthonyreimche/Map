// The Map module's main view. MapLibre is driven through MapPort; this file
// owns the data flow (visible photos → features → source), the interactions
// (select, open, cluster zoom, drop-to-geotag, context menus), the theme and
// preference reactions, and the notices. Pointer hit-testing goes through the
// frame's own React events + hitTest so a fake port can stand in.

import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { DND_PHOTOS, readDroppedIds } from "./dnd";
import { exifTime } from "./exif-time";
import { FILTER_ID, syncInViewFilter } from "./filter";
import type { Bounds, LonLat } from "./geo";
import { boundsOf, hasLocation, inBounds, locationOf, photoFeatures, wrapLon } from "./geo";
import { catalogDeps, place } from "./geotag";
import { LocationDialogHost } from "./LocationDialog";
import {
  LAYER_CLUSTERS,
  LAYER_PINS,
  LAYER_RING,
  OUR_LAYER_IDS,
  OUR_SOURCE_IDS,
  OVERLAY_LINE_SOURCE,
  OVERLAY_POINT_SOURCE,
  PHOTO_COUNT_SOURCE,
  PHOTO_SOURCE,
  overlayLineLayerSpec,
  overlayPointLayerSpec,
  overlaySourceSpec,
  photoLayerSpecs,
  photoSourceSpec,
  selectionFilter,
} from "./map-layers";
import { defaultFactory } from "./fallback";
import type { MapFactory, MapPort } from "./map-port";
import type { OverlayData } from "./overlays";
import { cssVarReader, palette, readThemeTokens, type Palette } from "./palette";
import { PIN_SIZE, createPinRasteriser, drawPinFromUrl, photoIdOf, pinImageId, placeholderPin, type PinDrawer, type PinRasteriser } from "./pins";
import { readSavedView, usePrefs, writeSavedView, type Prefs, type SavedView } from "./prefs";
import { React, api, ui } from "./rt";
import type { CatalogPhoto } from "./safelight";
import { ATTRIBUTION, BASEMAP_SOURCE, LAND_ATTRIBUTION, buildStyle } from "./style";
import { store, useMapStore } from "./store";
import { Toolbar } from "./Toolbar";

export interface MapViewProps {
  factory?: MapFactory;
  draw?: PinDrawer;
  /** Overrides the measured ratio (framePixelRatio). */
  pixelRatio?: number;
}

const WORLD: SavedView = { lon: 0, lat: 20, zoom: 1 };
const FLY_MIN_ZOOM = 10;
const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 16;
const CLICK_SLOP = 4;
const SAVE_VIEW_DELAY = 500;
const EASE_MS = 600;
const MENU_MARGIN = 4;
/** How long the basemap may stay silent before the tile notice goes up: a
 *  filtered host can hold requests open for minutes without an error. */
const TILE_PATIENCE_MS = 15_000;

const countInView = (photos: readonly CatalogPhoto[], b: Bounds | null): number =>
  b ? photos.filter((p) => inBounds(locationOf(p)!, b)).length : 0;

const hoverText = (p: CatalogPhoto): string => {
  const t = exifTime(p.exif.dateTimeOriginal);
  return t === undefined ? p.filename : `${p.filename} · ${new Date(t).toLocaleString()}`;
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// The photo features by content: `located` gets a new identity whenever the
// host re-derives the visible photos (a grid-filter re-registration, any
// catalog update), whether or not any location changed.
const locationSignature = (photos: readonly CatalogPhoto[]): string =>
  photos.map((p) => `${p.id}@${locationOf(p)?.lon},${locationOf(p)?.lat}`).join("|");

// The map draws world copies, so a point can unproject to a longitude past ±180.
const lonLatAt = (m: MapPort, pt: { x: number; y: number }): LonLat => {
  const at = m.unproject(pt.x, pt.y);
  return { lon: wrapLon(at.lon), lat: at.lat };
};

/** Device pixels per layout pixel in the frame: the display's scale times the
 *  interface zoom Safelight applies as CSS `zoom`, under which a canvas sized
 *  in layout pixels would otherwise be stretched (blurred above 100%). The
 *  zoom comes from currentCSSZoom where the browser has it; measured instead,
 *  it carries the rounding of offsetWidth, so it is rounded to hundredths. */
const framePixelRatio = (frame: HTMLElement | null): number => {
  const dpr = window.devicePixelRatio || 1;
  if (!frame) return dpr;
  const zoom =
    typeof frame.currentCSSZoom === "number"
      ? frame.currentCSSZoom
      : frame.offsetWidth
        ? Math.round((frame.getBoundingClientRect().width / frame.offsetWidth) * 100) / 100
        : 1;
  return dpr * (zoom || 1);
};

function addLayers(m: MapPort, pal: Palette, prefs: Prefs, located: readonly CatalogPhoto[], overlays: OverlayData): void {
  const photos = photoFeatures(located, pinImageId);
  m.addSource(PHOTO_SOURCE, photoSourceSpec(photos, prefs.clusterRadius));
  m.addSource(PHOTO_COUNT_SOURCE, photoSourceSpec(photos, prefs.clusterRadius));
  m.addSource(OVERLAY_LINE_SOURCE, overlaySourceSpec(overlays.lines));
  m.addSource(OVERLAY_POINT_SOURCE, overlaySourceSpec(overlays.points));
  m.addLayer(overlayLineLayerSpec(pal));
  m.addLayer(overlayPointLayerSpec(pal));
  for (const spec of photoLayerSpecs(pal, prefs.pinThumbnails)) m.addLayer(spec);
}

function rebuild(m: MapPort, pal: Palette, prefs: Prefs, located: readonly CatalogPhoto[], overlays: OverlayData): void {
  for (const id of OUR_LAYER_IDS) m.removeLayer(id);
  for (const id of OUR_SOURCE_IDS) m.removeSource(id);
  addLayers(m, pal, prefs, located, overlays);
}

function setPhotoData(m: MapPort, located: readonly CatalogPhoto[]): void {
  const photos = photoFeatures(located, pinImageId);
  m.setData(PHOTO_SOURCE, photos);
  m.setData(PHOTO_COUNT_SOURCE, photos);
}

function fitTo(m: MapPort, photos: readonly CatalogPhoto[]): void {
  const b = boundsOf(photos.map((p) => locationOf(p)!));
  if (b) m.fitBounds(b, FIT_PADDING, FIT_MAX_ZOOM);
}

interface MapMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

/** The map's own right-click menu, kept inside the box it is positioned in.
 *  Closes on Escape and whenever another context menu opens. */
function MapMenu({ x, y, onClose, children }: MapMenuProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState({ x, y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.offsetParent;
    setPos(
      el && box
        ? {
            x: Math.max(0, Math.min(x, box.clientWidth - el.offsetWidth - MENU_MARGIN)),
            y: Math.max(0, Math.min(y, box.clientHeight - el.offsetHeight - MENU_MARGIN)),
          }
        : { x, y },
    );
  }, [x, y]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    // Capture phase: runs before the handler that opens the next menu.
    window.addEventListener("contextmenu", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("contextmenu", onClose, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: 4,
        borderRadius: 4,
        background: ui.tokens.surface1,
        border: `1px solid ${ui.tokens.border}`,
        zIndex: 2,
      }}
    >
      {children}
    </div>
  );
}

export function MapView({ factory = defaultFactory, draw = drawPinFromUrl, pixelRatio }: MapViewProps) {
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [map, setMap] = React.useState<MapPort | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [generation, setGeneration] = React.useState(0);
  const [initFailed, setInitFailed] = React.useState(false);
  const [styleFailed, setStyleFailed] = React.useState(false);
  const prefs = usePrefs();
  const photos = api.catalog.useVisiblePhotos({ without: [FILTER_ID] });
  const located = React.useMemo(() => photos.filter(hasLocation), [photos]);
  const byId = React.useMemo(() => new Map(photos.map((p) => [p.id, p] as const)), [photos]);
  const catalog = api.stores.useCatalogStore;
  const selectedIds = catalog((s) => s.selectedIds);
  const activePhotoId = catalog((s) => s.activePhotoId);
  const themeId = api.stores.useThemeStore((s) => s.activeId);
  const overlayData = useMapStore((s) => s.overlayData);
  const tileError = useMapStore((s) => s.tileError);
  const rendererLost = useMapStore((s) => s.rendererLost);
  const error = useMapStore((s) => s.error);
  const { onContextMenu, overlays } = api.catalog.usePhotoActions();
  const [hover, setHover] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; loc: LonLat } | null>(null);
  const closeMenu = React.useCallback(() => setMenu(null), []);

  // Refs let long-lived map handlers read the latest values without re-wiring.
  const locatedRef = React.useRef(located);
  locatedRef.current = located;
  const byIdRef = React.useRef(byId);
  byIdRef.current = byId;
  const prefsRef = React.useRef(prefs);
  prefsRef.current = prefs;
  const pixelRatioProp = React.useRef(pixelRatio);
  pixelRatioProp.current = pixelRatio;
  // The ratio the map last took, and the one its pins are rasterised at: pins
  // keep the ratio of the map they were made for.
  const appliedRatio = React.useRef(1);
  const pinRatio = React.useRef(1);
  const palRef = React.useRef<Palette | null>(null);
  const pinsRef = React.useRef<PinRasteriser | null>(null);
  const pendingPins = React.useRef(new Set<string>());
  const appliedTheme = React.useRef(themeId);
  const press = React.useRef<{ x: number; y: number } | null>(null);
  // clusterRadius/pinThumbnails last applied to the built layers: guards the
  // prefs effect below so it rebuilds only on a real change, not whenever
  // `loaded` itself toggles (that build already happened, in "ready").
  const appliedPrefs = React.useRef<{ clusterRadius: number; pinThumbnails: boolean } | null>(null);
  const lastPushedLocated = React.useRef<string | null>(null);
  // overlayData gets a new reference on each delivery of map.overlays
  // (setOverlays), so a delivery that left the drawn content alone just pushes
  // the same data again, which is harmless.
  const lastPushedOverlays = React.useRef<OverlayData | undefined>(undefined);
  // The map a pin callback may still reach: a draw that resolves after
  // unmount or Reload must not touch the map it was started for.
  const liveMapRef = React.useRef<MapPort | null>(null);

  const requestPin = React.useCallback(
    (m: MapPort, id: string) => {
      const p = byIdRef.current.get(id);
      if (!p) return;
      if (!p.thumbnailUrl) {
        pendingPins.current.add(id);
        api.catalog.requestThumbnail(id);
        return;
      }
      pendingPins.current.delete(id);
      pinsRef.current?.request(id, p.thumbnailUrl, (image) => {
        if (liveMapRef.current !== m) return;
        const imageId = pinImageId(id);
        if (m.hasImage(imageId)) m.updateImage(imageId, image);
        else m.addImage(imageId, image, pinRatio.current);
      });
    },
    [],
  );

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let created: MapPort | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let tileTimer: ReturnType<typeof setTimeout> | null = null;
    // An earlier map's failures (the store outlives this view) don't apply to this one.
    store().getState().setRendererLost(false);
    store().getState().setTileError(false);
    setInitFailed(false);
    setStyleFailed(false);
    const pal = palette(readThemeTokens(cssVarReader()));
    palRef.current = pal;
    appliedTheme.current = themeId;
    const saved = readSavedView(api.settings.get);
    const view = saved ?? WORLD;
    const ratio = pixelRatioProp.current ?? framePixelRatio(frameRef.current);
    appliedRatio.current = ratio;
    pinRatio.current = ratio;
    pinsRef.current = createPinRasteriser({ draw, border: pal.pinBorder, pixelRatio: ratio });
    // A start that failed part-way leaves MapLibre's DOM behind.
    el.replaceChildren();

    void factory(el, buildStyle(pal), { lon: view.lon, lat: view.lat }, view.zoom, ratio)
      .then((m) => {
        if (cancelled) {
          m.remove();
          return;
        }
        created = m;
        liveMapRef.current = m;
        let styleLoaded = false;
        let basemapLoaded = false;
        const publishView = () => {
          const b = m.getBounds();
          const s = store().getState();
          s.setBounds(b);
          s.setCounts(s.located, s.total, countInView(locatedRef.current, b));
          if (s.filterToView) syncInViewFilter();
        };
        m.on("ready", () => {
          styleLoaded = true;
          const o = store().getState().overlayData;
          addLayers(m, pal, prefsRef.current, locatedRef.current, o);
          m.setFilter(LAYER_RING, selectionFilter([...catalog.getState().selectedIds]));
          appliedPrefs.current = { clusterRadius: prefsRef.current.clusterRadius, pinThumbnails: prefsRef.current.pinThumbnails };
          lastPushedLocated.current = locationSignature(locatedRef.current);
          lastPushedOverlays.current = o;
          setLoaded(true);
          // MapLibre's first "moveend" fires in its constructor, before our listener exists.
          publishView();
          if (!saved) fitTo(m, locatedRef.current);
          if (m.kind === "full" && !basemapLoaded) {
            tileTimer = setTimeout(() => store().getState().setTileError(true), TILE_PATIENCE_MS);
          }
        });
        m.onImageMissing((imageId) => {
          const id = photoIdOf(imageId);
          if (!id) return;
          const { pinFill, pinBorder } = palRef.current ?? pal;
          if (!m.hasImage(imageId)) m.addImage(imageId, placeholderPin(PIN_SIZE, pinRatio.current, pinFill, pinBorder), pinRatio.current);
          requestPin(m, id);
        });
        m.on("movestart", closeMenu);
        m.on("moveend", () => {
          publishView();
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            const c = m.getCenter();
            writeSavedView({ lon: c.lon, lat: c.lat, zoom: m.getZoom() });
          }, SAVE_VIEW_DELAY);
        });
        // Only the basemap's own errors and loads drive the tile notice: our
        // photo/overlay sources load right after "ready" and must not clear a
        // genuine basemap failure, and no other error may raise it. Those
        // others are logged here instead, since listening for "error" turns
        // MapLibre's own logging off; before "ready", one means the style failed.
        m.onError((sourceId, message) => {
          if (sourceId === BASEMAP_SOURCE) {
            store().getState().setTileError(true);
            return;
          }
          console.error("[map]", message);
          if (!styleLoaded) setStyleFailed(true);
        });
        m.onSourceLoaded((sourceId) => {
          if (sourceId !== BASEMAP_SOURCE) return;
          basemapLoaded = true;
          if (tileTimer) clearTimeout(tileTimer);
          store().getState().setTileError(false);
        });
        m.on("webglcontextlost", () => store().getState().setRendererLost(true));
        // The port went inert at the loss; a fresh map rebuilds everything.
        m.on("webglcontextrestored", () => setGeneration((g) => g + 1));
        store().getState().setCommands({
          fitToPhotos: () => fitTo(m, locatedRef.current),
          fitToOverlay: (key) => {
            const b = store().getState().overlays.find((o) => o.key === key)?.bounds;
            // boundsOf pads a lone point, which at a pole lands past ±90, and
            // MapLibre's fitBounds throws on a latitude outside that range.
            if (b) m.fitBounds({ ...b, south: Math.max(-90, b.south), north: Math.min(90, b.north) }, FIT_PADDING, FIT_MAX_ZOOM);
          },
          focus: (ids) => {
            const wanted = new Set(ids);
            fitTo(m, locatedRef.current.filter((p) => wanted.has(p.id)));
          },
        });
        setMap(m);
      })
      .catch(() => {
        if (cancelled) return;
        setInitFailed(true);
      });

    return () => {
      cancelled = true;
      liveMapRef.current = null;
      if (saveTimer) clearTimeout(saveTimer);
      if (tileTimer) clearTimeout(tileTimer);
      store().getState().setCommands(null);
      created?.remove();
      pinsRef.current = null;
      setMap(null);
      setLoaded(false);
    };
    // themeId is read once at creation; theme changes are handled below, and
    // pixel-ratio changes by the next effect.
  }, [factory, draw, generation, requestPin, closeMenu]);

  // A move to a display with another scale, or a new interface zoom, changes
  // the ratio; the map follows it in place.
  React.useEffect(() => {
    if (!map) return;
    const frame = frameRef.current;
    const update = () => {
      const next = pixelRatio ?? framePixelRatio(frame);
      if (Math.abs(next - appliedRatio.current) < 0.001) return;
      appliedRatio.current = next;
      map.setPixelRatio(next);
    };
    // No event announces a new devicePixelRatio; a media query on the current
    // one stops matching when it changes.
    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => {
      update();
      watchDpr();
    };
    const watchDpr = () => {
      dprQuery?.removeEventListener("change", onDprChange);
      dprQuery = typeof matchMedia === "function" ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
      dprQuery?.addEventListener("change", onDprChange);
    };
    update();
    watchDpr();
    window.addEventListener("resize", update);
    const resized = frame && typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (frame) resized?.observe(frame);
    return () => {
      dprQuery?.removeEventListener("change", onDprChange);
      window.removeEventListener("resize", update);
      resized?.disconnect();
    };
  }, [map, pixelRatio]);

  // Photos → source data, counts, and any pins still waiting for a preview.
  React.useEffect(() => {
    if (!map || !loaded) return;
    const signature = locationSignature(located);
    if (lastPushedLocated.current !== signature) {
      setPhotoData(map, located);
      lastPushedLocated.current = signature;
    }
    const s = store().getState();
    s.setCounts(located.length, photos.length, countInView(located, s.bounds));
    for (const id of [...pendingPins.current]) requestPin(map, id);
  }, [map, loaded, located, photos.length, requestPin]);

  React.useEffect(() => {
    if (!map || !loaded) return;
    map.setFilter(LAYER_RING, selectionFilter([...selectedIds]));
  }, [map, loaded, selectedIds]);

  React.useEffect(() => {
    if (!map || !loaded) return;
    if (lastPushedOverlays.current !== overlayData) {
      map.setData(OVERLAY_LINE_SOURCE, overlayData.lines);
      map.setData(OVERLAY_POINT_SOURCE, overlayData.points);
      lastPushedOverlays.current = overlayData;
    }
  }, [map, loaded, overlayData]);

  React.useEffect(() => {
    const s = store().getState();
    // Forgotten with the active photo, so activating the same one again flies.
    if (!activePhotoId) {
      if (s.handledActiveId !== null) s.setHandledActiveId(null);
      return;
    }
    if (!map || !loaded || !prefs.flyToActive || s.handledActiveId === activePhotoId) return;
    s.setHandledActiveId(activePhotoId);
    const p = byId.get(activePhotoId);
    const loc = p && locationOf(p);
    if (loc) map.easeTo(loc, Math.max(map.getZoom(), FLY_MIN_ZOOM), EASE_MS);
  }, [map, loaded, activePhotoId, prefs.flyToActive, byId]);

  React.useEffect(() => {
    if (!map || !loaded || appliedTheme.current === themeId) return;
    appliedTheme.current = themeId;
    const pal = palette(readThemeTokens(cssVarReader()));
    palRef.current = pal;
    map.setStyle(buildStyle(pal));
    rebuild(map, pal, prefsRef.current, locatedRef.current, overlayData);
    // A rebuild drops the ring layer's filter back to its empty default; the
    // selection-effect above won't rerun on its own (selectedIds hasn't
    // changed), so it's reapplied here against the freshly rebuilt layer.
    map.setFilter(LAYER_RING, selectionFilter([...catalog.getState().selectedIds]));
    appliedPrefs.current = { clusterRadius: prefsRef.current.clusterRadius, pinThumbnails: prefsRef.current.pinThumbnails };
    lastPushedLocated.current = locationSignature(locatedRef.current);
    lastPushedOverlays.current = overlayData;
    pinsRef.current?.setBorder(pal.pinBorder);
    for (const p of locatedRef.current) if (map.hasImage(pinImageId(p.id))) requestPin(map, p.id);
  }, [map, loaded, themeId, overlayData, requestPin]);

  React.useEffect(() => {
    if (!map || !loaded || !palRef.current) return;
    const applied = appliedPrefs.current;
    if (applied && applied.clusterRadius === prefs.clusterRadius && applied.pinThumbnails === prefs.pinThumbnails) return;
    rebuild(map, palRef.current, prefs, locatedRef.current, overlayData);
    map.setFilter(LAYER_RING, selectionFilter([...catalog.getState().selectedIds]));
    appliedPrefs.current = { clusterRadius: prefs.clusterRadius, pinThumbnails: prefs.pinThumbnails };
    lastPushedLocated.current = locationSignature(locatedRef.current);
    lastPushedOverlays.current = overlayData;
  }, [map, loaded, prefs.clusterRadius, prefs.pinThumbnails]);

  React.useEffect(() => {
    if (!map || !loaded) return;
    const s = store().getState();
    if (s.pendingFocus && s.commands) {
      s.setPendingFocus(null);
      s.commands.focus(s.pendingFocus);
    }
  }, [map, loaded]);

  React.useEffect(() => {
    if (!map || !loaded) return;
    const s = store().getState();
    if (s.pendingFit !== null && s.commands) {
      const key = s.pendingFit;
      s.setPendingFit(null);
      s.commands.fitToOverlay(key);
    }
  }, [map, loaded]);

  // Safelight scales its UI with a CSS `zoom`, under which clientX/Y are in
  // scaled pixels while the map's canvas works in layout pixels. Divide by
  // the frame's own scale factor, the way MapLibre's DOM.mousePos does, so
  // every consumer (hit tests, unproject, tooltip/menu placement) stays in
  // layout pixels regardless of the zoom level.
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const el = frameRef.current;
    const r = el?.getBoundingClientRect();
    if (!el || !r) return { x: e.clientX, y: e.clientY };
    const scaleX = r.width / el.offsetWidth || 1;
    const scaleY = r.height / el.offsetHeight || 1;
    return { x: (e.clientX - r.left) / scaleX, y: (e.clientY - r.top) / scaleY };
  };

  // True only when the event's target is the map canvas area itself, not one
  // of our own overlays (hover tooltip, context menu, notices, credit links)
  // — those sit in the same frame, so without this a click on "Reload map" or
  // a menu item would bubble into a hit test and select or zoom whatever is
  // rendered underneath it.
  const overMap = (e: { target: EventTarget | null }): boolean => containerRef.current?.contains(e.target as Node) ?? false;

  // A photo made active from the map is already in view: never fly to it.
  const markActiveHandled = () => store().getState().setHandledActiveId(catalog.getState().activePhotoId);

  const selectPin = (id: string, e: ReactMouseEvent) => {
    const s = catalog.getState();
    if (e.shiftKey) s.selectRange(id, locatedRef.current.map((p) => p.id));
    else if (e.ctrlKey || e.metaKey) s.toggleSelect(id);
    else s.select(id);
    markActiveHandled();
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!loaded || !overMap(e)) return;
    press.current = localPoint(e);
  };

  const onClick = (e: ReactMouseEvent) => {
    if (!map || !loaded || !overMap(e)) return;
    const pt = localPoint(e);
    const down = press.current;
    if (down && Math.hypot(pt.x - down.x, pt.y - down.y) > CLICK_SLOP) return;
    setMenu(null);
    const pin = map.hitTest(pt.x, pt.y, [LAYER_PINS])[0];
    if (pin?.id) {
      selectPin(pin.id, e);
      return;
    }
    const cluster = map.hitTest(pt.x, pt.y, [LAYER_CLUSTERS])[0];
    if (cluster && cluster.clusterId !== null) {
      const at = { lon: cluster.lon, lat: cluster.lat };
      void map
        .clusterExpansionZoom(PHOTO_SOURCE, cluster.clusterId)
        .then((z) => map.easeTo(at, z, EASE_MS / 2))
        // The cluster id is stale once the source's data has changed.
        .catch(() => {});
    }
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!map || !loaded || !overMap(e)) return;
    const pt = localPoint(e);
    const pin = map.hitTest(pt.x, pt.y, [LAYER_PINS])[0];
    if (pin?.id) {
      catalog.getState().select(pin.id);
      api.navigation.goTo("develop");
    } else map.easeTo(map.unproject(pt.x, pt.y), map.getZoom() + 1, EASE_MS / 2);
  };

  const onFrameContextMenu = (e: ReactMouseEvent) => {
    if (!map || !loaded || !overMap(e)) return;
    const pt = localPoint(e);
    const pin = map.hitTest(pt.x, pt.y, [LAYER_PINS])[0];
    if (pin?.id) {
      onContextMenu(pin.id, e);
      markActiveHandled();
      return;
    }
    e.preventDefault();
    setMenu({ x: pt.x, y: pt.y, loc: lonLatAt(map, pt) });
  };

  const onMouseMove = (e: ReactMouseEvent) => {
    // A held button is a pan: two hit tests per move would only slow it.
    if (!map || !loaded || !overMap(e) || e.buttons !== 0) {
      setHover(null);
      return;
    }
    const pt = localPoint(e);
    const pin = map.hitTest(pt.x, pt.y, [LAYER_PINS])[0];
    const cluster = pin ? null : map.hitTest(pt.x, pt.y, [LAYER_CLUSTERS])[0];
    map.setCursor(pin || cluster ? "pointer" : "");
    const p = pin?.id ? byId.get(pin.id) : undefined;
    setHover(p ? { x: pt.x, y: pt.y, text: hoverText(p) } : null);
  };

  const onDragOver = (e: ReactDragEvent) => {
    if (e.dataTransfer.types.includes(DND_PHOTOS)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const onDrop = (e: ReactDragEvent) => {
    if (!map) return;
    const ids = readDroppedIds(e.dataTransfer);
    if (ids.length === 0) return;
    e.preventDefault();
    const loc = lonLatAt(map, localPoint(e));
    void place(ids, { lat: loc.lat, lon: loc.lon }, catalogDeps()).catch((err: unknown) => store().getState().setError(errorText(err)));
  };

  const placeSelectedAt = (loc: LonLat) => {
    const ids = [...catalog.getState().selectedIds];
    setMenu(null);
    void place(ids, { lat: loc.lat, lon: loc.lon }, catalogDeps()).catch((err: unknown) => store().getState().setError(errorText(err)));
  };

  const reload = () => {
    store().getState().setRendererLost(false);
    setInitFailed(false);
    setGeneration((g) => g + 1);
  };

  const selectedCount = selectedIds.size;
  const { Button } = ui;
  const basic = map?.kind === "basic";
  const notice = error ?? (styleFailed ? "Map style failed to load" : tileError && !basic ? "Map tiles unavailable — offline?" : null);
  const fatalNotice = initFailed ? "The map could not start." : rendererLost ? "The map renderer was lost." : null;
  const credits = basic ? LAND_ATTRIBUTION : ATTRIBUTION;

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Toolbar />
      <div
        ref={frameRef}
        style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: ui.tokens.surface0 }}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onFrameContextMenu}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div ref={containerRef} data-testid="map-canvas" style={{ position: "absolute", inset: 0 }} />
        {hover && (
          <div
            style={{
              position: "absolute",
              left: hover.x + 12,
              top: hover.y + 12,
              pointerEvents: "none",
              padding: "3px 6px",
              borderRadius: 3,
              background: ui.tokens.surface1,
              border: `1px solid ${ui.tokens.border}`,
              color: ui.tokens.textPrimary,
              fontSize: 11,
              whiteSpace: "nowrap",
            }}
          >
            {hover.text}
          </div>
        )}
        {menu && (
          <MapMenu x={menu.x} y={menu.y} onClose={closeMenu}>
            <Button size="sm" variant="ghost" disabled={selectedCount === 0} onClick={() => placeSelectedAt(menu.loc)}>
              {selectedCount === 0 ? "Place selected photos here" : `Place ${selectedCount} selected ${selectedCount === 1 ? "photo" : "photos"} here`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={selectedCount === 0}
              onClick={() => {
                setMenu(null);
                store().getState().setLocationRequest({ ids: [...catalog.getState().selectedIds], initial: menu.loc });
              }}
            >
              Set location…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMenu(null);
                store().getState().commands?.fitToPhotos();
              }}
            >
              Fit to photos
            </Button>
          </MapMenu>
        )}
        {basic && (
          <div
            role="note"
            style={{
              position: "absolute",
              left: 8,
              top: 8,
              maxWidth: "min(440px, calc(100% - 16px))",
              padding: "4px 8px",
              borderRadius: 3,
              background: ui.tokens.surface1,
              border: `1px solid ${ui.tokens.border}`,
              color: ui.tokens.textSecondary,
              fontSize: 11,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span>Basic map: the full map couldn't start here (it needs WebGL), so there are no streets. Pins, overlays and geotagging still work.</span>
            <Button size="sm" variant="ghost" onClick={reload}>
              Try full map
            </Button>
          </div>
        )}
        {notice && (
          <div
            role="status"
            style={{
              position: "absolute",
              right: 8,
              top: 8,
              padding: "4px 8px",
              borderRadius: 3,
              background: ui.tokens.surface1,
              border: `1px solid ${ui.tokens.border}`,
              color: ui.tokens.textSecondary,
              fontSize: 11,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span>{notice}</span>
            {error && (
              <Button size="sm" variant="ghost" onClick={() => store().getState().setError(null)}>
                Dismiss
              </Button>
            )}
          </div>
        )}
        {fatalNotice && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: ui.tokens.surface0,
              color: ui.tokens.textSecondary,
              fontSize: 12,
            }}
          >
            <span>{fatalNotice}</span>
            <Button size="sm" onClick={reload}>
              Reload map
            </Button>
          </div>
        )}
        <div
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            padding: "1px 5px",
            borderRadius: 3,
            background: `color-mix(in srgb, ${ui.tokens.surface0} 70%, transparent)`,
            color: ui.tokens.textSecondary,
            fontSize: 10,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
          }}
        >
          {credits.map((a, i) => (
            <React.Fragment key={a.href}>
              {i > 0 && " · "}
              <a href={a.href} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                {a.label}
              </a>
            </React.Fragment>
          ))}
        </div>
      </div>
      {overlays}
      <LocationDialogHost />
    </div>
  );
}
