// The "filter Library to map view" grid filter. A grid filter can't be
// unregistered, so it is registered once and re-registered (same id, fresh
// predicate) whenever the toggle changes, and on each bounds change while it
// is on; off = pass-through. It says which photo fields the predicate reads
// (`reads`), so the Library filters again for those alone, not for every
// rating or flag: none while it passes every photo.

import type { Bounds } from "./geo";
import { inBounds, locationOf } from "./geo";
import { api } from "./rt";
import type { CatalogPhoto } from "./safelight";
import { store } from "./store";

export const FILTER_ID = "map.in-view";

export function inViewPredicate(enabled: boolean, bounds: Bounds | null): (p: CatalogPhoto) => boolean {
  if (!enabled || !bounds) return () => true;
  return (p) => {
    const loc = locationOf(p);
    return loc !== null && inBounds(loc, bounds);
  };
}

export function syncInViewFilter(): void {
  const s = store().getState();
  api.registerGridFilter({
    id: FILTER_ID,
    test: inViewPredicate(s.filterToView, s.bounds),
    reads: s.filterToView && s.bounds ? ["exif"] : [],
    onClear: () => {
      store().getState().setFilterToView(false);
      syncInViewFilter();
    },
  });
}
