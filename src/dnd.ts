// The Library's drag payload (LibraryGrid and the folder sidebar use the same
// type), so photos dragged from the grid or the Untagged strip drop alike.

export const DND_PHOTOS = "application/x-safelight-photos";

export function readDroppedIds(dt: DataTransfer): string[] {
  try {
    const v: unknown = JSON.parse(dt.getData(DND_PHOTOS) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeDraggedIds(dt: DataTransfer, ids: readonly string[]): void {
  dt.setData(DND_PHOTOS, JSON.stringify(ids));
  dt.effectAllowed = "copyMove";
}
