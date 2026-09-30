import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILTER_ID } from "../src/filter";
import { initRuntime } from "../src/rt";
import { StatusBar } from "../src/StatusBar";
import { initStore, store } from "../src/store";
import { isDetachedWindow, Toolbar, countsText, undoLast } from "../src/Toolbar";
import { createHarness, flush, located, type Harness } from "./harness";

let h: Harness;
const originalUrl = window.location.href;

beforeEach(() => {
  h = createHarness({ photos: [located("a", 1, 1)] });
  initRuntime(h.api);
  initStore();
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", originalUrl);
});

describe("Toolbar", () => {
  it("fits to photos through the map's commands", () => {
    const fitToPhotos = vi.fn();
    store().getState().setCommands({ fitToPhotos, fitToTrack: vi.fn(), focus: vi.fn() });
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Fit to photos" }));
    expect(fitToPhotos).toHaveBeenCalledTimes(1);
  });

  it("toggles the Library filter and re-registers it", () => {
    store().getState().setBounds({ west: 0, south: 0, east: 10, north: 10 });
    render(<Toolbar />);
    fireEvent.click(screen.getByLabelText("Filter Library to map view"));
    expect(store().getState().filterToView).toBe(true);
    expect(h.gridFilters.get(FILTER_ID)!.test(located("out", 50, 50))).toBe(false);
    fireEvent.click(screen.getByLabelText("Filter Library to map view"));
    expect(store().getState().filterToView).toBe(false);
    expect(h.gridFilters.get(FILTER_ID)!.test(located("out", 50, 50))).toBe(true);
  });

  it("disables Undo until there is something to undo, then names it", async () => {
    render(<Toolbar />);
    const undo = () => screen.getByRole("button", { name: /Undo/ });
    expect((undo() as HTMLButtonElement).disabled).toBe(true);
    act(() => store().getState().pushUndo({ label: "Undo placing 2 photos", previous: new Map([["a", null]]) }));
    expect(undo().textContent).toBe("Undo placing 2 photos");
    fireEvent.click(undo());
    await flush();
    expect(h.relocated[0][0].exif.gpsLatitude).toBeUndefined();
    expect(store().getState().undo).toEqual([]);
  });

  it("undoLast is a no-op with an empty stack", async () => {
    await undoLast();
    expect(h.relocated).toEqual([]);
  });

  // A failed write must not lose the undo entry — it goes back on the stack
  // (becoming the top again) so the user can retry.
  it("puts the entry back on the stack when the undo write fails, and keeps its label on the button", async () => {
    render(<Toolbar />);
    act(() => store().getState().pushUndo({ label: "Undo placing 1 photo", previous: new Map([["a", null]]) }));
    h.catalog.setState({
      relocatePhotos: async () => {
        throw new Error("disk full");
      },
    });

    await act(async () => {
      await undoLast();
    });

    expect(store().getState().undo).toHaveLength(1);
    expect(store().getState().error).toBe("disk full");
    expect(screen.getByRole("button", { name: /Undo/ }).textContent).toBe("Undo placing 1 photo");
  });

  // A pop-out Map window can't reach the main window's Library grid, so the
  // toggle that filters it is hidden there.
  it("shows the Library filter toggle in the main window", () => {
    render(<Toolbar />);
    expect(screen.getByLabelText("Filter Library to map view")).toBeTruthy();
  });

  it("hides the Library filter toggle in a pop-out (detached) window", () => {
    window.history.replaceState({}, "", "/?detached=map");
    render(<Toolbar />);
    expect(screen.queryByLabelText("Filter Library to map view")).toBeNull();
  });
});

describe("isDetachedWindow", () => {
  it("is false in the main window and true once `detached` is a non-empty query param", () => {
    expect(isDetachedWindow()).toBe(false);
    window.history.replaceState({}, "", "/?detached=map");
    expect(isDetachedWindow()).toBe(true);
    window.history.replaceState({}, "", "/?detached=");
    expect(isDetachedWindow()).toBe(false);
  });
});

describe("counts", () => {
  it("reads naturally", () => {
    expect(countsText(142, 1203, 37)).toBe("142 of 1,203 photos have a location · 37 in view");
    expect(countsText(1, 1, 1)).toBe("1 of 1 photo has a location · 1 in view");
  });

  it("is what the status bar shows", () => {
    store().getState().setCounts(2, 5, 1);
    render(<StatusBar />);
    expect(screen.getByText("2 of 5 photos have a location · 1 in view")).toBeTruthy();
  });
});
