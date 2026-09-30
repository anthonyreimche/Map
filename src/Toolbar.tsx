import { syncInViewFilter } from "./filter";
import { applyUndo, catalogDeps } from "./geotag";
import { React, ui } from "./rt";
import { store, useMapStore } from "./store";

const n = (v: number) => v.toLocaleString("en-US");

export function countsText(located: number, total: number, inView: number): string {
  return `${n(located)} of ${n(total)} ${total === 1 ? "photo has" : "photos have"} a location · ${n(inView)} in view`;
}

/** True in a Map pop-out window: its own `?detached=` query param is set to a
 *  non-empty value. Such a window can't reach the main window's Library grid,
 *  so the toggle that filters it to the map view has nothing to act on. */
export function isDetachedWindow(): boolean {
  return !!new URLSearchParams(window.location.search).get("detached");
}

/** Pop the newest undo entry and restore it. A failed write puts the entry
 *  back on the stack — it becomes the top again — so the user can retry;
 *  either way the error surfaces in the map notice. */
export async function undoLast(): Promise<void> {
  const entry = store().getState().popUndo();
  if (!entry) return;
  try {
    await applyUndo(entry, catalogDeps());
  } catch (e) {
    store().getState().pushUndo(entry);
    store().getState().setError(e instanceof Error ? e.message : String(e));
  }
}

export function Toolbar() {
  const filterToView = useMapStore((s) => s.filterToView);
  const undo = useMapStore((s) => s.undo);
  const located = useMapStore((s) => s.located);
  const total = useMapStore((s) => s.total);
  const inView = useMapStore((s) => s.inView);
  const top = undo[undo.length - 1];
  const { Button, Toggle, Row } = ui;

  const setFilter = (v: boolean) => {
    store().getState().setFilterToView(v);
    syncInViewFilter();
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "4px 8px",
        borderBottom: `1px solid ${ui.tokens.border}`,
        background: ui.tokens.surface1,
        fontSize: 11,
        color: ui.tokens.textSecondary,
      }}
    >
      <Row gap={6}>
        <Button size="sm" onClick={() => store().getState().commands?.fitToPhotos()} title="Zoom to every photo with a location">
          Fit to photos
        </Button>
        {!isDetachedWindow() && (
          <Toggle checked={filterToView} onChange={setFilter} label="Filter Library to map view" ariaLabel="Filter Library to map view" />
        )}
        <Button size="sm" disabled={!top} onClick={() => void undoLast()} title={top ? top.label : "Nothing to undo"}>
          {top ? top.label : "Undo"}
        </Button>
      </Row>
      <span style={{ marginLeft: "auto", color: ui.tokens.textMuted }}>{countsText(located, total, inView)}</span>
    </div>
  );
}
