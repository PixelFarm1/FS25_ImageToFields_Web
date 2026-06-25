# FS25 Image to Fields

A free, browser-based tool for converting a field mask image into field coordinates for Farming Simulator 25. No installation required — runs entirely in your browser.

**[Try it here → https://pixelfarm1.github.io/FS25_ImageToFields_Web/](https://pixelfarm1.github.io/FS25_ImageToFields_Web/)**

---

<img width="2503" height="1299" alt="image" src="https://github.com/user-attachments/assets/fb616bdc-41d5-45b1-a226-037999d94d61" />


---

## What it does

Upload a white-on-black field mask image and the tool traces every field boundary, processes the coordinates through a multi-stage pipeline, and produces a ready-to-use XML file. Download everything as a `.zip` that also includes `coordinatesToFields.lua` — a Giants Editor script that reads the XML and places field polygons directly into your map, aligned to the terrain.

## What a correct field mask looks like

![Field mask example](https://github.com/user-attachments/assets/072c551c-b220-487e-8f28-8bebe1ef1e2a)

White areas = fields. Black areas = everything else. Each field must be a distinct, clean white region with no stray pixels and enough separation between neighbouring boundaries for the tool to distinguish them.

---

## How to use

### 1 — Prepare your field mask

- All fields must be solid white on a pure black background
- No stray white pixels outside field areas, no black holes inside them
- Neighbouring field borders must have at least a 1-pixel gap between them (imagine driving a 1×1 pixel tractor along every border — if it can't pass, widen that gap)

### 2 — Run the tool

1. Open the [web app](https://pixelfarm1.github.io/FS25_ImageToFields_Web/) in your browser
2. Drop your field mask PNG onto the drop zone (or click to browse)
3. Set the **DEM size** to match your map — this is the resolution of `DEM.png` minus 1 (e.g. a 2049×2049 DEM → choose **2048**)
4. Set **m / pixel** to match your map scale (default is 2 m/pixel, correct for a standard 2km FS25 map with a 1024px mask)
5. Choose your preferred area unit — **Hectares** or **Acres**
6. Leave the processing settings at their defaults for the first run, then adjust if needed:
   - **Simplification strength** — reduces polygon point count; higher = smoother but less accurate
   - **Distance threshold** — controls how gaps between points split a field into separate loops
7. Press **Run** and watch the log panel

### 3 — Inspect the result

The canvas shows all detected fields with their ID, node count, and area. Pan with click-drag, zoom with the scroll wheel. Press **Toggle field IDs** to hide/show the labels.

### 4 — Download and import into Giants Editor

1. Press **Download .zip** — it contains all intermediate XML files plus `coordinatesToFields.lua`
2. Open your map in Giants Editor
3. Make sure you have a `Fields` transform group with the correct attributes, and remove any existing children from it
4. Drop `coordinatesToFields.lua` into your GE scripts folder (or load it as a script)
5. At the bottom of the script, add the path to your `final_field_coordinates.xml` and save. Then run the script...
6. The script creates all field polygons, aligns them to the terrain, and repaints the cultivated ground

---

## Suggested workflow for FS22 map conversions

*Prerequisites: a FS22 map where fields are painted with terrainDetail (the densityMap_ground.gdm)*

1. Convert `densityMap_ground.gdm` using the converter at GDN
2. Open the converted file in GIMP and add a new layer with white fill
3. If the image turns all red instead of white: **Image → Mode → RGB**, then recreate the white layer
4. Set the white layer blending mode to **Dodge** and merge the two layers
5. Use **Select by Color** (Shift+O) and click one of the bright red field areas to see the selection
6. Check carefully for stray pixels or gaps — they are easiest to spot in select mode
7. When the mask looks clean, create a new layer with white fill
8. Set the blending mode to **HSV Saturation** — field areas will turn white
9. Merge the layers and repeat step 6 to do a final check
10. Export the result with these settings:

![Export settings](https://github.com/user-attachments/assets/b032a1dc-792b-4017-9600-4cf197ea9113)

11. Run the web tool as described above

---

## License

See [LICENSE](LICENSE).
