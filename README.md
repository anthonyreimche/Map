# Map for SafeLight

A [SafeLight](https://github.com/anthonyreimche/SafeLight) extension that adds a
**Map** module beside Library and Develop: your geotagged photos as thumbnail
pins on a basemap that follows the app theme, drag-to-geotag, a filter that
narrows the Library to what the map shows, and overlays that other extensions
draw on it.

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
- **Set location…** (the photo menu, and the map's right-click menu) takes
  coordinates typed or pasted from any map, with no map needed: `48.8584,
  2.2945`, `48°51′30″N 2°17′40″E`, degrees and decimal minutes, hemisphere
  letters before or after, or a Google Maps, Apple Maps, OpenStreetMap or
  `geo:` link. It is undoable like any other placement.
- **Overlays.** Other extensions can draw lines and points on the map, such as
  [GPS Track](https://github.com/anthonyreimche/GPS-Track), which imports a
  `.gpx` file and geotags photos by capture time. The new overlay is fitted
  when it appears, and **Overlays ▾** in the toolbar fits the map to any of
  them.
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
map.

Pins never wait for the basemap. Offline, or where that host is blocked or
slow, the pins, clusters and overlays draw at once over a blank basemap, and
after 15 seconds without tiles the map says so ("Map tiles unavailable —
offline?").

### The basic map

The full map needs WebGL. Where it can't start — no usable GPU driver, a
remote desktop or virtual machine without Direct3D 11, a GPU that Chromium has
blocked for a couple of minutes after a reset — the Map opens a basic map
drawn with Canvas 2D instead: the world's coastlines (Natural Earth, bundled,
no network) under a latitude/longitude grid, with the same pins, clusters,
selection ring, overlays, pan and zoom, drag-to-geotag and menus. It has no
streets; *Set location…* is the precise way to geotag there. A note at the top
left says the map is the basic one, with **Try full map** to try WebGL again.
If the GPU drops out while the full map is open, the map waits for it and
starts afresh once it is back; **Reload map** retries at any time.

## Drawing on the map

Map reads the shared variable `map.overlays` (core's `api.variables`, Safelight
3.0.1 or later). It is an object with one entry per extension, keyed by that
extension's id:

```ts
api.variables.register("map.overlays", { initial: {} }); // either side may register first
api.variables.update("map.overlays", (o) => ({
  ...o,
  "my-extension": { label: "Lisbon trip", geojson: { type: "FeatureCollection", features } },
}));
// and on clear / in deactivate():
api.variables.update("map.overlays", ({ "my-extension": _gone, ...rest }) => rest);
```

- Only `LineString`, `MultiLineString` and `Point` features are drawn, with coordinates as `[lon, lat]`.
- An entry without a string `label` or a FeatureCollection is skipped and logged.
- The `label` names the entry in the toolbar's **Overlays ▾** menu (an empty label shows the key).
- Use `update`, never `set`, so you never overwrite another extension's entry.
- Map fits the view to an entry when its key first appears or its label changes. Entries already there when Map starts are drawn but not fitted.

Map's Library filter, *Filter Library to map view*, is the grid filter
`map.in-view`. A tool that lists untagged photos should leave it out with
`api.catalog.useVisiblePhotos({ without: ["map.in-view"] })`, because that
filter hides every photo without a location.

Map's default layout puts GPS Track's panel (`gps-track.panel`) above Info in
the right rail. That id is only a placement hint for the default layout: Map
works the same without GPS Track installed, and a fresh layout then leaves the
panel out. Layouts saved with Map 1.x, which had its own GPS Track panel, show
GPS Track's panel in that spot once GPS Track is installed. A layout saved with
Map 2.0.0 before GPS Track was installed stays as it is; open the panel from
the View menu.

## Install

Install from the SafeLight **Extensions** window and restart when asked:
SafeLight only allows the declared network origin after a restart, and until
then the map shows pins over a blank basemap. Build from source with
`npm install --legacy-peer-deps && npm run build` (outputs `dist/index.js`).
Needs SafeLight 3.0.1 or later.

Loading this folder through Developer Tools ▸ Extensions works the same way:
SafeLight reads the declared origin from the folder when it starts, so restart
once after choosing the folder (the Dev tab says so) before tiles load.

## Tests

`npm run check` typechecks, builds and runs the vitest suite (jsdom): geo
maths, the `map.overlays` checks and fit-on-arrival, the palette and style
generators, preferences, geotag writes and undo, the pin rasteriser's
scheduling, coordinate parsing and the Set location dialog, the view, toolbar
and strip against a fake map port and a host stand-in, the
MapLibre port against a stand-in for MapLibre's `Map`, and the basic map
(projection, clustering, style expressions, input, drawing) against a
recording 2D context. MapLibre's own rendering is verified in the app.

## Maintenance notes

- `maplibre-gl` is pinned to 5.x on purpose: 5 inlines its worker as a
  `blob:` URL, which SafeLight's content-security policy allows. MapLibre 6
  loads the worker from a sibling file through `import.meta.url`, which is
  undefined in an installed plugin bundle; moving to 6 needs `setWorkerUrl`
  pointed at the plugin's own asset URL.
- The bundle must never import React or read `import.meta`;
  `test/bundle.test.ts` guards both.
- The photo layers are added on MapLibre's first `style.load`, not its `load`:
  `load` waits for every visible basemap tile. The cluster counts read a
  second copy of the photos (`photo-counts`) because a tile waits for all the
  glyphs its symbol layers need, and glyphs come from the tile host.
- The basic map (`canvas-port.ts`) draws our layers by reading their specs
  through `style-eval.ts`, which knows only the expressions `map-layers.ts`
  uses and throws on any other; its coverage test fails if a spec grows one.
- Set location is a native `<dialog>` (top layer, above every panel). Core's
  global shortcuts stand down for keys inside an open `<dialog>`
  (`inNativeDialog` in core's keybindings store); on a core without that,
  Escape in the dialog can also leave a Develop tool behind it.
- `src/land-110m.ts` is generated from Natural Earth's 1:110m land polygons
  (v5.1.2, public domain) by `node scripts/build-land.mjs
  ne_110m_land.geojson`; the script names the source file.
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
the map's corner, and the basic map's coastlines are Natural Earth's (public
domain), credited there.
