import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DND_PHOTOS } from "../src/dnd";
import { FILTER_ID } from "../src/filter";
import { initRuntime } from "../src/rt";
import { initStore } from "../src/store";
import { UntaggedStrip, visibleRange } from "../src/UntaggedStrip";
import { createHarness, located, photo, type Harness } from "./harness";

let h: Harness;
beforeEach(() => {
  h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" }), photo({ id: "c" })] });
  initRuntime(h.api);
  initStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const cells = () => Array.from(document.querySelectorAll("[data-photo-id]")).map((el) => el.getAttribute("data-photo-id"));
const untagged = (n: number) => Array.from({ length: n }, (_, i) => photo({ id: `p${i}` }));
const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `p${from + i}`);

describe("UntaggedStrip", () => {
  it("lists only the visible photos without a location", () => {
    render(<UntaggedStrip />);
    expect(cells()).toEqual(["b", "c"]);
  });

  it("ignores its own in-view filter but honours others", () => {
    h.gridFilters.set(FILTER_ID, { id: FILTER_ID, test: () => false });
    h.gridFilters.set("search", { id: "search", test: (p) => p.id !== "c" });
    render(<UntaggedStrip />);
    expect(cells()).toEqual(["b"]);
  });

  it("selects on click and drags the whole selection", () => {
    render(<UntaggedStrip />);
    fireEvent.click(screen.getByText("b.NEF"));
    fireEvent.click(screen.getByText("c.NEF"), { ctrlKey: true });
    expect([...h.catalog.getState().selectedIds].sort()).toEqual(["b", "c"]);
    const data: Record<string, string> = {};
    fireEvent.dragStart(screen.getByText("b.NEF"), {
      dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: "" },
    });
    expect(JSON.parse(data[DND_PHOTOS]).sort()).toEqual(["b", "c"]);
  });

  it("drags just the photo when it is not part of the selection", () => {
    render(<UntaggedStrip />);
    fireEvent.click(screen.getByText("b.NEF"));
    const data: Record<string, string> = {};
    fireEvent.dragStart(screen.getByText("c.NEF"), {
      dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: "" },
    });
    expect(JSON.parse(data[DND_PHOTOS])).toEqual(["c"]);
  });

  it("says so when every visible photo has a location", () => {
    h.catalog.setState({ photos: [located("a", 1, 1)] });
    render(<UntaggedStrip />);
    expect(screen.getByText("Every visible photo has a location.")).toBeTruthy();
  });

  it("re-attaches the wheel scroller once an untagged photo appears after an empty mount", () => {
    h.catalog.setState({ photos: [located("a", 1, 1)] });
    render(<UntaggedStrip />);
    expect(screen.getByText("Every visible photo has a location.")).toBeTruthy();
    act(() => h.catalog.setState({ photos: [located("a", 1, 1), photo({ id: "b" })] }));
    const strip = screen.getByTestId("untagged-strip");
    fireEvent.wheel(strip, { deltaY: 100 });
    expect(strip.scrollLeft).toBe(100);
  });

  it("renders only a bounded first window of cells until the strip is measured", () => {
    h.catalog.setState({ photos: untagged(100) });
    render(<UntaggedStrip />);
    expect(cells()).toEqual(ids(0, 30));
  });

  it("windows the cells to the measured width as the strip scrolls", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(300);
    h.catalog.setState({ photos: untagged(100) });
    render(<UntaggedStrip />);
    // 100 px cells (the 112 px fallback height less padding) on a 104 px stride, 6 cells of overscan.
    expect(cells()).toEqual(ids(0, 9));
    const strip = screen.getByTestId("untagged-strip");
    strip.scrollLeft = 1040;
    fireEvent.scroll(strip);
    expect(cells()).toEqual(ids(4, 19));
  });
});

describe("visibleRange", () => {
  it("windows the cells around the viewport with overscan", () => {
    expect(visibleRange(0, 300, 100, 4, 50, 2)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(1000, 300, 100, 4, 50, 2)).toEqual({ start: 7, end: 15 });
    expect(visibleRange(0, 300, 100, 4, 0, 2)).toEqual({ start: 0, end: 0 });
  });
});
