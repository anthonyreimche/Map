// A bottom-rail strip of the visible photos that have no location: the drag
// source for geotagging. Selection, the right-click menu and the culling keys
// are core's, so it behaves like the Library grid.

import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { writeDraggedIds } from "./dnd";
import { FILTER_ID } from "./filter";
import { hasLocation } from "./geo";
import { React, api, ui } from "./rt";

const PAD = 6;
const GAP = 4;
const MIN_CELL = 40;
const FALLBACK_HEIGHT = 112;
const OVERSCAN = 6;
const UNMEASURED_CELLS = 30;

/** The index range worth rendering for a viewport scrolled to `scroll`. */
export function visibleRange(scroll: number, viewport: number, cell: number, gap: number, count: number, overscan: number) {
  const stride = cell + gap;
  if (stride <= 0 || count <= 0 || viewport <= 0) return { start: 0, end: 0 };
  const start = Math.min(count, Math.max(0, Math.floor(scroll / stride) - overscan));
  const end = Math.min(count, Math.ceil((scroll + viewport) / stride) + overscan);
  return { start, end: Math.max(start, end) };
}

export function UntaggedStrip() {
  const visible = api.catalog.useVisiblePhotos({ without: [FILTER_ID] });
  const photos = React.useMemo(() => visible.filter((p) => !hasLocation(p)), [visible]);
  // The empty branch below renders a plain message div with no ref, so the
  // scroller these effects watch does not exist yet while `photos` is empty.
  // Keying on this flip (not `[]`) re-attaches them to the real scroller once
  // it mounts, instead of staying bound to a null ref from an empty first render.
  const empty = photos.length === 0;
  const catalog = api.stores.useCatalogStore;
  const selectedIds = catalog((s) => s.selectedIds);
  const activePhotoId = catalog((s) => s.activePhotoId);
  const { onContextMenu, overlays } = api.catalog.usePhotoActions();
  api.catalog.useCullingShortcuts({ sizeSteps: false });
  const { Thumbnail } = api.components;

  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [box, setBox] = React.useState({ width: 0, height: FALLBACK_HEIGHT });
  const [scroll, setScroll] = React.useState(0);

  React.useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight || FALLBACK_HEIGHT });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY || e.deltaX) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [empty]);

  const photosRef = React.useRef(photos);
  photosRef.current = photos;

  const onClick = React.useCallback(
    (id: string, e: ReactMouseEvent) => {
      const s = catalog.getState();
      if (e.shiftKey) s.selectRange(id, photosRef.current.map((p) => p.id));
      else if (e.ctrlKey || e.metaKey) s.toggleSelect(id);
      else s.select(id);
    },
    [catalog],
  );

  const onDragStart = React.useCallback(
    (id: string, e: ReactDragEvent) => {
      const sel = catalog.getState().selectedIds;
      writeDraggedIds(e.dataTransfer, sel.has(id) ? [...sel] : [id]);
    },
    [catalog],
  );

  const onRate = React.useCallback((id: string, rating: number) => void catalog.getState().setRating(id, rating), [catalog]);

  if (empty) {
    return (
      <div style={{ height: "100%", minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", color: ui.tokens.textMuted, fontSize: 11 }}>
        Every visible photo has a location.
      </div>
    );
  }

  const cell = Math.max(MIN_CELL, box.height - PAD * 2);
  const { start, end } =
    box.width > 0
      ? visibleRange(scroll, box.width, cell, GAP, photos.length, OVERSCAN)
      : { start: 0, end: Math.min(photos.length, UNMEASURED_CELLS) };
  const total = PAD * 2 + photos.length * cell + (photos.length - 1) * GAP;

  return (
    <div
      ref={scrollerRef}
      data-testid="untagged-strip"
      style={{ height: "100%", overflowX: "auto", overflowY: "hidden", position: "relative" }}
      onScroll={() => setScroll(scrollerRef.current?.scrollLeft ?? 0)}
    >
      <div style={{ position: "relative", width: total, height: "100%" }}>
        {photos.slice(start, end).map((p, i) => (
          <div key={p.id} style={{ position: "absolute", left: PAD + (start + i) * (cell + GAP), top: PAD }}>
            <Thumbnail
              photo={p}
              selected={selectedIds.has(p.id)}
              active={p.id === activePhotoId}
              size={cell}
              onClick={onClick}
              onContextMenu={onContextMenu}
              onRatingChange={onRate}
              onDragStart={onDragStart}
            />
          </div>
        ))}
      </div>
      {overlays}
    </div>
  );
}
