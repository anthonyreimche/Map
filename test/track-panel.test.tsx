import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initRuntime } from "../src/rt";
import { initStore, store } from "../src/store";
import { TrackPanel, previewText, targetsText } from "../src/TrackPanel";
import { createHarness, flush, located, photo, type Harness } from "./harness";

const T0 = Date.UTC(2024, 5, 1, 10, 0, 0);
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const local = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const GPX = `<gpx version="1.1"><trk><name>Walk</name><trkseg>
  <trkpt lat="48.0" lon="2.0"><time>${iso(T0)}</time></trkpt>
  <trkpt lat="48.1" lon="2.1"><time>${iso(T0 + 10 * MIN)}</time></trkpt>
  <trkpt lat="48.2" lon="2.2"><time>${iso(T0 + 20 * MIN)}</time></trkpt>
</trkseg></trk></gpx>`;

let h: Harness;
beforeEach(() => {
  h = createHarness({
    photos: [
      photo({ id: "in", exif: { dateTimeOriginal: local(T0 + 5 * MIN) } }),
      photo({ id: "none" }),
      located("tagged", 9, 9, local(T0 + 15 * MIN)),
    ],
  });
  initRuntime(h.api);
  initStore();
});

afterEach(() => cleanup());

async function importTrack() {
  render(<TrackPanel readFile={async () => GPX} />);
  const input = screen.getByLabelText("Import track") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "walk.gpx")] } });
  await flush();
}

describe("TrackPanel", () => {
  it("imports a GPX file and describes it", async () => {
    await importTrack();
    expect(store().getState().trackFile).toBe("walk.gpx");
    expect(screen.getByText(/Walk · 3 points/)).toBeTruthy();
  });

  it("previews the matches for the untagged visible photos", async () => {
    await importTrack();
    expect(screen.getByText(targetsText(0, 2))).toBeTruthy();
    expect(screen.getByText(previewText({ matched: 1, unmatched: 1, noTime: 1, outside: 0, gap: 0 }))).toBeTruthy();
  });

  it("targets the selection instead when there is one, and gates already-tagged photos", async () => {
    await importTrack();
    act(() => h.catalog.setState({ selectedIds: new Set(["in", "tagged"]) }));
    expect(screen.getByText(targetsText(2, 2))).toBeTruthy();
    expect(screen.getByText(previewText({ matched: 1, unmatched: 0, noTime: 0, outside: 0, gap: 0 }))).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Overwrite existing locations"));
    expect(screen.getByText(previewText({ matched: 2, unmatched: 0, noTime: 0, outside: 0, gap: 0 }))).toBeTruthy();
  });

  it("applies the offset and writes the matches as one undoable batch", async () => {
    await importTrack();
    fireEvent.change(screen.getByLabelText("Camera clock offset"), { target: { value: "-0:05:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await flush();
    expect(h.relocated[0].map((p) => [p.id, p.exif.gpsLatitude])).toEqual([["in", 48]]);
    expect(store().getState().undo[0].label).toBe("Undo tagging 1 photo from the track");
    expect(h.values.get("lastOffsetSeconds")).toBe(-300);
  });

  it("rejects a malformed offset and a malformed file", async () => {
    await importTrack();
    fireEvent.change(screen.getByLabelText("Camera clock offset"), { target: { value: "abc" } });
    expect(screen.getByText("Offset must be ±h:mm:ss.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports a file with no timed points", async () => {
    render(<TrackPanel readFile={async () => "<gpx></gpx>"} />);
    fireEvent.change(screen.getByLabelText("Import track"), { target: { files: [new File(["x"], "empty.gpx")] } });
    await flush();
    expect(screen.getByText("No timed track points in empty.gpx.")).toBeTruthy();
    expect(store().getState().track).toBeNull();
  });

  it("shows the read failure inline instead of an unhandled rejection", async () => {
    render(
      <TrackPanel
        readFile={async () => {
          throw new Error("disk error");
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Import track"), { target: { files: [new File(["x"], "walk.gpx")] } });
    await flush();
    expect(screen.getByText("Could not read walk.gpx.")).toBeTruthy();
    expect(store().getState().track).toBeNull();
  });

  it("fits to the track and clears it", async () => {
    const fitToTrack = vi.fn();
    store().getState().setCommands({ fitToPhotos: vi.fn(), fitToTrack, focus: vi.fn() });
    await importTrack();
    fireEvent.click(screen.getByRole("button", { name: "Fit to track" }));
    expect(fitToTrack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(store().getState().track).toBeNull();
  });
});

describe("text", () => {
  it("names the targets", () => {
    expect(targetsText(0, 3)).toBe("Targets: 3 untagged photos in view");
    expect(targetsText(0, 1)).toBe("Targets: 1 untagged photo in view");
    expect(targetsText(2, 3)).toBe("Targets: 2 selected photos");
  });

  it("summarises a preview with only the reasons that occur", () => {
    expect(previewText({ matched: 3, unmatched: 0, noTime: 0, outside: 0, gap: 0 })).toBe("3 matched · 0 unmatched");
    expect(previewText({ matched: 1, unmatched: 3, noTime: 1, outside: 0, gap: 2 })).toBe(
      "1 matched · 3 unmatched (1 no capture time, 2 across a gap)",
    );
  });
});
