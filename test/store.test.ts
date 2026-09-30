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
    expect(s.track).toBeNull();
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

  it("records counts and a loaded track", () => {
    store().getState().setCounts(3, 10, 2);
    expect(store().getState()).toMatchObject({ located: 3, total: 10, inView: 2 });
    store().getState().setTrack({ name: "t", segments: [], pointCount: 0, start: 0, end: 0 }, "walk.gpx");
    expect(store().getState().trackFile).toBe("walk.gpx");
  });
});
