import { beforeEach, describe, expect, it } from "vitest";
import { FILTER_ID, inViewPredicate, syncInViewFilter } from "../src/filter";
import { initRuntime } from "../src/rt";
import { initStore, store } from "../src/store";
import { createHarness, located, photo, type Harness } from "./harness";

let h: Harness;
beforeEach(() => {
  h = createHarness();
  initRuntime(h.api);
  initStore();
});

const box = { west: 0, south: 0, east: 10, north: 10 };

describe("inViewPredicate", () => {
  it("passes everything while the filter is off or there are no bounds yet", () => {
    expect(inViewPredicate(false, box)(photo({ id: "a" }))).toBe(true);
    expect(inViewPredicate(true, null)(photo({ id: "a" }))).toBe(true);
  });

  it("keeps only located photos inside the bounds", () => {
    const test = inViewPredicate(true, box);
    expect(test(located("in", 5, 5))).toBe(true);
    expect(test(located("out", 50, 5))).toBe(false);
    expect(test(photo({ id: "none" }))).toBe(false);
  });
});

describe("syncInViewFilter", () => {
  it("registers the filter under its id with the store's current state", () => {
    store().getState().setBounds(box);
    store().getState().setFilterToView(true);
    syncInViewFilter();
    const f = h.gridFilters.get(FILTER_ID)!;
    expect(f.test(located("in", 5, 5))).toBe(true);
    expect(f.test(located("out", 50, 5))).toBe(false);
  });

  it("re-registers as a pass-through when the toggle is off", () => {
    store().getState().setBounds(box);
    syncInViewFilter();
    expect(h.gridFilters.get(FILTER_ID)!.test(located("out", 50, 5))).toBe(true);
  });

  it("turns the toggle off when the Library clears its filters", () => {
    store().getState().setFilterToView(true);
    syncInViewFilter();
    h.gridFilters.get(FILTER_ID)!.onClear?.();
    expect(store().getState().filterToView).toBe(false);
    expect(h.gridFilters.get(FILTER_ID)!.test(located("out", 50, 5))).toBe(true);
  });
});
