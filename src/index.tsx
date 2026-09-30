// Map — Safelight extension (MIT). Registration and teardown only; the view
// lives in MapView.tsx, the panels in UntaggedStrip.tsx and TrackPanel.tsx,
// the cross-window "Show on map" transport in channel.ts.

import maplibreCss from "maplibre-gl/dist/maplibre-gl.css?inline";
import { closeFocusChannel, openFocusChannel, postFocusRequest, type FocusChannelFactory } from "./channel";
import { syncInViewFilter } from "./filter";
import { hasLocation } from "./geo";
import { catalogDeps, removeLocation } from "./geotag";
import { MapView } from "./MapView";
import { SETTINGS_FIELDS } from "./prefs";
import { initRuntime } from "./rt";
import type { ModuleLayoutDef, SafelightAPI } from "./safelight";
import { StatusBar } from "./StatusBar";
import { initStore, store } from "./store";
import { isDetachedWindow } from "./Toolbar";
import { TrackPanel } from "./TrackPanel";
import { UntaggedStrip } from "./UntaggedStrip";

export const MODULE_ID = "map";
export const PANEL_UNTAGGED = "map.untagged";
export const PANEL_TRACK = "map.track";
export const KEY_GO = "map.go";
export const MENU_SHOW = "map.show-on-map";
export const MENU_REMOVE = "map.remove-location";
export const STYLESHEET_ID = "map.styles";

export const DEFAULT_LAYOUT: ModuleLayoutDef = {
  rails: [
    { side: "left", width: 240, panels: ["core.folders", "core.filters"] },
    { side: "right", width: 280, panels: [PANEL_TRACK, "core.info"] },
    { side: "bottom", height: 112, panels: [PANEL_UNTAGGED] },
  ],
};

export interface ActivateOptions {
  /** Overrides the cross-window channel's transport, so tests never open a
   *  real BroadcastChannel. */
  channelFactory?: FocusChannelFactory;
}

export function activate(host: SafelightAPI, options: ActivateOptions = {}): void {
  initRuntime(host);
  initStore();

  // A window with a mounted map focuses it. Without one, only the main window
  // keeps the request, and only while the Map is not popped out: a "Show on
  // map" from a pop-out navigates the main window, whose Map mounts after the
  // request has already arrived. Every other window drops it.
  openFocusChannel((ids) => {
    const s = store().getState();
    if (s.commands) s.commands.focus(ids);
    else if (!isDetachedWindow() && !mapPoppedOut(host)) s.setPendingFocus(ids);
  }, options.channelFactory);

  // MapLibre's own CSS only: the attribution control stays disabled
  // (maplibre-port.ts) and MapView renders the credit itself as plain React
  // text, so no `.maplibregl-ctrl-attrib` rule is needed — npm audit's
  // GHSA-jrc7-96c5-q579 (a critical XSS in that control's use of
  // `DOM.sanitize()`, fixed only in 6.4.1+) is never reached either way. See
  // the README's Maintenance notes.
  host.registerStylesheet({ id: STYLESHEET_ID, css: maplibreCss });

  host.registerModule({
    id: MODULE_ID,
    label: "Map",
    component: MapView,
    statusBar: StatusBar,
    defaultLayout: DEFAULT_LAYOUT,
  });

  host.registerPanel({
    id: PANEL_UNTAGGED,
    title: "Untagged",
    component: UntaggedStrip,
    fill: true,
    allowBottomDock: true,
    defaultDock: { module: MODULE_ID, direction: "bottom", order: 0, height: 112 },
  });

  host.registerPanel({
    id: PANEL_TRACK,
    title: "GPS Track",
    component: TrackPanel,
    defaultDock: { module: MODULE_ID, direction: "right", order: 0, width: 280 },
  });

  host.registerKeybinding({
    id: KEY_GO,
    label: "Go to Map",
    category: "General",
    defaultCombo: "M",
    handler: () => host.navigation.goTo(MODULE_ID),
  });

  syncInViewFilter();

  host.registerGridMenuItem({
    id: MENU_SHOW,
    label: "Show on map",
    order: 60,
    enabled: (ids) => photosOf(host, ids).some(hasLocation),
    onClick: (ids) => {
      const located = photosOf(host, ids).filter(hasLocation).map((p) => p.id);
      const s = store().getState();
      if (s.commands) {
        // The map is right here in this window: focus it directly, no need
        // to tell any other window.
        s.commands.focus(located);
      } else {
        postFocusRequest(located);
        // Only set it locally when the Map isn't popped out elsewhere — if
        // it is, this window's store isn't the one a later-mounted Map view
        // would read, and a pendingFocus left here would replay stale once
        // the Map is re-attached to this window.
        if (!mapPoppedOut(host)) s.setPendingFocus(located);
      }
      host.navigation.goTo(MODULE_ID);
    },
  });

  host.registerGridMenuItem({
    id: MENU_REMOVE,
    label: (ids) => {
      const n = photosOf(host, ids).filter(hasLocation).length;
      return n > 1 ? `Remove location (${n})` : "Remove location";
    },
    order: 61,
    enabled: (ids) => photosOf(host, ids).some(hasLocation),
    onClick: (ids) => {
      void removeLocation(ids, catalogDeps()).catch((e: unknown) =>
        store().getState().setError(e instanceof Error ? e.message : String(e)),
      );
    },
  });

  host.registerSettings({
    title: "Map",
    keywords: ["map", "gps", "geotag", "cluster", "gpx", "track"],
    fields: [...SETTINGS_FIELDS],
  });
}

function photosOf(host: SafelightAPI, ids: readonly string[]) {
  const wanted = new Set(ids);
  return host.stores.useCatalogStore.getState().photos.filter((p) => wanted.has(p.id));
}

function mapPoppedOut(host: SafelightAPI): boolean {
  return host.stores.useUIStore.getState().detached.has(MODULE_ID);
}

export function deactivate(): void {
  closeFocusChannel();
  try {
    const s = store().getState();
    s.setCommands(null);
    s.setTrack(null, null);
    s.setFilterToView(false);
  } catch {
    // Disabling an extension that never finished activate(): nothing to tear down.
  }
}
