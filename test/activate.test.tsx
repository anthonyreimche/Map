import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeFocusChannel } from "../src/channel";
import { FILTER_ID } from "../src/filter";
import {
  DEFAULT_LAYOUT,
  KEY_GO,
  MENU_REMOVE,
  MENU_SET,
  MENU_SHOW,
  MODULE_ID,
  GPS_TRACK_PANEL,
  PANEL_UNTAGGED,
  STYLESHEET_ID,
  activate,
  deactivate,
} from "../src/index";
import { LocationDialogHost } from "../src/LocationDialog";
import { PREF_KEYS } from "../src/prefs";
import type { GridMenuItemContribution } from "../src/safelight";
import { store } from "../src/store";
import { createHarness, located, photo, type Harness } from "./harness";
import { createFakeChannel } from "./fake-channel";

let h: Harness;
const originalUrl = window.location.href;

beforeEach(() => {
  h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" })] });
  activate(h.api, { channelFactory: createFakeChannel().factory });
});
afterEach(() => {
  closeFocusChannel();
  window.history.replaceState({}, "", originalUrl);
});

const labelOf = (item: GridMenuItemContribution, ids: string[]) => (typeof item.label === "function" ? item.label(ids) : item.label);

describe("activate", () => {
  it("registers the module with its layout, status bar and the Untagged strip", () => {
    const [m] = h.modules;
    expect([m.id, m.label]).toEqual([MODULE_ID, "Map"]);
    expect(m.statusBar).toBeDefined();
    expect(m.defaultLayout).toEqual(DEFAULT_LAYOUT);
    expect(GPS_TRACK_PANEL).toBe("gps-track.panel");
    expect(DEFAULT_LAYOUT.rails.find((r) => r.side === "right")?.panels).toEqual([GPS_TRACK_PANEL, "core.info"]);
    expect(DEFAULT_LAYOUT.rails.flatMap((r) => r.panels)).toEqual(
      expect.arrayContaining(["core.folders", "core.filters", "core.info", PANEL_UNTAGGED]),
    );
    expect(h.panels.map((p) => p.id)).toEqual([PANEL_UNTAGGED]);
    const strip = h.panels.find((p) => p.id === PANEL_UNTAGGED);
    expect(strip).toMatchObject({ fill: true, allowBottomDock: true, defaultDock: { module: MODULE_ID, direction: "bottom" } });
  });

  it("registers the shortcut, the pass-through filter, the stylesheet and the settings", () => {
    const key = h.keybindings.find((k) => k.id === KEY_GO)!;
    expect(key.defaultCombo).toBe("M");
    key.handler();
    expect(h.navigations).toEqual([MODULE_ID]);
    expect(h.gridFilters.get(FILTER_ID)!.test(photo({ id: "x" }))).toBe(true);
    expect(h.stylesheets.map((s) => s.id)).toEqual([STYLESHEET_ID]);
    expect(h.stylesheets[0].css).toContain(".maplibregl-map");
    expect(h.stylesheets[0].css).toContain("::backdrop");
    expect(h.settings[0].fields.map((f) => f.key)).toEqual([...PREF_KEYS]);
    expect(h.settings[0].fields.map((f) => f.key)).not.toContain("maxGapMinutes");
    expect(h.settings[0].keywords).not.toContain("gpx");
  });

  it("offers Show on map and Remove location in the Library menu", () => {
    const show = h.menuItems.find((i) => i.id === MENU_SHOW)!;
    const remove = h.menuItems.find((i) => i.id === MENU_REMOVE)!;
    expect(show.enabled?.(["a", "b"])).toBe(true);
    expect(show.enabled?.(["b"])).toBe(false);
    expect(remove.enabled?.(["b"])).toBe(false);
    expect(remove.enabled?.(["a"])).toBe(true);
    show.onClick(["a", "b"]);
    expect(h.navigations).toEqual([MODULE_ID]);
    expect(store().getState().pendingFocus).toEqual(["a"]);
  });

  it("offers Set location for any photos, and hosts its dialog in the Library and Develop toolbars", () => {
    const set = h.menuItems.find((i) => i.id === MENU_SET)!;
    expect(set.enabled?.(["b"]) ?? true).toBe(true);
    expect(labelOf(set, ["a"])).toBe("Set location…");
    expect(labelOf(set, ["a", "b"])).toBe("Set location… (2)");
    expect(h.slots.map((c) => [c.slot, c.component])).toEqual([
      ["library-toolbar", LocationDialogHost],
      ["develop-toolbar", LocationDialogHost],
    ]);
  });

  it("opens Set location at a lone photo's own location, and blank otherwise", () => {
    const set = h.menuItems.find((i) => i.id === MENU_SET)!;
    set.onClick(["a"]);
    expect(store().getState().locationRequest).toEqual({ ids: ["a"], initial: { lon: 1, lat: 1 }, current: true });
    set.onClick(["b"]);
    expect(store().getState().locationRequest).toEqual({ ids: ["b"], initial: null, current: false });
    set.onClick(["a", "b"]);
    expect(store().getState().locationRequest).toEqual({ ids: ["a", "b"], initial: null, current: false });
  });

  it("opens Set location where it was asked for while a host is mounted there", () => {
    const { unmount } = render(<LocationDialogHost />);
    try {
      act(() => h.menuItems.find((i) => i.id === MENU_SET)!.onClick(["b"]));
      expect(h.navigations).toEqual([]);
      expect(screen.getByRole("dialog", { name: "Set location" })).toBeTruthy();
    } finally {
      unmount();
    }
  });

  it("takes Set location to the Map when nothing here can show it", () => {
    h.menuItems.find((i) => i.id === MENU_SET)!.onClick(["b"]);
    expect(h.navigations).toEqual([MODULE_ID]);
    expect(store().getState().locationRequest?.ids).toEqual(["b"]);
  });

  it("asks for nothing it cannot show: no host here, and the Map popped out", () => {
    h.api.stores.useUIStore.setState({ detached: new Set([MODULE_ID]) });
    h.menuItems.find((i) => i.id === MENU_SET)!.onClick(["b"]);
    expect(h.navigations).toEqual([]);
    expect(store().getState().locationRequest).toBeNull();
  });

  it("orders the menu: Show on map, Set location, Remove location", () => {
    const order = (id: string) => h.menuItems.find((i) => i.id === id)!.order!;
    expect(order(MENU_SHOW)).toBeLessThan(order(MENU_SET));
    expect(order(MENU_SET)).toBeLessThan(order(MENU_REMOVE));
  });

  it("counts only the targeted photos that have a location in Remove location", () => {
    h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" }), located("c", 2, 2)] });
    activate(h.api, { channelFactory: createFakeChannel().factory });
    const remove = h.menuItems.find((i) => i.id === MENU_REMOVE)!;
    expect(labelOf(remove, ["a", "b"])).toBe("Remove location");
    expect(labelOf(remove, ["a", "b", "c"])).toBe("Remove location (2)");
  });

  it("removes a location through the menu, undoably", async () => {
    const remove = h.menuItems.find((i) => i.id === MENU_REMOVE)!;
    remove.onClick(["a", "b"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.relocated[0].map((p) => p.id)).toEqual(["a"]);
    expect(store().getState().undo[0].label).toBe("Undo removing 1 location");
  });

  it("deactivates without throwing", () => {
    expect(() => deactivate()).not.toThrow();
  });
});

// The Map's view can be mounted in a different window from the Library grid
// whose "Show on map" menu item was clicked (either can be popped out), and
// each window runs its own copy of this extension — its own store, its own
// module-level channel binding. These tests exercise that wiring through a
// second, independent channel port sharing the same fake bus, standing in
// for "another window".
describe("cross-window Show on map", () => {
  it("an incoming request from another channel instance focuses this window's mounted map", () => {
    const { factory } = createFakeChannel();
    h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" })] });
    activate(h.api, { channelFactory: factory });
    const focus = vi.fn();
    store().getState().setCommands({ fitToPhotos: vi.fn(), fitToOverlay: vi.fn(), focus });
    factory().post(["a"]);
    expect(focus).toHaveBeenCalledWith(["a"]);
  });

  it("posts the ids and calls no local commands when this window has no mounted map", () => {
    const { factory } = createFakeChannel();
    h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" })] });
    activate(h.api, { channelFactory: factory });
    const seen: string[][] = [];
    factory().subscribe((ids) => seen.push(ids));
    const show = h.menuItems.find((i) => i.id === MENU_SHOW)!;
    show.onClick(["a", "b"]);
    expect(seen).toEqual([["a"]]);
  });

  it("skips pendingFocus when the host reports the Map module detached to another window", () => {
    const { factory } = createFakeChannel();
    h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" })] });
    activate(h.api, { channelFactory: factory });
    h.api.stores.useUIStore.setState({ detached: new Set([MODULE_ID]) });
    const show = h.menuItems.find((i) => i.id === MENU_SHOW)!;
    show.onClick(["a", "b"]);
    expect(store().getState().pendingFocus).toBeNull();
    expect(h.navigations).toEqual([MODULE_ID]);
  });

  it("keeps a request from another window as pending focus in the main window, for the Map it is about to open", () => {
    const { factory } = createFakeChannel();
    h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" })] });
    activate(h.api, { channelFactory: factory });
    factory().post(["a"]);
    expect(store().getState().pendingFocus).toEqual(["a"]);
  });

  it("drops a request without a mounted map in a pop-out window, and in the main window while the Map is popped out", () => {
    const { factory } = createFakeChannel();
    h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" })] });
    activate(h.api, { channelFactory: factory });
    window.history.replaceState({}, "", "/?detached=library");
    factory().post(["a"]);
    expect(store().getState().pendingFocus).toBeNull();
    window.history.replaceState({}, "", originalUrl);
    h.api.stores.useUIStore.setState({ detached: new Set([MODULE_ID]) });
    factory().post(["a"]);
    expect(store().getState().pendingFocus).toBeNull();
  });
});
