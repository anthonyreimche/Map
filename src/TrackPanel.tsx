// Import a GPX track, set the camera-clock offset and the gap limit, preview
// how many photos would be placed, and apply. Targets are the current
// selection, else every untagged photo the strip shows; already-tagged photos
// are touched only behind the Overwrite toggle.

import type { ChangeEvent } from "react";
import { correlate, summarize, type Summary } from "./correlate";
import { FILTER_ID } from "./filter";
import { hasLocation } from "./geo";
import { applyPlacements, catalogDeps, trackLabel } from "./geotag";
import { parseGpx, type GpxParse } from "./gpx";
import { formatOffset, parseOffset } from "./offset";
import { readSavedOffset, usePrefs, writeSavedOffset } from "./prefs";
import { React, api, ui } from "./rt";
import { store, useMapStore } from "./store";

export interface TrackPanelProps {
  /** The picked file's text; injectable so tests skip File.text(). */
  readFile?: (file: File) => Promise<string>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function targetsText(selectedCount: number, untaggedCount: number): string {
  return selectedCount > 0
    ? `Targets: ${plural(selectedCount, "selected photo", "selected photos")}`
    : `Targets: ${plural(untaggedCount, "untagged photo", "untagged photos")} in view`;
}

export function previewText(s: Summary): string {
  const reasons = [
    s.noTime > 0 ? `${s.noTime} no capture time` : null,
    s.outside > 0 ? `${s.outside} outside the track` : null,
    s.gap > 0 ? `${s.gap} across a gap` : null,
  ].filter((r): r is string => r !== null);
  return `${s.matched} matched · ${s.unmatched} unmatched${reasons.length ? ` (${reasons.join(", ")})` : ""}`;
}

const span = (start: number, end: number) => `${new Date(start).toLocaleString()} – ${new Date(end).toLocaleTimeString()}`;

export function TrackPanel({ readFile = (f) => f.text() }: TrackPanelProps) {
  const prefs = usePrefs();
  const track = useMapStore((s) => s.track);
  const trackFile = useMapStore((s) => s.trackFile);
  const catalog = api.stores.useCatalogStore;
  const photos = catalog((s) => s.photos);
  const selectedIds = catalog((s) => s.selectedIds);
  const visible = api.catalog.useVisiblePhotos({ without: [FILTER_ID] });
  const [offsetText, setOffsetText] = React.useState(() => formatOffset(readSavedOffset(api.settings.get)));
  const [maxGap, setMaxGap] = React.useState(prefs.maxGapMinutes);
  const [overwrite, setOverwrite] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const { Button, Toggle, NumberInput, TextInput, Field, Section, Stack, Row } = ui;

  const offsetSeconds = parseOffset(offsetText);
  const untagged = React.useMemo(() => visible.filter((p) => !hasLocation(p)), [visible]);
  const selected = React.useMemo(() => photos.filter((p) => selectedIds.has(p.id)), [photos, selectedIds]);
  const targets = React.useMemo(() => {
    const base = selected.length > 0 ? selected : untagged;
    return overwrite ? base : base.filter((p) => !hasLocation(p));
  }, [selected, untagged, overwrite]);
  const matches = React.useMemo(
    () => (track && offsetSeconds !== null ? correlate(targets, track, { offsetMs: offsetSeconds * 1000, maxGapMs: maxGap * 60_000 }) : []),
    [track, targets, offsetSeconds, maxGap],
  );
  const summary = React.useMemo(() => summarize(matches), [matches]);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage(null);
    let r: GpxParse;
    try {
      const text = await readFile(file);
      r = parseGpx(text);
    } catch {
      setMessage(`Could not read ${file.name}.`);
      return;
    }
    if (!r.ok) {
      setMessage(r.reason === "invalid-xml" ? `${file.name} is not a GPX file.` : `No timed track points in ${file.name}.`);
      return;
    }
    store().getState().setTrack(r.track, file.name);
  };

  const apply = async () => {
    if (!track || offsetSeconds === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const placements = matches.flatMap((m) => (m.fix ? [{ id: m.id, fix: m.fix }] : []));
      const n = await applyPlacements(placements, trackLabel(placements.length), catalogDeps());
      writeSavedOffset(offsetSeconds);
      setMessage(`Tagged ${plural(n, "photo", "photos")}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={10} style={{ padding: 8, fontSize: 11 }}>
      <Section
        title="GPS track"
        right={
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            Import track…
          </Button>
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept=".gpx,application/gpx+xml"
          aria-label="Import track"
          style={{ display: "none" }}
          onChange={(e) => void onPick(e)}
        />
        {track ? (
          <Stack gap={6}>
            <span style={{ color: ui.tokens.textSecondary }}>
              {track.name ?? trackFile} · {plural(track.pointCount, "point", "points")} · {span(track.start, track.end)}
            </span>
            <Row gap={6}>
              <Button size="sm" onClick={() => store().getState().commands?.fitToTrack()}>
                Fit to track
              </Button>
              <Button size="sm" variant="ghost" onClick={() => store().getState().setTrack(null, null)}>
                Clear
              </Button>
            </Row>
          </Stack>
        ) : (
          <span style={{ color: ui.tokens.textMuted }}>No track loaded. Import a .gpx file recorded while you shot.</span>
        )}
      </Section>

      <Section title="Match by time">
        <Field
          label="Camera clock offset"
          hint="Added to each photo's capture time: the camera clock's error, plus the time-zone difference if the camera was set to another zone than this computer. A camera 5 minutes slow needs +0:05:00."
        >
          <TextInput value={offsetText} onChange={setOffsetText} placeholder="±h:mm:ss" aria-label="Camera clock offset" />
          {offsetSeconds === null && <span style={{ color: ui.tokens.textSecondary }}>Offset must be ±h:mm:ss.</span>}
        </Field>
        <Field label="Gap limit (minutes)" hint="Photos are not placed between two track points further apart than this.">
          <NumberInput value={maxGap} min={1} max={120} step={1} onChange={(v) => setMaxGap(Math.min(120, Math.max(1, Math.round(v) || 1)))} aria-label="Gap limit" />
        </Field>
        <Toggle checked={overwrite} onChange={setOverwrite} label="Overwrite existing locations" ariaLabel="Overwrite existing locations" />
        <span style={{ color: ui.tokens.textSecondary }}>{targetsText(selected.length, untagged.length)}</span>
        {track && offsetSeconds !== null && <span style={{ color: ui.tokens.textSecondary }}>{previewText(summary)}</span>}
        <Row gap={6}>
          <Button size="sm" variant="primary" disabled={!track || offsetSeconds === null || summary.matched === 0 || busy} onClick={() => void apply()}>
            Apply
          </Button>
        </Row>
        {message && <span style={{ color: ui.tokens.textSecondary }}>{message}</span>}
      </Section>
    </Stack>
  );
}
