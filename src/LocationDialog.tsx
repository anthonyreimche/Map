// Set location: coordinates typed or pasted for photos, with no map involved,
// which is how to geotag precisely on the basic map, offline, or straight from
// the Library. A request goes through the store, so the grid menu and the
// map's own menu open it alike; a host is mounted wherever a module shows it
// (the Library and Develop toolbars through slots, and the Map view).
//
// A native <dialog> opened with showModal sits in the browser's top layer,
// above every panel whatever stacking context its host is in; where showModal
// is missing it opens in place instead.

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { describeFix, formatCoordinates, parseCoordinates } from "./coords";
import { catalogDeps, place } from "./geotag";
import { React, ui } from "./rt";
import { store, useMapStore, type LocationRequest } from "./store";

export const DIALOG_CLASS = "safelight-map-location";
/** For the registered stylesheet: ::backdrop cannot be styled inline. */
export const DIALOG_CSS = `.${DIALOG_CLASS}::backdrop { background: rgba(0, 0, 0, 0.5); }`;

const TITLE_ID = "safelight-map-location-title";

const close = () => store().getState().setLocationRequest(null);

export function LocationDialogHost() {
  const request = useMapStore((s) => s.locationRequest);
  React.useEffect(() => {
    const s = store().getState();
    s.addDialogHost();
    return () => {
      s.removeDialogHost();
      // A request outlives a host that unmounts on a module switch; dropping
      // it here keeps it from reopening later in whichever host mounts next.
      close();
    };
  }, []);
  return request ? <LocationDialog request={request} /> : null;
}

function LocationDialog({ request }: { request: LocationRequest }) {
  const ref = React.useRef<HTMLDialogElement | null>(null);
  const prefill = React.useMemo(() => (request.initial ? formatCoordinates(request.initial) : ""), [request.initial]);
  const [text, setText] = React.useState(prefill);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fix = parseCoordinates(text);
  const count = request.ids.length;
  const unchanged = !!request.current && text === prefill;
  const { Button, TextInput, Field, Row } = ui;

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el.open) return;
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fix || count === 0 || unchanged || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await place(request.ids, fix, catalogDeps());
      close();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  // Core's shortcuts stand down for keys inside an open <dialog>; this keeps
  // Escape from every other listener on the way up.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const status =
    failure ??
    (count === 0
      ? "No photos selected."
      : unchanged
        ? "This is where the photo is now."
        : fix
          ? describeFix(fix)
          : text.trim()
            ? "Not a location yet: try 48.8584, 2.2945."
            : null);

  return (
    <dialog
      ref={ref}
      className={DIALOG_CLASS}
      aria-labelledby={TITLE_ID}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      style={{
        width: "min(94vw, 380px)",
        padding: 14,
        borderRadius: 8,
        border: `1px solid ${ui.tokens.border}`,
        background: ui.tokens.surface1,
        boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
        color: ui.tokens.textPrimary,
        fontSize: 11,
      }}
    >
      <form onSubmit={(e) => void submit(e)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div id={TITLE_ID} style={{ fontSize: 13, fontWeight: 600 }}>
          Set location
        </div>
        <Field label="Latitude, longitude" hint="Paste from any map: 48.8584, 2.2945 · 48°51′30″N 2°17′40″E · a Google Maps or OpenStreetMap link.">
          <TextInput
            value={text}
            onChange={(v) => {
              setText(v);
              setFailure(null);
            }}
            placeholder="48.8584, 2.2945"
            aria-label="Latitude, longitude"
            autoFocus
          />
        </Field>
        {status && (
          <span aria-live="polite" style={{ color: ui.tokens.textSecondary }}>
            {status}
          </span>
        )}
        <Row gap={6} justify="flex-end">
          <Button size="sm" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!fix || count === 0 || unchanged || busy}>
            {count > 1 ? `Set location for ${count} photos` : "Set location"}
          </Button>
        </Row>
      </form>
    </dialog>
  );
}
