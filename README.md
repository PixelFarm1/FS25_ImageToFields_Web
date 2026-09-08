# FS25 Image to Fields

A free, browser-based tool that turns a field mask image into field coordinates for
Farming Simulator 25. No installation, no upload — everything runs in your browser.

**[Try it here → https://pixelfarm1.github.io/FS25_ImageToFields_Web/](https://pixelfarm1.github.io/FS25_ImageToFields_Web/)**

---

## What it does

Drop in a white-on-black field mask and the tool traces every field boundary, works out
which non-field areas are islands inside them, connects those islands into a single
importable polygon, and writes a ready-to-use XML. The download also includes
`coordinatesToFields.lua`, a Giants Editor script that reads the XML and places the field
polygons into your map, aligned to the terrain.

## What a correct field mask looks like

White areas are fields. Black is everything else.

- Fields must be solid white on a pure black background
- No stray white pixels outside field areas
- Neighbouring field borders need at least a 1-pixel gap, or they merge into one field
- Black areas fully enclosed by a field are treated as **islands** — trees, ponds, rocks —
  and are cut out of the field automatically
- A white area inside an island is not a field and is discarded, with a warning

## How to use it

1. Open the [web app](https://pixelfarm1.github.io/FS25_ImageToFields_Web/)
2. Drop your field mask PNG onto the drop zone
3. Set **DEM size** to your map's `DEM.png` resolution minus 1 — a 4097×4097 DEM means 4096
4. Adjust **Simplification** and **Clearance** if you want (see below)
5. Press **Run**, then **Download XML**
6. In the Giants Editor, run `coordinatesToFields.lua` and pick the XML

Hover any setting or result figure in the app for an explanation.

### Settings

| Setting | What it does |
| --- | --- |
| **DEM size** | Your DEM resolution minus 1. Sets the world scale, so a 1024 px and an 8192 px mask give the same coordinates. |
| **Simplification** | How aggressively boundary points are removed. Capped per ring at 2% of that ring's own size, so small islands keep their shape at settings that thin a large boundary. |
| **Clearance** | Pulls field boundaries inward *and* grows islands outward by the same amount, so machinery gets the same clearance around a tree island as at the field edge. |
| **Units per pixel** | How many world units one mask pixel covers. Affects the reported areas only, never the geometry. |
| **Reference image** | Draws your mask underneath the traced outlines so you can see exactly what simplification changed. |

## How islands are handled

A field with islands can't be expressed as a plain vertex list, so each island is stitched
into the outer boundary with a zero-width bridge — out to the island, around it, back along
the same line. The Giants Editor sees one closed polygon and the doubled-back slit reads as
a hole.

Choosing *where* those bridges go is the hard part. Bridges are picked in three steps:

1. **Visibility filtering.** Candidate bridges are generated between every pair of rings,
   and any that crosses a ring or leaves the field is discarded before it can be chosen.
2. **A minimum spanning tree.** Short island-to-island links beat long island-to-boundary
   ones, so nearby islands chain together and each cluster reaches the boundary through
   exactly one bridge.
3. **A depth-first walk** emits it all as a single closed ring, visiting both ends of every
   bridge twice so the slit stays zero-width and no sliver of non-field area is introduced.

Every result is then validated — bridges that cross geometry, unclosed rings, inconsistent
winding, area mismatches — and anything found is reported per field in the app.

## Command line

The same pipeline runs headlessly, which is useful for batching or for checking a mask
without opening the editor.

```bash
npm install
node cli.js mask.png --dem 4096 --out out/
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--dem <n>` | DEM size (1024 / 2048 / 4096 / 8192) | 2048 |
| `--simplify <f>` | Simplification tolerance | 0.7 |
| `--clearance <f>` | Border reduction and island clearance, world units | 0 |
| `--upp <n>` | World units per source pixel, for area reporting | 1 |
| `--out <dir>` | Output directory | `./out` |
| `--no-svg` | Skip the debug SVG | |

Outputs `final_field_coordinates.xml` (the one to import), `field_rings.xml`, a `debug.svg`
showing boundaries, islands and bridges in distinct colours, and a `report.json`.

To re-check an XML produced by any version of this tool for bridges running over non-field
area:

```bash
node cli.js --audit path/to/final_field_coordinates.xml
```

## Development

```bash
npm install          # pipeline + CLI
npm test             # geometry tests

cd web
npm install
npm run dev          # http://localhost:5180
```

`web/` is a Vite + React app that imports `core/` directly, so the browser and the CLI run
identical code with no branch between them. `core/` is free of DOM and Node specifics: it
takes `{ width, height, rgba }` and returns plain objects, filled from `OffscreenCanvas` in
the browser and from `pngjs` on the command line.

```
core/        pipeline — raster, contours, offset, simplify, bridge, validate, xml
cli.js       headless runner
audit.js     crossing checker for a produced XML
fixtures/    synthetic masks used by the tests
test/        geometry tests
web/         browser app
```

The tests assert invariants rather than compare against golden files, so a change that
shifts coordinates but keeps the geometry sound passes, while one that opens a sliver or
routes a bridge over an island fails: the ring closes, emitted area equals boundary minus
islands exactly, winding is normalised, no bridge crosses any ring or leaves the field,
both ends of every bridge are visited twice, and every island is reachable.

## Privacy

Everything runs in your browser — masks and generated XML are never uploaded, and there is
no backend. Optional Google Analytics loads only if you accept the consent banner; decline
and no cookies are set at all. The Inter typeface is self-hosted, so no request reaches
Google Fonts. See *Privacy* in the app header for the full notice.

## Credits

Created by **PixelFarm**. Licensed under the [MIT License](LICENSE).
