// Session state: nothing here persists. The view registers its commands so
// the toolbar, panels and menu items can drive the map without holding it.

import type { Bounds, GpsFix, LonLat } from "./geo";
import { EMPTY_OVERLAY_DATA, overlayData, type OverlayData, type ValidOverlay } from "./overlays";
import { api } from "./rt";
import type { StoreApi } from "./safelight";

export interface UndoEntry {
  /** Button label, e.g. "Undo placing 3 photos". */
  label: string;
  /** Each photo's fix before the change; null = it had none. */
  previous: Map<string, GpsFix | null>;
}

/** An open Set location dialog. */
export interface LocationRequest {
  /** The photos the location goes to. */
  ids: string[];
  /** What the field starts with: the right-clicked map point, or a lone
   *  photo's own location; null starts it empty. */
  initial: LonLat | null;
  /** The targets already sit at `initial`, so submitting it unedited would
   *  only round their position and drop their altitude. */
  current?: boolean;
}

export interface MapCommands {
  fitToPhotos(): void;
  /** Fit the view to one map.overlays entry. */
  fitToOverlay(key: string): void;
  /** Fit the view to these photos (a "Show on map" request). */
  focus(ids: readonly string[]): void;
}

export interface MapState {
  filterToView: boolean;
  bounds: Bounds | null;
  located: number;
  total: number;
  inView: number;
  /** map.overlays entries that passed checking, in key order. */
  overlays: ValidOverlay[];
  /** `overlays` as the two GeoJSON sources, rebuilt on every setOverlays (each
   *  delivery of map.overlays): that is when the view pushes it to the map. */
  overlayData: OverlayData;
  /** An overlay to fit once the view mounts: one added while the Map wasn't showing. */
  pendingFit: string | null;
  undo: UndoEntry[];
  tileError: boolean;
  rendererLost: boolean;
  error: string | null;
  commands: MapCommands | null;
  /** Ids to focus once the view mounts (a "Show on map" before the module was open). */
  pendingFocus: string[] | null;
  /** The active photo the map last flew to, or that a click on the map made
   *  active: the view flies only when the active photo differs from it. Kept
   *  here, not in the view, because the view unmounts on every module switch. */
  handledActiveId: string | null;
  locationRequest: LocationRequest | null;
  /** Set location hosts mounted in this window right now. */
  dialogHosts: number;
  setFilterToView(v: boolean): void;
  setBounds(b: Bounds | null): void;
  setCounts(located: number, total: number, inView: number): void;
  setOverlays(list: ValidOverlay[]): void;
  setPendingFit(key: string | null): void;
  pushUndo(entry: UndoEntry): void;
  popUndo(): UndoEntry | undefined;
  setTileError(v: boolean): void;
  setRendererLost(v: boolean): void;
  setError(message: string | null): void;
  setCommands(c: MapCommands | null): void;
  setPendingFocus(ids: string[] | null): void;
  setHandledActiveId(id: string | null): void;
  setLocationRequest(request: LocationRequest | null): void;
  addDialogHost(): void;
  removeDialogHost(): void;
}

export const UNDO_DEPTH = 20;

let bound: StoreApi<MapState> | null = null;

export function initStore(): void {
  bound = api.stores.create<MapState>((set, get) => ({
    filterToView: false,
    bounds: null,
    located: 0,
    total: 0,
    inView: 0,
    overlays: [],
    overlayData: EMPTY_OVERLAY_DATA,
    pendingFit: null,
    undo: [],
    tileError: false,
    rendererLost: false,
    error: null,
    commands: null,
    pendingFocus: null,
    handledActiveId: null,
    locationRequest: null,
    dialogHosts: 0,
    setFilterToView: (filterToView) => set({ filterToView }),
    setBounds: (bounds) => set({ bounds }),
    setCounts: (located, total, inView) => set({ located, total, inView }),
    setOverlays: (overlays) => set({ overlays, overlayData: overlayData(overlays) }),
    setPendingFit: (pendingFit) => set({ pendingFit }),
    pushUndo: (entry) => set({ undo: [...get().undo, entry].slice(-UNDO_DEPTH) }),
    popUndo: () => {
      const undo = get().undo;
      const top = undo[undo.length - 1];
      if (top) set({ undo: undo.slice(0, -1) });
      return top;
    },
    setTileError: (tileError) => set({ tileError }),
    setRendererLost: (rendererLost) => set({ rendererLost }),
    setError: (error) => set({ error }),
    setCommands: (commands) => set({ commands }),
    // The later, explicit request wins: a "Show on map" must not be undone by
    // an overlay fit that queued up while the Map wasn't showing.
    setPendingFocus: (pendingFocus) => set(pendingFocus ? { pendingFocus, pendingFit: null } : { pendingFocus }),
    setHandledActiveId: (handledActiveId) => set({ handledActiveId }),
    setLocationRequest: (locationRequest) => set({ locationRequest }),
    addDialogHost: () => set({ dialogHosts: get().dialogHosts + 1 }),
    removeDialogHost: () => set({ dialogHosts: Math.max(0, get().dialogHosts - 1) }),
  }));
}

export function store(): StoreApi<MapState> {
  if (bound === null) throw new Error("[map] store() called before activate()");
  return bound;
}

/** React hook over the session store. */
export function useMapStore<U>(selector: (s: MapState) => U): U {
  return store()(selector);
}
