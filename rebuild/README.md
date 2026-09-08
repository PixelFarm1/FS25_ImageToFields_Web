# ImageToFields — rebuild

A standalone rewrite of the field pipeline that fixes island bridges running over
non-field area. Nothing in `web/` is touched, and `main` is unchanged — this
lives on the `rebuild/island-bridging` branch in its own directory, with its own
dependencies and its own dev server port.

## The problem this fixes

The original `stage5` attached every island straight to the outer ring, picking
the attachment by nearest **vertex pair** and never testing the segment. After
simplification the outer ring is sparse, so a whole cluster of islands resolved
to the same vertex — typically a concave notch tip, the vertex physically
closest to the interior — and the resulting fan of long bridges cut through the
islands in between.

Measured on `FS25_Finsta` (8192² mask, DEM 4096, 101 fields):

|                          | original | rebuild |
| ------------------------ | -------: | ------: |
| fields                   |      101 |     101 |
| islands                  |      113 |     110 |
| bridges crossing geometry |    **5** |   **0** |
| fields with bad bridges  |    2 (13, 27) |   0 |
| total bridge length      |   4060 wu | 3265 wu |
| bridges to a boundary    |      113 |      91 |
| island-to-island chains  |        0 |      19 |

Field 27's worst bridge went from 129.5 wu straight through island 3 to a
38.5 wu chained hop.

## How the fix works

1. **Candidate bridges are visibility-filtered.** For every pair of rings, the
   nearest connections are generated — vertex-to-vertex *and* vertex-to-edge
   projections — and any candidate that crosses a ring or leaves the field is
   discarded before it can be chosen. Landing part-way along an edge instead of
   snapping to a surviving vertex is what defuses the sparse-ring funnel.
2. **A minimum spanning tree picks the bridges.** Short island-to-island links
   beat long island-to-boundary ones, so nearby islands chain together and each
   cluster reaches the outer ring through exactly one bridge. No "close enough"
   threshold to tune.
3. **A depth-first walk emits one closed ring.** Both ends of every bridge are
   visited twice — once in, once out — so the slit stays zero-width and no
   sliver of non-field area is introduced. Islands are wound opposite the
   boundary so they subtract under a non-zero fill.

Also fixed along the way: island clearance (the old border reduction only shrank
the outer ring, leaving zero clearance around the obstacle machinery actually
hits), ring winding normalisation, loop structure no longer discarded and
re-guessed from a distance threshold, and a contour tracer that could spin until
it hit an iteration cap and emit a multi-million-point ring.

## Install

```bash
cd rebuild
npm install
```

## Command line

```bash
# run a mask
node cli.js mask.png --dem 4096 --out out/

# with border reduction / island clearance
node cli.js mask.png --dem 4096 --clearance 2 --simplify 0.3

# check any XML — from this tool or the original — for bridges over non-field area
node cli.js --audit path/to/final_field_coordinates.xml
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--dem <n>` | DEM size (1024 / 2048 / 4096 / 8192) | 2048 |
| `--simplify <f>` | RDP tolerance, capped per ring at 2% of its own size | 0.2 |
| `--clearance <f>` | border reduction *and* island clearance, world units | 0 |
| `--upp <n>` | world units per source pixel, for area reporting (whole numbers) | 1 |
| `--out <dir>` | output directory | `./out` |
| `--no-svg` | skip the debug SVG | |

Outputs `final_field_coordinates.xml` (import this into the Giants Editor),
`field_rings.xml`, `debug.svg`, and `report.json`.

The debug SVG draws the boundary, the islands and every bridge in distinct
colours, so a mask can be checked without opening the editor.

## Browser app

```bash
cd rebuild/app
npm install
npm run dev        # http://localhost:5180
```

Same pipeline — `app/` imports `core/` directly, so the browser and the CLI run
identical code with no branch between them. The canvas draws the ring structure
rather than the flattened polygon, so a bridge crossing an island is visible
immediately instead of surfacing in the editor.

