import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DND_PHOTOS } from "../src/dnd";
import { FILTER_ID } from "../src/filter";
import type { Bounds, LonLat } from "../src/geo";
import { withFix, withoutFix } from "../src/geotag";
import { LAYER_CLUSTERS, LAYER_PINS, LAYER_RING, LAYER_TRACK, PHOTO_SOURCE, selectionFilter } from "../src/map-layers";
import type { MapFactory, MapPort, RenderedHit } from "../src/map-port";
import { MapView } from "../src/MapView";
import type { PinImage } from "../src/pins";
import { initRuntime } from "../src/rt";
import { ATTRIBUTION, BASEMAP_SOURCE } from "../src/style";
import { initStore, store } from "../src/store";
import { createHarness, flush, located, photo, type Harness } from "./harness";

type Handler = (...args: unknown[]) => void;

function fakePort() {
  const handlers = new Map<string, Handler[]>();
  const on = (event: string, h: Handler) => {
    const list = handlers.get(event) ?? [];
    list.push(h);
    handlers.set(event, list);
  };
  const images = new Map<string, PinImage>();
  const layerFilters = new Map<string, unknown>();
  const sourceData = new Map<string, unknown>();
  let removed = false;
  const afterRemove: string[] = [];
  const calls = {
    sources: [] as string[],
    layers: [] as string[],
    setData: [] as [string, { features: { properties: { id: string } }[] }][],
    setFilter: [] as [string, unknown][],
    setStyle: 0,
    easeTo: [] as [{ lon: number; lat: number }, number | null][],
    fitBounds: [] as Bounds[],
    addImage: [] as string[],
    updateImage: [] as string[],
  };
  let hits: RenderedHit[] = [];
  let bounds: Bounds = { west: -10, south: -10, east: 10, north: 10 };
  let unprojected: LonLat = { lon: 2.35, lat: 48.85 };
  const port: MapPort = {
    on: (event, h) => on(event, h),
    onError: (h) => on("error", h as Handler),
    onSourceLoaded: (h) => on("sourceloaded", h as Handler),
    onImageMissing: (h) => on("imagemissing", h as Handler),
    addSource: (id, spec) => {
      calls.sources.push(id);
      sourceData.set(id, (spec as { data?: unknown }).data);
    },
    removeSource: () => {},
    addLayer: (spec) => {
      const s = spec as { id: string; filter?: unknown };
      calls.layers.push(s.id);
      layerFilters.set(s.id, s.filter);
    },
    removeLayer: () => {},
    setFilter: (id, f) => {
      calls.setFilter.push([id, f]);
      layerFilters.set(id, f);
    },
    setData: (id, data) => {
      calls.setData.push([id, data as (typeof calls.setData)[number][1]]);
      sourceData.set(id, data);
    },
    clusterExpansionZoom: async () => 9,
    hasImage: (id) => {
      if (removed) afterRemove.push(`hasImage:${id}`);
      return images.has(id);
    },
    addImage: (id, image) => {
      if (removed) afterRemove.push(`addImage:${id}`);
      images.set(id, image);
      calls.addImage.push(id);
    },
    updateImage: (id) => {
      if (removed) afterRemove.push(`updateImage:${id}`);
      calls.updateImage.push(id);
    },
    setStyle: () => void calls.setStyle++,
    easeTo: (c, z) => void calls.easeTo.push([c, z]),
    fitBounds: (b) => void calls.fitBounds.push(b),
    getBounds: () => bounds,
    getCenter: () => ({ lon: 0, lat: 0 }),
    getZoom: () => 3,
    unproject: () => unprojected,
    hitTest: (_x, _y, layers) => hits.filter((h) => layers.includes(h.layer)),
    setCursor: () => {},
    remove: () => void (removed = true),
  };
  return {
    port,
    calls,
    fire: (event: string, ...args: unknown[]) => act(() => handlers.get(event)?.forEach((h) => h(...args))),
    hit: (h: RenderedHit | null) => (hits = h ? [h] : []),
    setBounds: (b: Bounds) => void (bounds = b),
    unprojectTo: (at: LonLat) => void (unprojected = at),
    imageOf: (id: string) => images.get(id),
    filterOf: (id: string) => layerFilters.get(id),
    dataOf: (id: string) => sourceData.get(id),
    removed: () => removed,
    afterRemove: () => afterRemove,
  };
}

