import { beforeEach, describe, expect, it } from "vitest";
import { initRuntime } from "../src/rt";
import { UNDO_DEPTH, initStore, store } from "../src/store";
import { createHarness } from "./harness";

beforeEach(() => {
  initRuntime(createHarness().api);
  initStore();
});

describe("map store", () => {
  it("starts with nothing loaded and no filter", () => {
    const s = store().getState();
    expect(s.filterToView).toBe(false);
    expect(s.bounds).toBeNull();
    expect(s.overlays).toEqual([]);
    expect(s.pendingFit).toBeNull();
    expect(s.undo).toEqual([]);
    expect(s.commands).toBeNull();
  });

  it("keeps the undo stack bounded, newest last", () => {
    const s = store().getState();
    for (let i = 0; i < UNDO_DEPTH + 5; i++) s.pushUndo({ label: `u${i}`, previous: new Map() });
    const undo = store().getState().undo;
    expect(undo.length).toBe(UNDO_DEPTH);
    expect(undo[undo.length - 1].label).toBe(`u${UNDO_DEPTH + 4}`);
    expect(store().getState().popUndo()?.label).toBe(`u${UNDO_DEPTH + 4}`);
    expect(store().getState().undo.length).toBe(UNDO_DEPTH - 1);
  });

  it("records counts, and overlays with their drawn data", () => {
    store().getState().setCounts(3, 10, 2);
    expect(store().getState()).toMatchObject({ located: 3, total: 10, inView: 2 });
    store().getState().setOverlays([{ key: "k", label: "x", lines: [[[0, 0], [1, 1]]], points: [], bounds: null }]);
    expect(store().getState().overlayData.lines.features).toHaveLength(1);
  });

  it("drops a pending overlay fit when a Show on map request comes in after it", () => {
    store().getState().setPendingFit("k");
    store().getState().setPendingFocus(["a"]);
    expect(store().getState()).toMatchObject({ pendingFocus: ["a"], pendingFit: null });
  });

  it("keeps a pending overlay fit when the pending focus is only cleared", () => {
    store().getState().setPendingFit("k");
    store().getState().setPendingFocus(null);
    expect(store().getState()).toMatchObject({ pendingFocus: null, pendingFit: "k" });
  });
});
