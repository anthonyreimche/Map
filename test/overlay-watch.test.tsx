import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { closeFocusChannel } from "../src/channel";
import { activate, deactivate } from "../src/index";
import { OVERLAYS_DESCRIPTION, OVERLAYS_VAR, type MapOverlays } from "../src/overlays";
import { store } from "../src/store";
import { createFakeChannel } from "./fake-channel";
import { createHarness, type Harness } from "./harness";

const track = (label: string, coords: [number, number][]) => ({
  label,
  geojson: { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: coords } }] },
});

const originalUrl = window.location.href;
let h: Harness;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  h = createHarness();
  activate(h.api, { channelFactory: createFakeChannel().factory });
});
afterEach(() => {
  window.history.replaceState({}, "", originalUrl);
  h.api.stores.useUIStore.setState({ detached: new Set<string>() });
  deactivate();
  closeFocusChannel();
  warn.mockRestore();
});

const gps = () => h.variables.forExtension("gps-track");
const add = (key: string, entry: unknown) => gps().update<MapOverlays>(OVERLAYS_VAR, (o) => ({ ...o, [key]: entry as MapOverlays[string] }));
const overlayWarnings = (key: string) => warn.mock.calls.filter(([m]) => String(m).startsWith(`[map] overlay "${key}"`));

describe("map.overlays", () => {
  it("is registered by Map with an empty initial value and its description", () => {
    expect(h.variables.snapshot(OVERLAYS_VAR)).toMatchObject({ value: {}, registeredBy: { extension: "map" }, description: OVERLAYS_DESCRIPTION });
  });

  it("stores what another extension adds, and what it removes", () => {
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    expect(store().getState().overlays.map((o) => o.key)).toEqual(["gps-track"]);
    expect(store().getState().overlayData.lines.features).toHaveLength(1);
    gps().update<MapOverlays>(OVERLAYS_VAR, ({ "gps-track": _gone, ...rest }) => rest);
    expect(store().getState().overlays).toEqual([]);
  });

  it("fits to a new or relabelled entry through the map's commands, not to a same-label update", () => {
    const fitToOverlay = vi.fn();
    store().getState().setCommands({ fitToPhotos: vi.fn(), fitToOverlay, focus: vi.fn() });
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    add("gps-track", track("ride.gpx", [[1, 1], [3, 3]]));
    add("gps-track", track("walk.gpx", [[5, 5], [6, 6]]));
    expect(fitToOverlay.mock.calls).toEqual([["gps-track"], ["gps-track"]]);
  });

  it("keeps the fit for the view to do when the map isn't mounted", () => {
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    expect(store().getState().pendingFit).toBe("gps-track");
  });

  it("keeps no pending fit in the main window while the Map is popped out", () => {
    h.api.stores.useUIStore.setState({ detached: new Set(["map"]) });
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    expect(store().getState().overlays).toHaveLength(1);
    expect(store().getState().pendingFit).toBeNull();
  });

  it("keeps no pending fit in another module's pop-out", () => {
    window.history.replaceState({}, "", "?detached=develop");
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    expect(store().getState().overlays).toHaveLength(1);
    expect(store().getState().pendingFit).toBeNull();
  });

  it("keeps the pending fit in the Map's own pop-out", () => {
    window.history.replaceState({}, "", "?detached=map");
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    expect(store().getState().pendingFit).toBe("gps-track");
  });

  it("doesn't fit to entries already there when Map activates", () => {
    deactivate();
    const shared = h.variables;
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    h = createHarness({ variables: shared });
    activate(h.api, { channelFactory: createFakeChannel().factory });
    expect(store().getState().overlays).toHaveLength(1);
    expect(store().getState().pendingFit).toBeNull();
  });

  it("skips a bad entry and logs it once while it stays bad", () => {
    add("broken", { label: 3 });
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    expect(store().getState().overlays.map((o) => o.key)).toEqual(["gps-track"]);
    expect(overlayWarnings("broken")).toEqual([['[map] overlay "broken" ignored: needs a string label']]);
  });

  it("logs a bad entry again after it was fixed and broke once more", () => {
    add("flaky", { label: 3 });
    add("flaky", track("ok", [[1, 1], [2, 2]]));
    add("flaky", { label: 3 });
    expect(overlayWarnings("flaky")).toHaveLength(2);
  });

  it("logs at most the first 5 problems of a hostile entry, and counts the rest", () => {
    const features = Array.from({ length: 7 }, () => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[999, 999]] },
    }));
    add("hostile", { label: "x", geojson: { type: "FeatureCollection", features } });
    expect(overlayWarnings("hostile")).toEqual([
      [
        '[map] overlay "hostile" partly drawn: ' +
          [0, 1, 2, 3, 4].map((i) => `feature ${i} has invalid coordinates`).join("; ") +
          "; … and 2 more",
      ],
    ]);
  });

  it("stops listening on deactivate", () => {
    deactivate();
    add("gps-track", track("ride.gpx", [[1, 1], [2, 2]]));
    expect(store().getState().overlays).toEqual([]);
  });
});