const pinHit = (id: string): RenderedHit => ({ layer: LAYER_PINS, id, clusterId: null, lon: 0, lat: 0 });
const img: PinImage = { width: 1, height: 1, data: new Uint8ClampedArray(4) };

let h: Harness;
let fake: ReturnType<typeof fakePort>;

async function mount() {
  render(<MapView factory={async () => fake.port} draw={async () => img} pixelRatio={1} />);
  await flush();
  fake.fire("load");
  await flush();
  return screen.getByTestId("map-canvas");
}

beforeEach(() => {
  h = createHarness({
    photos: [located("a", 1, 1), photo({ id: "b" }), { ...located("c", 2, 2), thumbnailUrl: "blob:c" }],
  });
  initRuntime(h.api);
  initStore();
  fake = fakePort();
});

// This repo's vitest config doesn't set `test.globals`, so
// @testing-library/react's own auto-cleanup (which looks for a global
// `afterEach`) never registers; without this, each render() below would
// leave its tree in the document and later tests would see duplicate frames.
afterEach(() => cleanup());

describe("MapView", () => {
  it("adds our sources and layers on load and feeds the located photos", async () => {
    await mount();
    expect(fake.calls.sources).toEqual(expect.arrayContaining([PHOTO_SOURCE, "track"]));
    expect(fake.calls.layers).toEqual(expect.arrayContaining([LAYER_TRACK, LAYER_CLUSTERS, LAYER_RING, LAYER_PINS]));
    // The photo source's own initial spec carries the data (addSource, not a
    // separate setData) — the content-based dedup means a same-content
    // setData right after never fires; see "builds the photo source..." below.
    const data = fake.dataOf(PHOTO_SOURCE) as { features: { properties: { id: string } }[] };
    expect(data.features.map((f) => f.properties.id)).toEqual(["a", "c"]);
    expect(store().getState()).toMatchObject({ located: 2, total: 3 });
    expect(store().getState().commands).not.toBeNull();
  });

  it("builds the photo source and its layers exactly once at load", async () => {
    await mount();
    expect(fake.calls.sources.filter((id) => id === PHOTO_SOURCE).length).toBe(1);
    expect(fake.calls.layers.filter((id) => id === LAYER_PINS).length).toBe(1);
    // addSource already carried the located photos, so the photos effect
    // right after "load" has nothing new to push.
    expect(fake.calls.setData.filter(([id]) => id === PHOTO_SOURCE).length).toBe(0);
  });

  it("fits the located photos on the first open, when no view was saved", async () => {
    await mount();
    expect(fake.calls.fitBounds).toEqual([{ west: 1, south: 1, east: 2, north: 2 }]);
  });

  it("opens at the saved view instead of fitting the photos", async () => {
    h.api.settings.set("lastView", { lon: 2.35, lat: 48.85, zoom: 9 });
    const opened: [LonLat, number][] = [];
    render(
      <MapView
        factory={async (_el, _style, center, zoom) => {
          opened.push([center, zoom]);
          return fake.port;
        }}
        draw={async () => img}
        pixelRatio={1}
      />,
    );
    await flush();
    fake.fire("load");
    await flush();
    expect(opened).toEqual([[{ lon: 2.35, lat: 48.85 }, 9]]);
    expect(fake.calls.fitBounds).toEqual([]);
  });

  it("publishes the bounds and the in-view count as soon as the map loads", async () => {
    fake.setBounds({ west: 0, south: 0, east: 1.5, north: 1.5 });
    await mount();
    expect(store().getState().bounds).toEqual({ west: 0, south: 0, east: 1.5, north: 1.5 });
    expect(store().getState()).toMatchObject({ located: 2, total: 3, inView: 1 });
  });

  it("keeps the selection ring current once the layers are built on load", async () => {
    h.catalog.getState().select("a");
    await mount();
    expect(fake.filterOf(LAYER_RING)).toEqual(selectionFilter(["a"]));
  });

  it("keeps the selection ring current through a prefs-driven rebuild", async () => {
    await mount();
    act(() => h.catalog.getState().select("a"));
    expect(fake.filterOf(LAYER_RING)).toEqual(selectionFilter(["a"]));
    act(() => h.api.settings.set("pinThumbnails", false));
    expect(fake.filterOf(LAYER_RING)).toEqual(selectionFilter(["a"]));
  });

  it("selects on click, extends with Ctrl and Shift, and ignores a click after a drag", async () => {
    const canvas = await mount();
    fake.hit(pinHit("a"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect([...h.catalog.getState().selectedIds]).toEqual(["a"]);
    fake.hit(pinHit("c"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10, ctrlKey: true });
    expect([...h.catalog.getState().selectedIds].sort()).toEqual(["a", "c"]);
    fake.hit(pinHit("a"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 40, clientY: 40 });
    expect([...h.catalog.getState().selectedIds].sort()).toEqual(["a", "c"]);
    // Shift+click extends the selection to a range from the active photo.
    // (In-app, MapLibre's boxZoom handler would swallow this click before it
    // reaches us — hence `boxZoom: false` in maplibre-port.ts; this covers our
    // own click → selectRange wiring.)
    fake.hit(pinHit("a"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect([...h.catalog.getState().selectedIds]).toEqual(["a"]);
    fake.hit(pinHit("c"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10, shiftKey: true });
    expect([...h.catalog.getState().selectedIds].sort()).toEqual(["a", "c"]);
  });

  it("opens the photo in Develop on double-click", async () => {
    const canvas = await mount();
    fake.hit(pinHit("c"));
    fireEvent.doubleClick(canvas, { clientX: 5, clientY: 5 });
    expect(h.catalog.getState().activePhotoId).toBe("c");
    expect(h.navigations).toEqual(["develop"]);
  });

  it("zooms into a cluster on click", async () => {
    const canvas = await mount();
    fake.hit({ layer: LAYER_CLUSTERS, id: null, clusterId: 7, lon: 3, lat: 4 });
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    await flush();
    expect(fake.calls.easeTo.pop()).toEqual([{ lon: 3, lat: 4 }, 9]);
  });

  it("ignores a cluster that is gone by the time its expansion zoom is asked for", async () => {
    fake.port.clusterExpansionZoom = async () => {
      throw new Error("No cluster with the specified id.");
    };
    const canvas = await mount();
    fake.hit({ layer: LAYER_CLUSTERS, id: null, clusterId: 7, lon: 3, lat: 4 });
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    await flush();
    await flush();
    expect(fake.calls.easeTo).toEqual([]);
  });

  it("places dropped photos where they land", async () => {
    const canvas = await mount();
    fireEvent.drop(canvas, { dataTransfer: { types: [DND_PHOTOS], getData: () => JSON.stringify(["b"]) } });
    await flush();
    expect(h.relocated[0].map((p) => [p.id, p.exif.gpsLatitude, p.exif.gpsLongitude])).toEqual([["b", 48.85, 2.35]]);
    expect(store().getState().undo.length).toBe(1);
  });

  it("stores a drop on a world copy at its longitude within ±180", async () => {
    const canvas = await mount();
    fake.unprojectTo({ lon: 200, lat: 10 });
    fireEvent.drop(canvas, { dataTransfer: { types: [DND_PHOTOS], getData: () => JSON.stringify(["b"]) } });
    await flush();
    expect(h.relocated[0].map((p) => [p.id, p.exif.gpsLatitude, p.exif.gpsLongitude])).toEqual([["b", 10, -160]]);
  });

  it("places the selection from the map's menu, at a longitude within ±180", async () => {
    const canvas = await mount();
    act(() => h.catalog.getState().select("b"));
    fake.unprojectTo({ lon: 200, lat: 10 });
    fireEvent.contextMenu(canvas, { clientX: 20, clientY: 20 });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("button", { name: "Place 1 selected photo here" }));
    await flush();
    expect(h.relocated[0].map((p) => [p.id, p.exif.gpsLatitude, p.exif.gpsLongitude])).toEqual([["b", 10, -160]]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves the map's menu to a second right-click on the map", async () => {
    const canvas = await mount();
    fireEvent.contextMenu(canvas, { clientX: 20, clientY: 30 });
    fireEvent.contextMenu(canvas, { clientX: 50, clientY: 60 });
    const menu = screen.getByRole("menu");
    expect([menu.style.left, menu.style.top]).toEqual(["50px", "60px"]);
  });

  it("closes the map's menu on Escape, when the map moves, and when a pin's menu opens", async () => {
    const canvas = await mount();
    const openMenu = () => {
      fake.hit(null);
      fireEvent.contextMenu(canvas, { clientX: 20, clientY: 20 });
      expect(screen.getByRole("menu")).toBeTruthy();
    };
    openMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    fake.fire("movestart");
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    fake.hit(pinHit("a"));
    fireEvent.contextMenu(canvas, { clientX: 20, clientY: 20 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(h.contextMenus).toEqual(["a"]);
  });

  it("does not hit-test the map through a click on an overlay control", async () => {
    await mount();
    fake.fire("webglcontextlost");
    fake.hit(pinHit("a"));
    fireEvent.click(screen.getByRole("button", { name: "Reload map" }));
    expect(h.catalog.getState().selectedIds.size).toBe(0);
  });

  it("swaps the basemap when the theme changes", async () => {
    await mount();
    expect(fake.calls.setStyle).toBe(0);
    act(() => h.theme.setState({ activeId: "core.dark" }));
    expect(fake.calls.setStyle).toBe(1);
  });

  it("publishes bounds on moveend and keeps the in-view filter current", async () => {
    await mount();
    act(() => store().getState().setFilterToView(true));
    fake.fire("moveend");
    expect(store().getState().bounds).toEqual({ west: -10, south: -10, east: 10, north: 10 });
    const f = h.gridFilters.get(FILTER_ID)!;
    expect(f.test(located("in", 1, 1))).toBe(true);
    expect(f.test(located("out", 50, 50))).toBe(false);
  });

  it("re-registers the Library filter on moveend only while the toggle is on", async () => {
    await mount();
    const registrations = () => h.filterRegistrations.filter((id) => id === FILTER_ID).length;
    const before = registrations();
    fake.fire("moveend");
    expect(registrations()).toBe(before);
    act(() => store().getState().setFilterToView(true));
    fake.setBounds({ west: 0, south: 0, east: 1.5, north: 1.5 });
    fake.fire("moveend");
    expect(registrations()).toBe(before + 1);
    const f = h.gridFilters.get(FILTER_ID)!;
    expect(f.test(located("a", 1, 1))).toBe(true);
    expect(f.test(located("c", 2, 2))).toBe(false);
  });

  it("flies to the active photo once, and not again from unrelated re-renders", async () => {
    // Active before mount: the map should fly to it the first time the
    // loaded map sees an active photo.
    h.catalog.getState().select("a");
    await mount();
    expect(fake.calls.easeTo.length).toBe(1);
    const setDataCount = fake.calls.setData.filter(([id]) => id === PHOTO_SOURCE).length;

    fake.fire("moveend");
    // The harness's useVisiblePhotos (like the real host's, which re-derives
    // whenever a grid filter re-registers or the catalog changes) returns a
    // fresh array on every render — an unrelated catalog change (a rating on
    // a different, unselected photo) forces exactly that re-render here.
    // Neither the fly-to-active effect nor the feature upload may react to
    // `byId`/`located` merely getting a new identity.
    await act(async () => {
      await h.catalog.getState().setRating("b", 3);
    });
    expect(fake.calls.easeTo.length).toBe(1);
    expect(fake.calls.setData.filter(([id]) => id === PHOTO_SOURCE).length).toBe(setDataCount);

    // A genuine active-photo change still flies, exactly once.
    act(() => h.catalog.getState().select("c"));
    expect(fake.calls.easeTo.length).toBe(2);
  });

  it("never eases from a click on a pin itself", async () => {
    const canvas = await mount();
    fake.hit(pinHit("a"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect(fake.calls.easeTo.length).toBe(0);
  });

  it("still flies to a later Library selection after re-clicking the active pin on the map", async () => {
    const canvas = await mount();
    fake.hit(pinHit("a"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    // Re-click the same, already-active pin: activePhotoId doesn't change.
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect(fake.calls.easeTo.length).toBe(0);
    // A selection made from outside the map (the Library/Develop) must still fly.
    act(() => h.catalog.getState().select("c"));
    expect(fake.calls.easeTo.length).toBe(1);
  });

  it("still flies to a later Library selection after a Shift+click on the map and an unrelated re-render", async () => {
    const canvas = await mount();
    fake.hit(pinHit("a"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    // Shift+click extends the range but (core selectRange) never moves the
    // active photo off "a".
    fake.hit(pinHit("c"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10, shiftKey: true });
    expect(fake.calls.easeTo.length).toBe(0);
    // An unrelated catalog change (rating a different photo) forces a
    // re-render with fresh byId/located identities; must not fly either.
    await act(async () => {
      await h.catalog.getState().setRating("b", 3);
    });
    expect(fake.calls.easeTo.length).toBe(0);
    act(() => h.catalog.getState().select("c"));
    expect(fake.calls.easeTo.length).toBe(1);
  });

  it("never eases from a Ctrl+click or a first Shift+click that makes a pin active", async () => {
    const canvas = await mount();
    fake.hit(pinHit("a"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10, shiftKey: true });
    expect(h.catalog.getState().activePhotoId).toBe("a");
    fake.hit(pinHit("c"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10, ctrlKey: true });
    expect(h.catalog.getState().activePhotoId).toBe("c");
    expect(fake.calls.easeTo).toEqual([]);
  });

  it("never eases from a right-click that makes a pin active", async () => {
    const canvas = await mount();
    fake.hit(pinHit("a"));
    fireEvent.contextMenu(canvas, { clientX: 10, clientY: 10 });
    expect(h.contextMenus).toEqual(["a"]);
    expect(h.catalog.getState().activePhotoId).toBe("a");
    expect(fake.calls.easeTo).toEqual([]);
  });

  it("does not fly again on a return to the Map, unless the active photo changed while it was away", async () => {
    h.catalog.getState().select("a");
    const first = render(<MapView factory={async () => fake.port} draw={async () => img} pixelRatio={1} />);
    await flush();
    fake.fire("load");
    await flush();
    expect(fake.calls.easeTo.length).toBe(1);
    first.unmount();

    fake = fakePort();
    await mount();
    expect(fake.calls.easeTo).toEqual([]);
    cleanup();

    act(() => h.catalog.getState().select("c"));
    fake = fakePort();
    await mount();
    expect(fake.calls.easeTo).toEqual([[{ lon: 2, lat: 2 }, 10]]);
  });

  it("flies again to the same photo once the active photo is cleared and reselected", async () => {
    await mount();
    act(() => h.catalog.getState().select("a"));
    expect(fake.calls.easeTo.length).toBe(1);
    act(() => h.catalog.getState().setActivePhoto(null));
    act(() => h.catalog.getState().select("a"));
    expect(fake.calls.easeTo.length).toBe(2);
  });

  it("uploads new coordinates when a located photo's own location changes", async () => {
    await mount();
    const dataOf = () =>
      fake.dataOf(PHOTO_SOURCE) as { features: { properties: { id: string }; geometry: { coordinates: [number, number] } }[] };
    expect(dataOf().features.find((f) => f.properties.id === "a")?.geometry.coordinates).toEqual([1, 1]);

    const a = h.catalog.getState().photos.find((p) => p.id === "a")!;
    await act(async () => {
      await h.catalog.getState().relocatePhotos([withFix(a, { lat: 9, lon: 8 })]);
    });

    expect(dataOf().features.find((f) => f.properties.id === "a")?.geometry.coordinates).toEqual([8, 9]);
  });

  it("uploads the new set of features when a photo gains or loses a location", async () => {
    await mount();
    const dataOf = () => fake.dataOf(PHOTO_SOURCE) as { features: { properties: { id: string } }[] };
    expect(dataOf().features.map((f) => f.properties.id).sort()).toEqual(["a", "c"]);

    const b = h.catalog.getState().photos.find((p) => p.id === "b")!;
    await act(async () => {
      await h.catalog.getState().relocatePhotos([withFix(b, { lat: 5, lon: 6 })]);
    });
    expect(dataOf().features.map((f) => f.properties.id).sort()).toEqual(["a", "b", "c"]);

    const a = h.catalog.getState().photos.find((p) => p.id === "a")!;
    await act(async () => {
      await h.catalog.getState().relocatePhotos([withoutFix(a)]);
    });
    expect(dataOf().features.map((f) => f.properties.id).sort()).toEqual(["b", "c"]);
  });

  it("ignores pointer interaction before the map has finished loading", async () => {
    render(<MapView factory={async () => fake.port} draw={async () => img} pixelRatio={1} />);
    await flush();
    // Deliberately not firing "load" yet: the map exists but hasn't finished
    // loading, so our layers don't exist and a hit test would be premature.
    const canvas = screen.getByTestId("map-canvas");
    fake.hit(pinHit("a"));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect(h.catalog.getState().selectedIds.size).toBe(0);
  });

  it("answers a missing pin with a placeholder, then the rasterised preview", async () => {
    await mount();
    fake.fire("imagemissing", "pin:a");
    expect(fake.calls.addImage).toEqual(["pin:a"]);
    expect(h.requested).toEqual(["a"]);
    fake.fire("imagemissing", "pin:c");
    await flush();
    await flush();
    expect(fake.calls.updateImage).toEqual(["pin:c"]);
  });

  it("draws placeholder pins in the current theme's colours", async () => {
    await mount();
    const root = document.documentElement.style;
    root.setProperty("--color-surface-3", "#202020");
    try {
      act(() => h.theme.setState({ activeId: "core.dark" }));
      fake.fire("imagemissing", "pin:a");
    } finally {
      root.removeProperty("--color-surface-3");
    }
    const pin = fake.imageOf("pin:a")!;
    const centre = ((pin.height / 2) * pin.width + pin.width / 2) * 4;
    expect(Array.from(pin.data.slice(centre, centre + 3))).toEqual([0x20, 0x20, 0x20]);
  });

  it("ignores a pin draw that resolves after unmount", async () => {
    let resolveDraw: ((image: PinImage) => void) | null = null;
    const pending = new Promise<PinImage>((resolve) => {
      resolveDraw = resolve;
    });
    const { unmount } = render(<MapView factory={async () => fake.port} draw={() => pending} pixelRatio={1} />);
    await flush();
    fake.fire("load");
    await flush();
    // "c" has a thumbnailUrl (see beforeEach), so this reaches the rasteriser
    // and calls the injected `draw`, which we're holding open via `pending`.
    fake.fire("imagemissing", "pin:c");
    await flush();
    unmount();
    expect(fake.removed()).toBe(true);
    resolveDraw!(img);
    await flush();
    await flush();
    expect(fake.afterRemove()).toEqual([]);
  });

  it("ignores a pin draw that resolves after Reload, and the new map still gets its own pins", async () => {
    // Two independent fakes: a shared one's `removed` flag would be set by
    // the old generation's cleanup and then read by the new generation as if
    // it were disposed too.
    const portA = fakePort();
    const portB = fakePort();
    let calls = 0;
    const factory: MapFactory = async () => (calls++ === 0 ? portA.port : portB.port);
    let resolveDraw: ((image: PinImage) => void) | null = null;
    const pending = new Promise<PinImage>((resolve) => {
      resolveDraw = resolve;
    });
    let drawCalls = 0;
    const draw = () => (drawCalls++ === 0 ? pending : Promise.resolve(img));

    render(<MapView factory={factory} draw={draw} pixelRatio={1} />);
    await flush();
    portA.fire("load");
    await flush();
    // Starts a draw against generation 0's rasteriser, held open via `pending`.
    portA.fire("imagemissing", "pin:c");
    await flush();

    // Reload: tears down portA's map (generation 0) and brings up portB's
    // (generation 1) while portA's draw is still in flight.
    portA.fire("webglcontextlost");
    fireEvent.click(screen.getByRole("button", { name: "Reload map" }));
    await flush();
    portB.fire("load");
    await flush();
    expect(portA.removed()).toBe(true);
    expect(portB.removed()).toBe(false);

    // The new generation's rasteriser is fresh (a cache miss), so this reaches
    // `draw` again — its second call, which resolves immediately — and portB
    // gets its own pin delivered normally.
    portB.fire("imagemissing", "pin:c");
    await flush();
    await flush();
    expect(portB.calls.updateImage).toEqual(["pin:c"]);

    // Now resolve portA's stale draw. Its callback must not touch portA
    // (already removed) or portB (a different map instance) — and nothing
    // may throw, which is implicit in this completing at all.
    resolveDraw!(img);
    await flush();
    await flush();
    expect(portA.afterRemove()).toEqual([]);
  });

  it("rings the selection", async () => {
    await mount();
    act(() => h.catalog.getState().select("a"));
    const ring = fake.calls.setFilter.filter(([id]) => id === LAYER_RING).pop()!;
    expect(ring[1]).toEqual(["match", ["get", "id"], ["a"], true, false]);
  });

  it("reports a lost renderer and offers to reload", async () => {
    await mount();
    fake.fire("webglcontextlost");
    expect(screen.getByText("The map renderer was lost.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload map" })).toBeTruthy();
  });

  it("shows a notice when the map fails to start, and recovers on reload", async () => {
    let attempts = 0;
    const flaky: MapFactory = async () => {
      attempts++;
      if (attempts === 1) throw new Error("no webgl");
      return fake.port;
    };
    render(<MapView factory={flaky} draw={async () => img} pixelRatio={1} />);
    await flush();
    await flush();
    await flush();
    expect(screen.getByText("The map could not start.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload map" }));
    await flush();
    fake.fire("load");
    await flush();
    expect(screen.queryByText("The map could not start.")).toBeNull();
    expect(screen.getByTestId("map-canvas")).toBeTruthy();
  });

  it("clears a failed start's leftovers from the container before trying again", async () => {
    const found: number[] = [];
    let attempts = 0;
    const factory: MapFactory = async (container) => {
      found.push(container.childElementCount);
      container.appendChild(document.createElement("canvas"));
      if (attempts++ === 0) throw new Error("no webgl");
      return fake.port;
    };
    render(<MapView factory={factory} draw={async () => img} pixelRatio={1} />);
    await flush();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Reload map" }));
    await flush();
    expect(found).toEqual([0, 0]);
    expect(screen.getByTestId("map-canvas").childElementCount).toBe(1);
  });

  it("drops the could-not-start notice once a later map is created", async () => {
    let attempts = 0;
    const flaky: MapFactory = async () => {
      if (attempts++ === 0) throw new Error("no webgl");
      return fake.port;
    };
    const draw = async () => img;
    const { rerender } = render(<MapView factory={flaky} draw={draw} pixelRatio={1} />);
    await flush();
    await flush();
    expect(screen.getByText("The map could not start.")).toBeTruthy();
    rerender(<MapView factory={flaky} draw={draw} pixelRatio={2} />);
    await flush();
    fake.fire("load");
    await flush();
    expect(attempts).toBe(2);
    expect(screen.queryByText("The map could not start.")).toBeNull();
  });

  it("drops a lost renderer's notice once a later map is created", async () => {
    const first = render(<MapView factory={async () => fake.port} draw={async () => img} pixelRatio={1} />);
    await flush();
    fake.fire("load");
    fake.fire("webglcontextlost");
    expect(screen.getByText("The map renderer was lost.")).toBeTruthy();
    first.unmount();
    fake = fakePort();
    await mount();
    expect(screen.queryByText("The map renderer was lost.")).toBeNull();
  });

  it("keeps the tile-unavailable notice up until the basemap itself loads", async () => {
    await mount();
    fake.fire("error", BASEMAP_SOURCE, "network error");
    expect(store().getState().tileError).toBe(true);
    // Our own sources loading right after "load" must not clear a genuine
    // basemap failure.
    fake.fire("sourceloaded", PHOTO_SOURCE);
    expect(store().getState().tileError).toBe(true);
    fake.fire("sourceloaded", BASEMAP_SOURCE);
    expect(store().getState().tileError).toBe(false);
  });

  it("logs, without raising any notice, an error after load that did not come from the basemap source", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await mount();
      fake.fire("error", PHOTO_SOURCE, "layer does not exist");
      expect(store().getState().tileError).toBe(false);
      fake.fire("error", undefined, "some other error");
      expect(store().getState().tileError).toBe(false);
      expect(logged.mock.calls).toEqual([
        ["[map]", "layer does not exist"],
        ["[map]", "some other error"],
      ]);
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      logged.mockRestore();
    }
  });

  it("reports a style that failed to load, and logs its error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<MapView factory={async () => fake.port} draw={async () => img} pixelRatio={1} />);
      await flush();
      fake.fire("error", BASEMAP_SOURCE, "tiles unreachable");
      expect(logged).not.toHaveBeenCalled();
      fake.fire("error", undefined, "style is not valid");
      expect(logged.mock.calls).toEqual([["[map]", "style is not valid"]]);
      expect(screen.getByRole("status").textContent).toBe("Map style failed to load");
    } finally {
      logged.mockRestore();
    }
  });

  it("credits the tile and data sources with links", async () => {
    await mount();
    for (const { label, href } of ATTRIBUTION) {
      const link = screen.getByRole("link", { name: label }) as HTMLAnchorElement;
      // The attribute, not the `.href` IDL property: the latter is
      // URL-normalised (a bare-domain href reads back with a trailing "/").
      expect(link.getAttribute("href")).toBe(href);
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noreferrer");
    }
  });

  it("backs the credit with a translucent surface that also works with core's CSS-variable tokens", async () => {
    initRuntime({ ...h.api, ui: { ...h.api.ui, tokens: { ...h.api.ui.tokens, surface0: "var(--color-surface-0)" } } });
    await mount();
    const credit = screen.getByRole("link", { name: ATTRIBUTION[0].label }).parentElement!;
    expect(credit.style.background).toBe("color-mix(in srgb, var(--color-surface-0) 70%, transparent)");
  });
});
