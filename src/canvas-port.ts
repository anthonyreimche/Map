// The basic map: MapPort drawn with Canvas 2D, for a machine where the full map
// cannot start because WebGL is unavailable. It paints the world outline
// (Natural Earth 110m land) and a graticule in the basemap's colours, then the
// same sources and layers MapView gives MapLibre, reading their specs through
// style-eval, and it pans, zooms, clusters and hit-tests the way the full map
// does. There are no streets: the vector basemap needs WebGL.

import { abbreviate, clusterAt, clusterZoomOf, expansionZoom, type ClusterPoint, type Clustered } from "./cluster";
import { boundsFromMap } from "./geo";
import { LAND_110M } from "./land-110m";
import type { MapEvent, MapFactory, MapPort, RenderedHit } from "./map-port";
import { MAX_ZOOM, MIN_ZOOM, constrain, fitCamera, fromUnit, toUnit, unitAt, worldSize, type Camera, type Unit } from "./mercator";
import type { PinImage } from "./pins";
import { basemapColours, type BasemapColours, type StyleLayer } from "./style";
import { evaluate, passes, type Properties } from "./style-eval";

export type Painter = Pick<
  CanvasRenderingContext2D,
  | "setTransform"
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "fill"
  | "stroke"
  | "arc"
  | "drawImage"
  | "fillText"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "globalAlpha"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "lineCap"
  | "lineJoin"
>;

/** What the basic map takes from the browser; tests hand it stand-ins. */
export interface CanvasEnv {
  /** The canvas's 2D context, or null where there is none. */
  context(canvas: HTMLCanvasElement): Painter | null;
  /** A pin image as something drawImage takes, or null if it can't be made. */
  bitmap(image: PinImage): CanvasImageSource | null;
  /** Calls back on the next frame with its timestamp. */
  frame(callback: (time: number) => void): void;
}

const browserEnv: CanvasEnv = {
  context: (canvas) => canvas.getContext("2d"),
  bitmap: (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    return canvas;
  },
  frame: (callback) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
    else setTimeout(() => callback(performance.now()), 16);
  },
};

/** Px a press may stray before it pans: MapLibre's clickTolerance. */
const CLICK_TOLERANCE = 3;
/** Zoom levels per px of wheel delta; trackpad pinches arrive as Ctrl+wheel
 *  with much smaller deltas. */
const WHEEL_ZOOM_RATE = 1 / 300;
const PINCH_ZOOM_RATE = 1 / 100;
/** A wheel gesture ends after this long without another event. */
const WHEEL_IDLE_MS = 200;
/** WheelEvent.deltaMode values for deltas in lines and in pages. */
const DELTA_LINE = 1;
const DELTA_PAGE = 2;
/** A clustered GeoJSON source's defaults in MapLibre. */
const CLUSTER_RADIUS = 50;
const CLUSTER_MAX_ZOOM = 17;
const FIT_DURATION_MS = 600;
/** How far past the edge a point may sit and still draw: a pin is 48 px. */
const CULL_MARGIN = 64;
/** Graticule spacings in degrees, coarse to fine; the finest at least
 *  GRID_MIN_PX apart on screen is drawn. */
