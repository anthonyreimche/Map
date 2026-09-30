// Session state: nothing here persists. The view registers its commands so
// the toolbar, panels and menu items can drive the map without holding it.

import type { Bounds, GpsFix } from "./geo";
import type { Track } from "./gpx";
import { api } from "./rt";
import type { StoreApi } from "./safelight";

export interface UndoEntry {
  /** Button label, e.g. "Undo placing 3 photos". */
  label: string;
  /** Each photo's fix before the change; null = it had none. */
  previous: Map<string, GpsFix | null>;
}

export interface MapCommands {
  fitToPhotos(): void;
  fitToTrack(): void;
  /** Fit the view to these photos (a "Show on map" request). */
  focus(ids: readonly string[]): void;
}

export interface MapState {
  filterToView: boolean;
  bounds: Bounds | null;
  located: number;
  total: number;
  inView: number;
  track: Track | null;
  trackFile: string | null;
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
  setFilterToView(v: boolean): void;
  setBounds(b: Bounds | null): void;
  setCounts(located: number, total: number, inView: number): void;
  setTrack(track: Track | null, file: string | null): void;
  pushUndo(entry: UndoEntry): void;
  popUndo(): UndoEntry | undefined;
  setTileError(v: boolean): void;
  setRendererLost(v: boolean): void;
  setError(message: string | null): void;
  setCommands(c: MapCommands | null): void;
  setPendingFocus(ids: string[] | null): void;
  setHandledActiveId(id: string | null): void;
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
    track: null,
    trackFile: null,
    undo: [],
    tileError: false,
    rendererLost: false,
    error: null,
    commands: null,
    pendingFocus: null,
    handledActiveId: null,
    setFilterToView: (filterToView) => set({ filterToView }),
    setBounds: (bounds) => set({ bounds }),
    setCounts: (located, total, inView) => set({ located, total, inView }),
    setTrack: (track, trackFile) => set({ track, trackFile }),
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
    setPendingFocus: (pendingFocus) => set({ pendingFocus }),
    setHandledActiveId: (handledActiveId) => set({ handledActiveId }),
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
