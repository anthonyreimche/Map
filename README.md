# Map for SafeLight

A [SafeLight](https://github.com/anthonyreimche/SafeLight) extension that adds a
**Map** module beside Library and Develop: your geotagged photos as thumbnail
pins on a basemap that follows the app theme, drag-to-geotag, GPX track
correlation, and a filter that narrows the Library to what the map shows.

<!-- Screenshot: add docs/map.png (the Map module in Safelight Neutral with clustered pins) and reference it here. -->

## What it does

- **Browse.** The photos the Library grid shows, minus those without a
  location, appear as pins; dense areas cluster into counts. Click selects
  (Shift/Ctrl extend), double-click opens Develop, right-click shows the
  Library's photo menu, clicking a cluster zooms into it. When the selection
  changes elsewhere, the map flies to the active photo (Preferences ▸ Map).
- **Geotag.** The **Untagged** strip at the bottom lists visible photos with
  no location. Drag one (or a selection) onto the map, or right-click the map
  for *Place selected photos here*. **Undo** in the toolbar reverses the last
  change for the session. The Library menu gains *Show on map* and *Remove
  location*.
- **GPX tracks.** **GPS Track ▸ Import track…** loads a `.gpx` file, draws it,
  and matches untagged photos (or the selection) by capture time. Set the
  camera clock offset (`±h:mm:ss`), the gap limit, preview the counts, then
  **Apply**. Already-tagged photos are only touched behind *Overwrite existing
  locations*.
- **Filter Library to map view** narrows the grid and the filmstrip to the
  photos inside the current map view. *Clear filters* in the Library turns it
  off. Library filters are per window: popped out (⧉) into its own window,
  the Map shows that window's photo set — the whole catalog, by default — and
  hides this toggle; it works when the Map is in the main window.
  Until Safelight syncs catalog edits between windows, geotag in the main
  window with nothing popped out: each window saves its own copy of the
  catalog, so a location placed in one window can be overwritten when another
  window later saves.

Locations are written to the catalog record (the same field Export's EXIF
embedding and the EXIF/XMP extensions read); original files are never
modified.

## The basemap

Vector tiles from [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data),
rendered by [MapLibre GL](https://maplibre.org). The style is generated from
the active theme's colours, so the map reads as neutral grey in Safelight
Neutral and dark in dark themes. Tile requests go to
`https://tiles.openfreemap.org` — the only network origin this extension
declares; the regions you look at are visible to that host, like any online
map. Without a connection the pins still work over a blank basemap.

## Install

Install from the SafeLight **Extensions** window and restart when asked:
SafeLight only allows the declared network origin after a restart, and until
then the map shows pins over a blank basemap. Build from source with
`npm install --legacy-peer-deps && npm run build` (outputs `dist/index.js`).
Needs SafeLight 2.6.0 or later.

Loading this folder through Developer Tools ▸ Extensions works the same way:
SafeLight reads the declared origin from the folder when it starts, so restart
once after choosing the folder (the Dev tab says so) before tiles load.

## Tests

`npm run check` typechecks, builds and runs the vitest suite (jsdom): geo
maths, GPX parsing, the correlation algorithm, the palette and style
generators, preferences, geotag writes and undo, the pin rasteriser's
scheduling, and the view, toolbar, strip and track panel against a fake map
port and a host stand-in. MapLibre itself is verified in the app.

## Maintenance notes

- `maplibre-gl` is pinned to 5.x on purpose: 5 inlines its worker as a
  `blob:` URL, which SafeLight's content-security policy allows. MapLibre 6
  loads the worker from a sibling file through `import.meta.url`, which is
  undefined in an installed plugin bundle; moving to 6 needs `setWorkerUrl`
  pointed at the plugin's own asset URL.
- The bundle must never import React or read `import.meta`;
  `test/bundle.test.ts` guards both.
- `npm audit` reports a critical advisory against `maplibre-gl`,
  [GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579) (an
  XSS sanitizer bypass in `DOM.sanitize()`), fixed only in 6.4.1 and later.
  This extension stays on 5.x for the worker reason above and never reaches
  the vulnerable code regardless: `DOM.sanitize()`'s only caller in 5.19 is
  MapLibre's own attribution control, which stays disabled
  (`attributionControl: false` in `maplibre-port.ts`) — the map's credit is
  rendered as plain React text instead (`MapView.tsx`).

## License

MIT. No code from darktable, digiKam or Lightroom is involved; MapLibre GL is
BSD-3, OpenFreeMap's tiles carry the OpenStreetMap ODbL attribution shown in
the map's corner.
