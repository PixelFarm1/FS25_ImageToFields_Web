# FS25 ImageToFields — Feature & Rebuild Reference

This document covers every feature of the Python/Tkinter desktop tool, describes the full processing pipeline with data shapes at each step, and lays out a concrete plan for reimplementing everything as a browser-based web application.

---

## 0. Confirmed Requirements (from design interview)

This section captures the agreed requirements for the web rebuild. Treat it as the source of truth before writing any code.

### Audience & deployment
- **Target users:** The public FS25 modding community — anyone can access it, no login required.
- **Hosting:** Not yet decided; build as a fully static site so it can be dropped onto GitHub Pages, Vercel, Netlify, or any static host with zero config changes.
- **Device target:** Desktop browsers only. No need for responsive/mobile layout or touch optimisation.

### Processing model
- **All processing runs in the browser** — no backend server, no file uploads to a remote service.
- Use a **Web Worker** so the UI stays responsive while the pipeline runs.
- The existing 6-stage pipeline is preserved exactly. No stages are merged, skipped, or reordered.

### Tech stack
- **Framework:** React (with Vite for bundling).
- **Styling:** Tailwind CSS, dark theme — colours and aesthetic should match the existing desktop app (dark background, FS25 green accents `#7cbb32` / `#659927`).
- **Image processing:** OpenCV.js (WASM) for Stages 1–2.
- **Polygon simplification:** simplify-js (RDP, matches Shapely's algorithm).
- **Polygon offset / shrink:** Clipper.js (matches Shapely's `buffer(-n)`).
- **XML serialisation:** Manual string builder or browser `XMLSerializer`.
- **Zip output:** JSZip (or fflate) for packaging the download.

### Feature scope — 1-to-1 parity only
Build exactly what the desktop app has, nothing more:

| Desktop feature | Web equivalent |
|---|---|
| PNG file picker | File input (click-to-browse) or drag-and-drop zone |
| DEM size dropdown (1024/2048/4096/8192, default 2048) | Same dropdown |
| Simplification Strength slider (0.0–1.0, step 0.1, default 0.2) | Range input with numeric display |
| Distance Threshold slider (0–20, step 1, default 10) | Range input with numeric display |
| Border Reduction slider (0–10, step 1, default 0) | Range input with numeric display |
| Tooltips on all four controls | HTML `title` attribute or small tooltip component |
| Run button (triggers pipeline in background) | Button → spawns Web Worker |
| Log panel (auto-scrolling, read-only) | `<textarea>` or `<pre>` with Worker progress messages |
| Visualise fields (matplotlib canvas with pan/zoom) | Canvas 2D API with mouse pan/zoom |
| Toggle Field IDs button | Same toggle on the canvas layer |

No new features (no live preview, no per-field editing, no before/after compare).

### Output
- On completion, the user gets a **single `.zip` download** containing all intermediate files plus the final output:
  - `processed_image.png`
  - `coordinates1.xml`
  - `field_loops.xml`
  - `simplified_field_loops.xml`
  - `field_coordinates_marked.xml`
  - `final_field_coordinates.xml`
- The zip is generated entirely in the browser (no server round-trip).

### Known constraints to preserve
- **254-field limit** is intentionally kept (8-bit red channel encoding). No need to work around it.
- Y-axis must be **flipped for display** in the canvas visualiser (same as the Python matplotlib view).
- Polygon coordinates are stored **relative to field centroid**; the visualiser reconstructs absolute positions by adding the field's `X`/`Y` centre offset.

### Out of scope
- No user accounts or saved sessions.
- No server-side processing.
- No mobile layout.
- No feature additions beyond what the desktop tool does today.

---

## 1. What the tool does (high-level)

The tool converts a **black-and-white field-mask PNG** (white = farmable area, black = background) into a Giants Editor–compatible `final_field_coordinates.xml`. That XML file is consumed by a Lua script (`xmlToFields.lua`) executed inside Giants Editor to stamp out FS25 field polygons on a map, align them to terrain, and repaint farmland.

---

## 2. User-facing features

### 2.1 File picker
- Single PNG file selector (`Browse` button → OS file dialog).
- Accepts any white-on-black field mask (8-bit grayscale or RGB, any resolution that matches the DEM).

### 2.2 DEM size selector
- Dropdown: `1024`, `2048`, `4096`, `8192` (default `2048`).
- Represents the **resolution of the map's DEM minus 1 pixel** (e.g. a 2049×2049 DEM → choose 2048).
- Used as the world-unit scale factor: `ratio = image_width / demSize`. All pixel coordinates are divided by this ratio to produce in-game meter coordinates.

### 2.3 Simplification Strength slider
- Range `0.0 – 1.0`, step `0.1`, default `0.2`.
- Controls the **Ramer-Douglas-Peucker (RDP) tolerance**. Higher = fewer polygon points, coarser shape. Lower = more points, more faithful outline.

### 2.4 Distance Threshold slider
- Range `0 – 20`, step `1`, default `10`.
- Determines the **maximum allowed gap** (in scaled units) between two consecutive contour points before they are considered to belong to separate loops (i.e., outer boundary vs. inner holes/islands).

### 2.5 Border Reduction slider
- Range `0 – 10`, step `1`, default `0`.
- Applies a **negative polygon buffer** (inward shrink) to the outer boundary of each field. Useful to add a small margin between the field edge and the actual map boundary.

### 2.6 Run button
- Executes the full 6-stage pipeline in a background thread. stdout/stderr are captured and shown in the log panel.

### 2.7 Visualize Fields button
- Reads `output/final_field_coordinates.xml` and renders all field outlines in a matplotlib canvas embedded in the GUI. Supports pan/zoom via the matplotlib navigation toolbar.

### 2.8 Toggle Field IDs button
- Shows/hides the floating field-ID labels on the visualization canvas.

### 2.9 Log panel
- Read-only text area. All `print()` calls during processing are redirected here so the user can follow progress.

---

## 3. Processing pipeline

The pipeline runs in strict sequence. Each stage consumes the output file of the previous stage and writes a new XML file to the `output/` folder.

```
input.png
    │
    ▼
[Stage 1] imageConverter         → output/processed_image.png
    │
    ▼
[Stage 2] imageToCoordinates     → output/coordinates1.xml
    │
    ▼
[Stage 3] processFieldLoops      → output/field_loops.xml
    │
    ▼
[Stage 4] simplifyFieldLoops     → output/simplified_field_loops.xml
    │
    ▼
[Stage 5] markFieldLoops         → output/field_coordinates_marked.xml
    │
    ▼
[Stage 6] finalizeFieldCoordinates → output/final_field_coordinates.xml
```

---

### Stage 1 — Image Converter (`imageConverter.py`)

**Purpose:** Separate each white region (field) into a uniquely labelled blob.

**Input:** Grayscale or RGB PNG — white pixels are fields, black is background.

**Algorithm:**
1. Load image as grayscale with OpenCV.
2. Binary threshold at 127 → strict black/white.
3. `cv2.findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)` — finds only outer contours, no holes at this stage.
4. Create a blank 3-channel (RGB) image of the same size.
5. For each contour `i`, fill the **red channel** of pixels inside that contour with value `i + 1`. The green and blue channels stay 0. This makes each field uniquely identifiable by its red-channel value (max 254 fields, since 0 = background).

**Output file:** `processed_image.png` — a colour-coded image where field `n` has red value `n`.

**Key constraint:** Maximum 254 distinct fields (red channel values 1–254). For larger maps with more fields a different encoding scheme would be needed in a web rebuild.

---

### Stage 2 — Image to Coordinates (`imageToCoordinates.py`)

**Purpose:** Convert each coloured blob into a list of world-space coordinates, centred on the field's centroid.

**Input:** `processed_image.png`, `demSize` integer.

**Algorithm:**
1. Load the colour image.
2. Extract the red channel. `unique_red_values` = all non-zero values (one per field).
3. For each unique red value:
   - Build a binary mask of that field's pixels.
   - `cv2.findContours(RETR_TREE, CHAIN_APPROX_NONE)` — finds ALL contours including holes (inner rings).
   - Convert every contour point from pixel space to world space:
     - `world_x = (pixel_x - image_width/2) / ratio`
     - `world_y = (pixel_y - image_height/2) / ratio`
     - (Y is not flipped at this stage — flip is only applied in the visualiser)
   - Calculate field centroid via `cv2.moments`.
   - Store coordinates **relative to centroid**: `rel_x = world_x - center_x`, `rel_y = world_y - center_y`.
   - Write a `<Field ID="{red_value}" X="{center_x}" Y="{center_y}">` element containing a flat list of `<coordinate X Y />` children.

**Output file:** `coordinates1.xml`

**XML shape:**
```xml
<?xml version='1.0' encoding='utf-8'?>
<Fields>
  <Field ID="1" X="128.50" Y="-64.25">
    <coordinate X="-12.3" Y="5.1" />
    <coordinate X="-12.1" Y="5.3" />
    <!-- ... hundreds of points ... -->
  </Field>
  <Field ID="2" X="-200.0" Y="300.0">
    <!-- ... -->
  </Field>
</Fields>
```

**Important note:** At this stage the flat coordinate list may contain both outer boundary points and inner hole points mixed together. The jump between loops shows up as a large distance between consecutive points, which Stage 3 detects.

---

### Stage 3 — Process Field Loops (`processFieldLoops.py`)

**Purpose:** Split the flat coordinate list into separate named loops (outer boundary = Loop 1, inner holes = Loop 2, 3, …).

**Input:** `coordinates1.xml`, `distanceThreshold` integer.

**Algorithm:**
1. Walk through the flat coordinate list. Whenever the Euclidean distance between point `i-1` and point `i` exceeds `distanceThreshold`, cut and start a new loop. Each loop is closed (first point appended at end).
2. Loop 0 of the list = base loop (outer boundary) → becomes `Loop ID="1"`.
3. For each additional loop, find the point in the base loop that is geometrically closest to any point of the other loop (`rearrange_loops`). Sort additional loops by that proximity so they are ordered nearest-to-farthest relative to the base loop.
4. Replace the flat `<coordinate>` list with named `<Loop ID="n">` elements, each containing their own coordinates.

**Output file:** `field_loops.xml`

**XML shape:**
```xml
<Field ID="1" X="128.50" Y="-64.25">
  <Loop ID="1">
    <coordinate X="-12.3" Y="5.1" />
    <!-- outer boundary points -->
  </Loop>
  <Loop ID="2">
    <coordinate X="2.0" Y="1.5" />
    <!-- inner hole / island points -->
  </Loop>
</Field>
```

---

### Stage 4 — Simplify Field Loops (`simplifyFieldLoops.py`)

**Purpose:** Reduce point count and optionally shrink the outer boundary.

**Input:** `field_loops.xml`, `simplificationStrength` float, `borderReduction` int.

**Algorithm:**
1. For every `<Loop>` in every field:
   - Build a Shapely `LineString` from the coordinates.
   - Call `line.simplify(tolerance, preserve_topology=True)` — this is the RDP algorithm.
2. For `Loop ID="1"` only, if `borderReduction > 0`:
   - Build a Shapely `Polygon` from the simplified coords.
   - Call `polygon.buffer(-borderReduction)` — negative buffer = inward shrink.
   - If result is a `MultiPolygon`, keep the largest piece.
3. Replace XML coordinates with the simplified/shrunk set.

**Output file:** `simplified_field_loops.xml` (same XML shape as Stage 3, fewer points).

---

### Stage 5 — Mark Field Loops (`markFieldLoops.py`)

**Purpose:** Annotate the outer loop with merge markers so inner loops can be stitched in cleanly.

**Input:** `simplified_field_loops.xml`

**Algorithm — per field:**
1. Load all loops. `Loop ID="1"` = main loop.
2. For each additional loop (`Loop ID="2"`, `"3"`, …):
   - Brute-force search: find the pair (main_loop_point, other_loop_point) that minimises Euclidean distance.
   - Mark the closest main-loop point with attribute `mergeID="{other_loop_id}"`.
   - Duplicate that marked coordinate and insert the duplicate immediately after it in Loop 1 (so the path can leave and return to the same point).
   - Reorder the inner loop to start at its closest point (the entry/exit point is first).
   - Append the first coordinate of the inner loop at its end to close it.

**Output file:** `field_coordinates_marked.xml`

**XML shape:**
```xml
<Field ID="1" X="128.50" Y="-64.25">
  <Loop ID="1">
    <coordinate X="-12.3" Y="5.1" />
    <coordinate X="-5.0" Y="2.0" mergeID="2" />
    <coordinate X="-5.0" Y="2.0" mergeID="2" />  <!-- duplicate -->
    <!-- remaining outer boundary -->
  </Loop>
  <Loop ID="2">
    <coordinate X="1.9" Y="1.6" />  <!-- starts at closest point -->
    <!-- ... -->
    <coordinate X="1.9" Y="1.6" />  <!-- closed -->
  </Loop>
</Field>
```

---

### Stage 6 — Finalize Field Coordinates (`finalizeFieldCoordinates.py`)

**Purpose:** Flatten everything back into a single ordered coordinate list per field by splicing inner loops into the outer boundary at the marked merge points.

**Input:** `field_coordinates_marked.xml`

**Algorithm — per field:**
1. Walk Loop 1's coordinates in order.
2. When a coordinate with `mergeID="n"` is encountered, immediately insert all coordinates from Loop `n` after it.
3. Continue walking Loop 1 — the duplicate marker coordinate acts as the return point, so the path goes: `... → merge_point → [entire inner loop] → merge_point → ...`
4. The result is one continuous polygon path that correctly traces the outer boundary and dips into each hole, creating a valid FS25 field polygon.

**Output file:** `final_field_coordinates.xml` — the only file the Lua script needs.

**XML shape (final):**
```xml
<?xml version='1.0' encoding='utf-8'?>
<Fields>
  <Field ID="1" X="128.50" Y="-64.25">
    <coordinate X="-12.3" Y="5.1" />
    <!-- outer boundary ... -->
    <coordinate X="-5.0" Y="2.0" mergeID="2" />
    <!-- inner loop 2 spliced in ... -->
    <coordinate X="-5.0" Y="2.0" mergeID="2" />
    <!-- outer boundary continues ... -->
  </Field>
</Fields>
```

---

## 4. Coordinate system

| Concept | Detail |
|---|---|
| Origin | Centre of the image / centre of the FS25 map |
| X axis | Left → Right (positive = east) |
| Y axis | In storage: image top = negative, bottom = positive. In visualisation: Y is flipped so it renders with north-up. |
| Unit | In-game metres (scaled by `image_width / demSize`) |
| Field centre | Stored as absolute world coords in `Field.X` and `Field.Y` |
| Polygon points | Stored **relative** to field centre — add `Field.X / Field.Y` to get absolute world position |

---

## 5. Output files summary

| File | Stage | Purpose |
|---|---|---|
| `processed_image.png` | 1 | Red-channel colour-coded field blobs |
| `coordinates1.xml` | 2 | Raw flat world coordinates per field |
| `field_loops.xml` | 3 | Coordinates split into named loops |
| `simplified_field_loops.xml` | 4 | Reduced & optionally shrunk loops |
| `field_coordinates_marked.xml` | 5 | Loops with merge annotations |
| `final_field_coordinates.xml` | 6 | **Final output** — consumed by the GE Lua script |

---

## 6. Parameters reference

| Parameter | Type | Default | Range | Effect |
|---|---|---|---|---|
| `demSize` | int | 2048 | 1024 / 2048 / 4096 / 8192 | Pixel-to-metre scale factor |
| `simplificationStrength` | float | 0.2 | 0.0 – 1.0 | RDP tolerance; higher = fewer points |
| `distanceThreshold` | int | 10 | 0 – 20 | Gap distance that separates loops |
| `borderReduction` | int | 0 | 0 – 10 | Inward shrink of outer boundary (metres) |

---

## 7. Web rebuild plan

### 7.1 Overall architecture

```
Browser (React / Vite)
│
├── UI layer        — file drop zone, sliders, log panel, canvas visualiser
├── Worker layer    — Web Worker running the processing pipeline (no UI blocking)
└── Output layer    — XML file download, canvas preview
```

All processing can run fully **client-side** using JavaScript/WebAssembly — no server needed for the core pipeline. OpenCV.js provides the image processing; a JS port of the coordinate math is straightforward.

### 7.2 Stage-by-stage web equivalents

**Stage 1 — Image Converter**
- Use `opencv.js` (`cv.threshold`, `cv.findContours`, `cv.drawContours`) — direct API parity with the Python code.
- Run inside a Web Worker to keep the UI responsive.
- Store the colour-coded pixel data in an `ImageData` / `OffscreenCanvas` buffer instead of writing a file.

**Stage 2 — Image to Coordinates**
- Pure math, no OpenCV dependency after Stage 1.
- Read red-channel values from the `ImageData` buffer.
- `cv.moments` available in OpenCV.js, or calculate manually from pixel sums.
- Emit a plain JavaScript object (array of fields with coordinate arrays) instead of XML. XML serialisation can be deferred until the final output step.

**Stage 3 — Process Field Loops**
- Pure JavaScript. Walk coordinate array, measure Euclidean distance, split at threshold. No external dependency needed.

**Stage 4 — Simplify Field Loops**
- Use the [simplify-js](https://mourner.github.io/simplify-js/) library (RDP, same algorithm as Shapely's `simplify`).
- For the polygon buffer / shrink: use [polygon-clipping](https://github.com/mfogel/polygon-clipping) or [Clipper.js](https://github.com/nicktindall/cyclopedia-clipper) (port of Angus Johnson's Clipper library, well-tested for polygon offsetting).

**Stage 5 — Mark Field Loops**
- Pure JavaScript, direct port of the Python logic.

**Stage 6 — Finalize Field Coordinates**
- Pure JavaScript. Walk and splice arrays.

**XML output**
- Build the XML string manually (or use the browser's `DOMParser` / `XMLSerializer`) and offer it as a `Blob` download.

### 7.3 Suggested tech stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | React + Vite | Fast dev, good ecosystem |
| Image processing | OpenCV.js (WASM) | Near-exact API match to Python code |
| RDP simplification | simplify-js | Tiny, well-tested, same algorithm |
| Polygon offset | Clipper.js | Reliable, handles edge cases |
| Visualisation | Canvas 2D API or React Canvas / Konva | Replace matplotlib; supports pan/zoom |
| Background processing | Web Worker | Keep UI responsive during heavy computation |
| Styling | Tailwind CSS | Rapid, utility-first |

### 7.4 UI components to build

1. **FileDropZone** — drag-and-drop or click-to-browse, accepts PNG only.
2. **DEMSizeSelect** — dropdown `[1024, 2048, 4096, 8192]`.
3. **SliderWithInput** — reusable: label, range slider, numeric input, tooltip. Used for all three parameter sliders.
4. **RunButton** — triggers the Worker; shows a spinner while processing.
5. **LogPanel** — auto-scrolling read-only text area; Worker posts progress messages.
6. **FieldCanvas** — renders final field outlines; supports pan/zoom (pointer events or a library like `react-zoom-pan-pinch`); toggleable field-ID labels.
7. **DownloadButton** — generates the XML blob and triggers browser download of `final_field_coordinates.xml`.

### 7.5 Web Worker message protocol

```
// Main → Worker
{ type: 'RUN', payload: { imageArrayBuffer, demSize, simplificationStrength, distanceThreshold, borderReduction } }

// Worker → Main (progress)
{ type: 'LOG', payload: { message: string } }

// Worker → Main (done)
{ type: 'DONE', payload: { xmlString: string, fields: Field[] } }

// Worker → Main (error)
{ type: 'ERROR', payload: { message: string } }
```

`Field[]` is the parsed structure used by the canvas renderer so it does not need to re-parse the XML.

### 7.6 Data structures (JavaScript)

```ts
interface Coordinate {
  x: number;
  y: number;
  mergeID?: string;  // present only in intermediate stages
}

interface Loop {
  id: number;
  coordinates: Coordinate[];
}

interface Field {
  id: number;
  centerX: number;
  centerY: number;
  // Stage 2: flat coordinates
  coordinates?: Coordinate[];
  // Stages 3–5: structured loops
  loops?: Loop[];
}

interface PipelineResult {
  fields: Field[];   // final flat-coordinate form
  xmlString: string; // serialised final_field_coordinates.xml content
}
```

### 7.7 Coordinate system notes for the web

- **Y-axis flip for display:** In the XML the Y axis follows image convention (increases downward). The canvas renderer must negate Y (or apply a CSS `scaleY(-1)` transform) to display the map north-up, matching the Python visualiser's behaviour.
- **Absolute vs. relative:** The canvas should reconstruct absolute world positions by adding `field.centerX / field.centerY` to each relative coordinate before drawing.
- **Viewport mapping:** Map world coordinates (`-demSize/2` to `+demSize/2`) to canvas pixel space via a simple linear transform. Store a `viewTransform` (translate + scale) updated by pan/zoom events.

### 7.8 File download format

The output XML must match exactly what the GE Lua script (`xmlToFields.lua`) expects:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Fields>
  <Field ID="1" X="128.5" Y="-64.25">
    <coordinate X="-12.3" Y="5.1" />
    ...
  </Field>
</Fields>
```

- `Field.ID` is a positive integer.
- `Field.X` and `Field.Y` are the absolute world-space centroid (floating-point).
- Each `<coordinate>` is relative to the centroid.
- Some `<coordinate>` elements may retain a `mergeID` attribute — this is harmless for the Lua consumer.

### 7.9 Known edge cases to handle in the web rebuild

| Edge case | Current Python behaviour | Web rebuild notes |
|---|---|---|
| >254 fields | Red-channel overflows silently | Use a 16-bit integer label map or a separate per-field mask approach |
| Polygon collapses after shrink | Returns original coordinates | Same guard needed in Clipper.js offset call |
| MultiPolygon after shrink | Takes largest polygon | Same logic needed |
| Invalid polygon geometry | `polygon.buffer(0)` fix | Clipper.js handles this differently — validate winding order |
| Very small isolated pixels | Become spurious single-point "fields" | Add a minimum area filter after Stage 1 |
| Field mask with RGB input | Reads as grayscale anyway (OpenCV) | Web version should convert to grayscale before thresholding |

---

## 8. Downstream integration (outside the tool)

The tool's output is intentionally decoupled from Giants Editor. The web rebuild needs no changes here — the Lua script side is unchanged.

1. Open Giants Editor with your FS25 map project.
2. Ensure a `Fields` transform group exists with the correct FS25 attributes (see GE documentation).
3. Remove any existing child objects from the Fields group.
4. Paste or drop `xmlToFields.lua` into GE's script folder.
5. Edit the hardcoded file path at the bottom of the Lua file to point to `final_field_coordinates.xml`.
6. Execute the script — it creates field polygons, aligns to terrain, and repaints farmland.
7. Run "Repaint Farmlands" in GE's Field Toolkit.

---

## 9. Dependency map (Python → web)

| Python library | Used in | Web equivalent |
|---|---|---|
| `opencv-python` | Stages 1, 2 | OpenCV.js (WASM) |
| `numpy` | Stage 1 | Typed arrays + manual loops |
| `shapely` | Stage 4 | simplify-js + Clipper.js |
| `xml.etree.ElementTree` | Stages 2–6 | String builder or DOMParser |
| `customtkinter` | GUI | React + Tailwind |
| `matplotlib` | Visualiser | Canvas 2D API |
| `threading` | Background execution | Web Worker |