**Reference overlay.** *Reference image* draws the uploaded mask underneath the
vectors, with a toggle and an opacity slider, so simplification can be judged
against the raster it came from. `toWorld` divides *both* axes by the same
`ratio = imageWidth / demSize`, so the mask spans exactly `demSize` world units
across but only `demSize × height / width` down — a square only for a square
mask. A 1024 mask and an 8192 mask therefore register identically at the same
DEM setting. Once a result is on screen the overlay uses the DEM size that
result was produced with, so moving the slider afterwards cannot slide it out of
register. Smoothing is off when magnified, so the pixel staircase stays visible
under the simplified outline.

**Selecting.** Clicking a field — on the canvas or in the list — marks it and
glides the camera to its extent. The centre is interpolated linearly and the
scale geometrically, because zoom is multiplicative: a linear ramp from 1x to
50x spends nearly all its time at the far end and reads as a lurch. Any pan or
wheel input cancels a running tween, and `prefers-reduced-motion` skips it. A
press that travels more than a few pixels counts as a pan, so dragging the map
no longer selects whatever happened to be under the cursor when the button came
up.

**Analytics.** Consent-gated Google Analytics, carried over from the main app
and sharing its consent key, so a visitor who already chose there is not asked
again. Nothing loads from googletagmanager.com until the visitor opts in.

## Tests

```bash
cd rebuild
npm test
```

These assert invariants rather than compare against golden files, so a change
that shifts coordinates but keeps the geometry sound passes, while one that
opens a sliver or routes a bridge over an island fails:

- the emitted ring closes
- emitted area equals boundary minus islands, exactly
- winding is normalised (boundary CCW, islands CW)
- no bridge crosses any ring, leaves the field, or passes through an island
- both ends of every bridge are visited twice
- every island is reachable from the boundary
- the output format round-trips back through `audit.js`

Plus per-fixture behaviour: the fan cluster chains to one boundary bridge, a
field nested inside an island is dropped, small islands survive an aggressive
tolerance, clearance splits a pinched dumbbell, and clearance grows islands as
well as pulling the boundary in.

## Layout

```
rebuild/
  core/            pure functions — no DOM, no React, no Node specifics
    geom.js        point/ring primitives, segment index
    raster.js      labelling, island ownership, centroids — one pass
    contours.js    Moore tracing -> { outer, islands }, structure kept
    offset.js      Clipper: clearance, merging, cleanup
    simplify.js    shape-preserving RDP with topology guards
    bridge.js      visibility -> MST -> DFS emit        <- the fix
    validate.js    crossings, closure, winding, duplicates
    xml.js
    pipeline.js
  cli.js           headless runner
  audit.js         crossing checker for any produced XML
  debugSvg.js
  fixtures/        synthetic masks (masks.js) + PNG generator
  test/
  app/             Vite + React shell
```

`core` takes `{ width, height, rgba }` and returns plain objects. The browser
worker fills that from `OffscreenCanvas`, the CLI from `pngjs`.

## Decisions taken

- **Zero-width bridges with duplicated entry/exit vertices** — the entry vertex
  and the island vertex each appear twice, so the chain stays intact and no
  sliver opens. Verified by test and by `validate.js` on every run.
- **Clipper** for polygon offset and boolean cleanup.
- **No node budget.** The simplifier is guarded instead: tolerance is capped
  relative to each ring's own size, results are rejected if they fall below a
  vertex floor, change area by more than 2%, self-intersect, or cross another
  ring in the same field — and a rejected ring is retried at half tolerance,
  then kept unsimplified rather than emitted broken. Bridging runs after
  simplification, so duplicated bridge vertices can never be removed by it.
- **A field inside an island is dropped**, with a warning. Inside a field loop
  there can only be non-field area.

## Known limitations

- If an island has no unobstructed straight route to anything — possible in a
  spiral field, or where an island hides directly behind another — the shortest
  blocked bridge is used and `validate.js` reports the crossing rather than
  letting it pass silently. The proper fix is a multi-segment corridor via a
  constrained Delaunay triangulation and a funnel shortest path. It has not been
  needed yet: this case does not occur on the `FS25_Finsta` mask or in any
  fixture, and the validator will say so if it ever does.
- Islands smaller than 3 pixels are dropped as noise, with a warning.
