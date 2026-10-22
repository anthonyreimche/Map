import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationDialogHost } from "../src/LocationDialog";
import { initRuntime } from "../src/rt";
import { initStore, store, type LocationRequest } from "../src/store";
import { createHarness, flush, located, photo, type Harness } from "./harness";

let h: Harness;

beforeEach(() => {
  h = createHarness({ photos: [located("a", 1, 1), photo({ id: "b" }), photo({ id: "c" })] });
  initRuntime(h.api);
  initStore();
});
afterEach(() => cleanup());

const ask = (request: LocationRequest) => act(() => store().getState().setLocationRequest(request));
const field = () => screen.getByRole("textbox", { name: "Latitude, longitude" }) as HTMLInputElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

describe("Set location", () => {
  it("shows nothing until a location is asked for", () => {
    render(<LocationDialogHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts from the location it was asked with, and reads it back with its hemispheres", () => {
    render(<LocationDialogHost />);
    ask({ ids: ["b"], initial: { lat: 48.8584, lon: 2.2945 } });
    expect(screen.getByRole("dialog", { name: "Set location" })).toBeTruthy();
    expect(field().value).toBe("48.85840, 2.29450");
    expect(screen.getByText("48.85840° N, 2.29450° E")).toBeTruthy();
  });

  it("leaves a photo's own location alone until the field is edited", async () => {
    h.catalog.setState({ photos: [photo({ id: "g", exif: { gpsLatitude: 48.858370123, gpsLongitude: 2.294481, gpsAltitude: 35 } })] });
    render(<LocationDialogHost />);
    ask({ ids: ["g"], initial: { lat: 48.858370123, lon: 2.294481 }, current: true });
    const set = screen.getByRole("button", { name: "Set location" }) as HTMLButtonElement;
    expect(set.disabled).toBe(true);
    expect(screen.getByText("This is where the photo is now.")).toBeTruthy();
    fireEvent.submit(field().form!);
    await flush();
    expect(h.relocated).toEqual([]);
    type("48.8584, 2.2945");
    expect(set.disabled).toBe(false);
  });

  it("sets the typed location on every target, undoably, and closes", async () => {
    render(<LocationDialogHost />);
    ask({ ids: ["b", "c"], initial: null });
    type(`33°51'24"S 151°12'55"E`);
    fireEvent.click(screen.getByRole("button", { name: "Set location for 2 photos" }));
    await flush();
    expect(h.relocated).toHaveLength(1);
    for (const p of h.relocated[0]) {
      expect(p.exif.gpsLatitude).toBeCloseTo(-(33 + 51 / 60 + 24 / 3600), 9);
      expect(p.exif.gpsLongitude).toBeCloseTo(151 + 12 / 60 + 55 / 3600, 9);
    }
    expect(h.relocated[0].map((p) => p.id)).toEqual(["b", "c"]);
    expect(store().getState().undo.at(-1)?.label).toBe("Undo placing 2 photos");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store().getState().locationRequest).toBeNull();
  });

  it("submits with Enter", async () => {
    render(<LocationDialogHost />);
    ask({ ids: ["b"], initial: null });
    type("48.8584, 2.2945");
    fireEvent.submit(field().form!);
    await flush();
    expect(h.relocated[0][0].exif).toMatchObject({ gpsLatitude: 48.8584, gpsLongitude: 2.2945 });
  });

  it("will not set a location it cannot read, and says so", () => {
    render(<LocationDialogHost />);
    ask({ ids: ["b"], initial: null });
    expect((screen.getByRole("button", { name: "Set location" }) as HTMLButtonElement).disabled).toBe(true);
    type("Paris");
    expect(screen.getByText(/Not a location yet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Set location" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(field().form!);
    expect(h.relocated).toEqual([]);
  });

  it("says when no photos are selected", () => {
    render(<LocationDialogHost />);
    ask({ ids: [], initial: { lat: 1, lon: 2 } });
    expect(screen.getByText("No photos selected.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Set location" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes on Cancel and on Escape, writing nothing", () => {
    render(<LocationDialogHost />);
    ask({ ids: ["b"], initial: { lat: 1, lon: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    ask({ ids: ["b"], initial: { lat: 1, lon: 2 } });
    const reachedWindow = vi.fn();
    window.addEventListener("keydown", reachedWindow);
    try {
      fireEvent.keyDown(field(), { key: "Escape" });
    } finally {
      window.removeEventListener("keydown", reachedWindow);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reachedWindow).not.toHaveBeenCalled();
    expect(h.relocated).toEqual([]);
  });

  it("keeps the dialog open with the reason when the write fails", async () => {
    h.catalog.setState({
      relocatePhotos: async () => {
        throw new Error("The catalog is read-only.");
      },
    });
    render(<LocationDialogHost />);
    ask({ ids: ["b"], initial: { lat: 1, lon: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "Set location" }));
    await flush();
    expect(screen.getByText("The catalog is read-only.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(store().getState().undo).toEqual([]);
  });

  it("opens as a modal where the browser can, above every panel", () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
    try {
      render(<LocationDialogHost />);
      ask({ ids: ["b"], initial: null });
      expect(showModal).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("dialog")).toBeTruthy();
    } finally {
      delete (HTMLDialogElement.prototype as { showModal?: unknown }).showModal;
    }
  });

  it("drops the request when its host goes away, so it never reopens somewhere stale", () => {
    const { unmount } = render(<LocationDialogHost />);
    ask({ ids: ["b"], initial: null });
    unmount();
    expect(store().getState().locationRequest).toBeNull();
  });
});
