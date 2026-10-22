// Deliveries of map.overlays: check each entry, store what can be drawn, and
// fit the view to an entry that is new or relabelled since the last delivery
// (a second GPX import replaces the entry under the same key). Entries already
// there when Map activates are drawn but not fitted.

import { checkOverlay, type ValidOverlay } from "./overlays";
import type { VariableSnapshot } from "./safelight";
import { store } from "./store";

/** Problems named in one log line. Any extension can write any entry, so a
 *  hostile one with a million bad features must not make a million-item line. */
const MAX_LOGGED_PROBLEMS = 5;

let known: Map<string, string> | null = null;
const reported = new Set<string>();

/** Start over: the next delivery is treated as the one at activation. */
export function resetOverlays(): void {
  known = null;
  reported.clear();
}

function describeProblems(problems: readonly string[]): string {
  const shown = problems.slice(0, MAX_LOGGED_PROBLEMS).join("; ");
  const more = problems.length - MAX_LOGGED_PROBLEMS;
  return more > 0 ? `${shown}; … and ${more} more` : shown;
}

/** `mapCanMountHere` says whether a Map view can still mount in this window; a
 *  fit kept in a window that never mounts one would replay stale when the Map
 *  is later re-attached there. */
export function receiveOverlays(snapshot: VariableSnapshot<unknown>, mapCanMountHere: () => boolean = () => true): void {
  const value = typeof snapshot.value === "object" && snapshot.value !== null && !Array.isArray(snapshot.value) ? snapshot.value : {};
  const valid: ValidOverlay[] = [];
  const bad = new Set<string>();
  for (const [key, entry] of Object.entries(value)) {
    const { overlay, problems } = checkOverlay(key, entry);
    if (problems.length > 0) {
      bad.add(key);
      // Once per key while it stays bad: every other extension's write
      // redelivers the whole variable.
      if (!reported.has(key)) {
        reported.add(key);
        console.warn(`[map] overlay ${JSON.stringify(key)} ${overlay ? "partly drawn" : "ignored"}: ${describeProblems(problems)}`);
      }
    }
    if (overlay) valid.push(overlay);
  }
  for (const key of [...reported]) if (!bad.has(key)) reported.delete(key);

  let fit: string | null = null;
  if (known) for (const o of valid) if (known.get(o.key) !== o.label) fit = o.key;
  known = new Map(valid.map((o) => [o.key, o.label] as const));

  const s = store().getState();
  s.setOverlays(valid);
  if (fit === null) return;
  if (s.commands) s.commands.fitToOverlay(fit);
  else if (mapCanMountHere()) s.setPendingFit(fit);
}