const GRID_STEPS = [90, 45, 30, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
const GRID_MIN_PX = 64;
const GRID_LAT = 80;
const FONT_FAMILY = "system-ui, sans-serif";

interface Ring {
  points: Float64Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const LAND: readonly Ring[] = LAND_110M.map((ring) => {
  const points = new Float64Array(ring.length);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const u = toUnit({ lon: ring[i] / 100, lat: ring[i + 1] / 100 });
    points[i] = u.x;
    points[i + 1] = u.y;
    minX = Math.min(minX, u.x);
    maxX = Math.max(maxX, u.x);
    minY = Math.min(minY, u.y);
    maxY = Math.max(maxY, u.y);
  }
  return { points, minX, maxX, minY, maxY };
});

interface Feature {
  geometry: { type: string; coordinates: unknown };
  properties?: Properties | null;
}

/** A GeoJSON source as map-layers.ts specifies one. */
interface SourceSpec {
  data?: { features?: readonly Feature[] };
  cluster?: boolean;
  clusterRadius?: number;
  clusterMaxZoom?: number;
}

interface Source {
  spec: SourceSpec;
  points: ClusterPoint[];
  props: Map<string, Properties>;
  lines: Unit[][];
  clusters: Map<number, Clustered[]>;
  /** pointsAt's answer per whole zoom, -1 standing for every zoom past the
   *  clustering; a source is rebuilt whenever its data changes. */
  drawn: Map<number, Drawn[]>;
}

interface Drawn {
  props: Properties;
  at: Unit;
}

interface PlacedImage {
  bitmap: CanvasImageSource;
  /** Layout px: the image's pixels over its pixel ratio. */
  width: number;
  height: number;
  ratio: number;
}

interface Ease {
  from: Camera;
  to: Camera;
  duration: number;
  start: number | null;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function readSource(spec: SourceSpec): Source {
  const points: ClusterPoint[] = [];
  const props = new Map<string, Properties>();
  const lines: Unit[][] = [];
  (spec.data?.features ?? []).forEach((f, i) => {
    const p = f.properties ?? {};
    if (f.geometry.type === "Point") {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const id = typeof p.id === "string" ? p.id : `#${i}`;
      points.push({ id, ...toUnit({ lon, lat }) });
      props.set(id, p);
    } else if (f.geometry.type === "LineString") {
      lines.push((f.geometry.coordinates as [number, number][]).map(([lon, lat]) => toUnit({ lon, lat })));
    }
  });
  return { spec, points, props, lines, clusters: new Map(), drawn: new Map() };
}

const clusterProps = (c: Extract<Clustered, { kind: "cluster" }>): Properties => ({
  cluster: true,
  cluster_id: c.clusterId,
  point_count: c.count,
  point_count_abbreviated: abbreviate(c.count),
});

function clustersAt(source: Source, zoom: number): Clustered[] {
  let list = source.clusters.get(zoom);
  if (!list) {
    list = clusterAt(source.points, zoom, source.spec.clusterRadius ?? CLUSTER_RADIUS);
    source.clusters.set(zoom, list);
  }
  return list;
}

/** The source's points as they show at `zoom`: clustered like MapLibre's up to
 *  the source's clusterMaxZoom, each one on its own above it. */
function pointsAt(source: Source, zoom: number): Drawn[] {
  const z = Math.floor(zoom);
  const clustered = !!source.spec.cluster && z <= (source.spec.clusterMaxZoom ?? CLUSTER_MAX_ZOOM);
  const key = clustered ? z : -1;
  let list = source.drawn.get(key);
  if (!list) {
    list = clustered
      ? clustersAt(source, z).map((c) => (c.kind === "point" ? { props: source.props.get(c.id) ?? {}, at: c } : { props: clusterProps(c), at: c }))
      : source.points.map((p) => ({ props: source.props.get(p.id) ?? {}, at: p }));
    source.drawn.set(key, list);
  }
  return list;
}

const colourOf = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const numberOf = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function createCanvasFactory(overrides: Partial<CanvasEnv> = {}): MapFactory {
  const env: CanvasEnv = { ...browserEnv, ...overrides };
  return async (container, style, center, zoom, pixelRatio) => {
    const canvas = document.createElement("canvas");
    const painter = env.context(canvas);
    if (!painter) throw new Error("[map] Canvas 2D is unavailable");
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";
    container.appendChild(canvas);
    return openBasicMap(env, container, canvas, painter, basemapColours(style), { center: toUnit(center), zoom, width: 0, height: 0 }, pixelRatio);
  };
}

export const canvasFactory: MapFactory = createCanvasFactory();

function openBasicMap(
  env: CanvasEnv,
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  p: Painter,
  initialColours: BasemapColours,
  initial: Camera,
  initialRatio: number,
): MapPort {
  let colours = initialColours;
  let ratio = initialRatio;
  let cam = constrain({ ...initial, width: container.clientWidth, height: container.clientHeight });
  const sources = new Map<string, Source>();
  const layers: StyleLayer[] = [];
  const images = new Map<string, PlacedImage>();
  const asked = new Set<string>();
  const handlers = new Map<MapEvent, (() => void)[]>();
  const missingHandlers: ((imageId: string) => void)[] = [];
  let ready = false;
  let removed = false;
  let frameRequested = false;
  let ease: Ease | null = null;
  let drag: { pointerId: number; from: { x: number; y: number }; center: Unit; moved: boolean } | null = null;
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;

  const fire = (event: MapEvent) => {
    for (const h of handlers.get(event) ?? []) h();
  };

  // movestart/moveend bracket every stretch in which anything moves the view:
  // a drag, a wheel gesture, an ease, a resize.
  const movers = new Set<string>();
  const begin = (mover: string) => {
    if (movers.size === 0) fire("movestart");
    movers.add(mover);
  };
  const end = (mover: string) => {
    if (!movers.delete(mover)) return;
    if (movers.size === 0) fire("moveend");
  };

  const sizeCanvas = () => {
    canvas.width = Math.max(1, Math.round(cam.width * ratio));
    canvas.height = Math.max(1, Math.round(cam.height * ratio));
    canvas.style.width = `${cam.width}px`;
    canvas.style.height = `${cam.height}px`;
  };

  const invalidate = () => {
    if (frameRequested || removed) return;
    frameRequested = true;
    env.frame(onFrame);
  };

  const setCamera = (next: Camera) => {
    cam = constrain(next);
    invalidate();
  };

  const stopEase = () => {
    if (!ease) return;
    ease = null;
    end("ease");
  };

  const easeTo = (target: Camera, duration: number) => {
    stopEase();
    begin("ease");
    if (duration <= 0 || reducedMotion()) {
      setCamera(target);
      end("ease");
      return;
    }
    // The short way round, across the antimeridian if that is nearer.
    const dx = target.center.x - cam.center.x;
    const to = { ...target, center: { x: cam.center.x + dx - Math.round(dx), y: target.center.y } };
    ease = { from: cam, to, duration, start: null };
    invalidate();
  };

  const stepEase = (time: number) => {
    if (!ease) return;
    ease.start ??= time;
    const t = Math.min(1, (time - ease.start) / ease.duration);
    if (t >= 1) {
      // The view's size is whatever it is now: it may have resized mid-ease.
      cam = constrain({ ...ease.to, width: cam.width, height: cam.height });
      ease = null;
      end("ease");
      return;
    }
    const k = easeInOut(t);
    const { from, to } = ease;
    cam = constrain({ ...cam, zoom: lerp(from.zoom, to.zoom, k), center: { x: lerp(from.center.x, to.center.x, k), y: lerp(from.center.y, to.center.y, k) } });
  };

  /** The x of the unit-square origin on each world copy in view. */
  const copies = (originX: number, ws: number): number[] => {
    const out: number[] = [];
    for (let k = Math.floor(-originX / ws); k <= Math.floor((cam.width - originX) / ws); k++) out.push(originX + k * ws);
    return out;
  };

  /** Each drawn point of a layer, at every copy where it falls in view. The
   *  filter runs only for points in view: a selection ring's `match` over a
   *  large selection is the costliest part of a frame. */
  const placed = (layer: StyleLayer, originX: number, originY: number, ws: number) => {
    const source = layer.source ? sources.get(layer.source) : undefined;
    if (!source) return [];
    const xs = copies(originX, ws);
    const out: { props: Properties; x: number; y: number; at: Unit }[] = [];
    for (const d of pointsAt(source, cam.zoom)) {
      const y = originY + d.at.y * ws;
      if (y < -CULL_MARGIN || y > cam.height + CULL_MARGIN) continue;
      let filtered: boolean | null = null;
      for (const ox of xs) {
        const x = ox + d.at.x * ws;
        if (x < -CULL_MARGIN || x > cam.width + CULL_MARGIN) continue;
        filtered ??= passes(layer.filter, d.props);
        if (filtered) out.push({ props: d.props, x, y, at: d.at });
      }
    }
    return out;
  };

  const traceLand = (originX: number, originY: number, ws: number) => {
    p.beginPath();
    for (const ox of copies(originX, ws)) {
      for (const ring of LAND) {
        if (ox + ring.maxX * ws < 0 || ox + ring.minX * ws > cam.width) continue;
        if (originY + ring.maxY * ws < 0 || originY + ring.minY * ws > cam.height) continue;
        const pts = ring.points;
        p.moveTo(ox + pts[0] * ws, originY + pts[1] * ws);
        for (let i = 2; i < pts.length; i += 2) p.lineTo(ox + pts[i] * ws, originY + pts[i + 1] * ws);
        p.closePath();
      }
    }
  };

  const traceGraticule = (originX: number, originY: number, ws: number) => {
    const step = GRID_STEPS.reduce((best, s) => ((s / 360) * ws >= GRID_MIN_PX ? s : best), GRID_STEPS[0]);
    const nw = fromUnit(unitAt(cam, 0, 0));
    const se = fromUnit(unitAt(cam, cam.width, cam.height));
    const north = Math.min(GRID_LAT, nw.lat);
    const south = Math.max(-GRID_LAT, se.lat);
    const top = originY + toUnit({ lon: 0, lat: north }).y * ws;
    const bottom = originY + toUnit({ lon: 0, lat: south }).y * ws;
    p.beginPath();
    for (let i = Math.ceil(nw.lon / step); i * step <= se.lon; i++) {
      const x = originX + ((i * step) / 360 + 0.5) * ws;
      p.moveTo(x, top);
      p.lineTo(x, bottom);
    }
    for (let i = Math.ceil(south / step); i * step <= north; i++) {
      const y = originY + toUnit({ lon: 0, lat: i * step }).y * ws;
      p.moveTo(0, y);
      p.lineTo(cam.width, y);
    }
  };

  const drawLines = (layer: StyleLayer, originX: number, originY: number, ws: number) => {
    const source = layer.source ? sources.get(layer.source) : undefined;
    if (!source || source.lines.length === 0) return;
    const paint = layer.paint ?? {};
    p.strokeStyle = colourOf(evaluate(paint["line-color"], {}), "#000000");
    p.lineWidth = numberOf(evaluate(paint["line-width"], {}), 1);
    p.globalAlpha = numberOf(evaluate(paint["line-opacity"], {}), 1);
    p.lineCap = layer.layout?.["line-cap"] === "round" ? "round" : "butt";
    p.lineJoin = layer.layout?.["line-join"] === "round" ? "round" : "miter";
    p.beginPath();
    for (const ox of copies(originX, ws)) {
      for (const line of source.lines) {
        line.forEach((u, i) => (i === 0 ? p.moveTo(ox + u.x * ws, originY + u.y * ws) : p.lineTo(ox + u.x * ws, originY + u.y * ws)));
      }
    }
    p.stroke();
    p.globalAlpha = 1;
  };

  const drawCircles = (layer: StyleLayer, originX: number, originY: number, ws: number) => {
    const paint = layer.paint ?? {};
    for (const { props, x, y } of placed(layer, originX, originY, ws)) {
      p.beginPath();
      p.arc(x, y, numberOf(evaluate(paint["circle-radius"], props), 5), 0, Math.PI * 2);
      p.fillStyle = colourOf(evaluate(paint["circle-color"], props), "#000000");
      p.fill();
      const stroke = numberOf(evaluate(paint["circle-stroke-width"], props), 0);
      if (stroke > 0) {
        p.lineWidth = stroke;
        p.strokeStyle = colourOf(evaluate(paint["circle-stroke-color"], props), "#000000");
        p.stroke();
      }
    }
  };

  const drawSymbols = (layer: StyleLayer, originX: number, originY: number, ws: number, missing: string[]) => {
    const layout = layer.layout ?? {};
    const paint = layer.paint ?? {};
    const fonts = Array.isArray(layout["text-font"]) ? (layout["text-font"] as unknown[]) : [];
    const bold = fonts.some((f) => /bold/i.test(String(f)));
    for (const { props, x, y } of placed(layer, originX, originY, ws)) {
      if (layout["icon-image"] !== undefined) {
        const id = String(evaluate(layout["icon-image"], props));
        const image = images.get(id);
        if (!image) {
          if (!asked.has(id)) {
            asked.add(id);
            missing.push(id);
          }
          continue;
        }
        const scale = numberOf(evaluate(layout["icon-size"], props), 1);
        const w = image.width * scale;
        const h = image.height * scale;
        p.drawImage(image.bitmap, x - w / 2, y - h / 2, w, h);
      }
      if (layout["text-field"] !== undefined) {
        p.font = `${bold ? "bold " : ""}${numberOf(evaluate(layout["text-size"], props), 12)}px ${FONT_FAMILY}`;
        p.textAlign = "center";
        p.textBaseline = "middle";
        p.fillStyle = colourOf(evaluate(paint["text-color"], props), "#000000");
        p.fillText(String(evaluate(layout["text-field"], props)), x, y);
      }
    }
  };

  const draw = () => {
    const ws = worldSize(cam.zoom);
    const originX = cam.width / 2 - cam.center.x * ws;
    const originY = cam.height / 2 - cam.center.y * ws;
    p.setTransform(ratio, 0, 0, ratio, 0, 0);
    p.globalAlpha = 1;
    p.fillStyle = colours.water;
    p.fillRect(0, 0, cam.width, cam.height);

    traceLand(originX, originY, ws);
    p.fillStyle = colours.land;
    p.fill("evenodd");
    p.strokeStyle = colours.line;
    p.lineWidth = 0.75;
    p.globalAlpha = 0.6;
    p.stroke();
    traceGraticule(originX, originY, ws);
    p.lineWidth = 0.5;
    p.globalAlpha = 0.25;
    p.stroke();
    p.globalAlpha = 1;

    const missing: string[] = [];
    for (const layer of layers) {
      if (layer.type === "line") drawLines(layer, originX, originY, ws);
      else if (layer.type === "circle") drawCircles(layer, originX, originY, ws);
      else if (layer.type === "symbol") drawSymbols(layer, originX, originY, ws, missing);
    }
    for (const id of missing) for (const h of missingHandlers) h(id);
  };

  // Sizing a canvas clears it, and resize work runs after the frame's
  // animation callbacks, so a redraw left to the next frame would show one
  // blank frame: draw now.
  const resized = () => {
    sizeCanvas();
    if (ready) draw();
    else invalidate();
  };

  function onFrame(time: number) {
    frameRequested = false;
    if (removed) return;
    stepEase(time);
    if (!ready) {
      ready = true;
      for (const h of handlers.get("ready")?.splice(0) ?? []) h();
    }
    draw();
    if (ease) invalidate();
  }

  const hitsOn = (layer: StyleLayer, x: number, y: number): RenderedHit[] => {
    const ws = worldSize(cam.zoom);
    const originX = cam.width / 2 - cam.center.x * ws;
    const originY = cam.height / 2 - cam.center.y * ws;
    const hits: RenderedHit[] = [];
    for (const d of placed(layer, originX, originY, ws).reverse()) {
      let inside = false;
      if (layer.type === "circle") {
        const paint = layer.paint ?? {};
        const r = numberOf(evaluate(paint["circle-radius"], d.props), 5) + numberOf(evaluate(paint["circle-stroke-width"], d.props), 0) / 2;
        inside = Math.hypot(x - d.x, y - d.y) <= r;
      } else if (layer.type === "symbol" && layer.layout?.["icon-image"] !== undefined) {
        const image = images.get(String(evaluate(layer.layout["icon-image"], d.props)));
        const scale = numberOf(evaluate(layer.layout["icon-size"], d.props), 1);
        inside = !!image && Math.abs(x - d.x) <= (image.width * scale) / 2 && Math.abs(y - d.y) <= (image.height * scale) / 2;
      }
      if (!inside) continue;
      const { lon, lat } = fromUnit(d.at);
      hits.push({
        layer: layer.id,
        id: typeof d.props.id === "string" ? d.props.id : null,
        clusterId: typeof d.props.cluster_id === "number" ? d.props.cluster_id : null,
        lon,
        lat,
      });
    }
    return hits;
  };

  // Pointer positions in layout px: under Safelight's CSS zoom, clientX and
  // the canvas's rect are scaled while its offsetWidth is not.
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    const scale = canvas.offsetWidth ? r.width / canvas.offsetWidth || 1 : 1;
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    stopEase();
    drag = { pointerId: e.pointerId, from: local(e), center: cam.center, moved: false };
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved) end("drag");
    drag = null;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    // A release that never reached us (focus lost mid-drag) must not leave
    // the map panning on hover.
    if ((e.buttons & 1) === 0) return onPointerUp(e);
    const at = local(e);
    const dx = at.x - drag.from.x;
    const dy = at.y - drag.from.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) <= CLICK_TOLERANCE) return;
      drag.moved = true;
      begin("drag");
    }
    const ws = worldSize(cam.zoom);
    setCamera({ ...cam, center: { x: drag.center.x - dx / ws, y: drag.center.y - dy / ws } });
  };
  const onWheel = (e: WheelEvent) => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    stopEase();
    const unit = e.deltaMode === DELTA_LINE ? 40 : e.deltaMode === DELTA_PAGE ? 800 : 1;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom - e.deltaY * unit * (e.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE)));
    const at = local(e);
    const anchor = unitAt(cam, at.x, at.y);
    const ws = worldSize(zoom);
    begin("wheel");
    setCamera({ ...cam, zoom, center: { x: anchor.x - (at.x - cam.width / 2) / ws, y: anchor.y - (at.y - cam.height / 2) / ws } });
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => end("wheel"), WHEEL_IDLE_MS);
  };
  const onResize = () => {
    if (removed) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === cam.width && height === cam.height) return;
    begin("resize");
    cam = constrain({ ...cam, width, height });
    resized();
    end("resize");
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("lostpointercapture", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  // A GPU-backed 2D canvas can lose its pixels to a GPU reset; it comes back blank.
  canvas.addEventListener("contextrestored", invalidate);
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
  if (resizeObserver) resizeObserver.observe(container);
  else window.addEventListener("resize", onResize);
  sizeCanvas();
  invalidate();

  const port: MapPort = {
    kind: "basic",
    on: (event, handler) => {
      if (event === "ready" && ready) return void handler();
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    onError: () => {},
    onSourceLoaded: () => {},
    onImageMissing: (handler) => void missingHandlers.push(handler),
    addSource: (id, spec) => {
      sources.set(id, readSource(spec as SourceSpec));
      invalidate();
    },
    removeSource: (id) => {
      sources.delete(id);
      invalidate();
    },
    addLayer: (spec) => {
      layers.push({ ...(spec as StyleLayer) });
      invalidate();
    },
    removeLayer: (id) => {
      const i = layers.findIndex((l) => l.id === id);
      if (i !== -1) layers.splice(i, 1);
      invalidate();
    },
    setFilter: (id, filter) => {
      const layer = layers.find((l) => l.id === id);
      if (layer) layer.filter = filter;
      invalidate();
    },
    setData: (id, data) => {
      const source = sources.get(id);
      if (!source) return;
      sources.set(id, readSource({ ...source.spec, data: data as SourceSpec["data"] }));
      invalidate();
    },
    clusterExpansionZoom: async (id, clusterId) => {
      const source = sources.get(id);
      const zoom = clusterZoomOf(clusterId);
      const cluster = source?.spec.cluster ? clustersAt(source, zoom).find((c) => c.kind === "cluster" && c.clusterId === clusterId) : undefined;
      if (!source || !cluster || cluster.kind !== "cluster") throw new Error(`[map] no cluster ${clusterId} in "${id}"`);
      return expansionZoom(source.points, cluster.members, zoom, source.spec.clusterRadius ?? CLUSTER_RADIUS, source.spec.clusterMaxZoom ?? CLUSTER_MAX_ZOOM);
    },
    hasImage: (id) => images.has(id),
    addImage: (id, image, imageRatio) => {
      const bitmap = env.bitmap(image);
      if (!bitmap) return;
      images.set(id, { bitmap, width: image.width / imageRatio, height: image.height / imageRatio, ratio: imageRatio });
      asked.delete(id);
      invalidate();
    },
    updateImage: (id, image) => port.addImage(id, image, images.get(id)?.ratio ?? 1),
    setStyle: (next) => {
      colours = basemapColours(next);
      invalidate();
    },
    easeTo: (c, z, duration) => easeTo(constrain({ ...cam, center: toUnit(c), zoom: z ?? cam.zoom }), duration),
    fitBounds: (b, padding, maxZoom) => easeTo(fitCamera(b, cam.width, cam.height, padding, maxZoom), FIT_DURATION_MS),
    getBounds: () => {
      const nw = fromUnit(unitAt(cam, 0, 0));
      const se = fromUnit(unitAt(cam, cam.width, cam.height));
      return boundsFromMap(nw.lon, se.lat, se.lon, nw.lat);
    },
    getCenter: () => fromUnit(cam.center),
    getZoom: () => cam.zoom,
    unproject: (x, y) => fromUnit(unitAt(cam, x, y)),
    hitTest: (x, y, ids) =>
      [...layers]
        .reverse()
        .filter((l) => ids.includes(l.id))
        .flatMap((l) => hitsOn(l, x, y)),
    setCursor: (cursor) => {
      canvas.style.cursor = cursor;
    },
    setPixelRatio: (next) => {
      ratio = next;
      resized();
    },
    remove: () => {
      if (removed) return;
      removed = true;
      ease = null;
      if (wheelTimer) clearTimeout(wheelTimer);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      canvas.remove();
    },
  };
  return port;
}
