# FS25 Image to Fields — Web

Browser-based version of the FS25 Image to Fields tool. Converts a black-and-white field mask PNG into Giants Editor–compatible XML for Farming Simulator 25 maps. Runs entirely in the browser — no server required.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (bundled with Node.js)

## Install

```bash
cd web
npm install
```

## Development

Start the Vite dev server with hot reload:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Production build

```bash
npm run build
```

Output is written to `web/dist/`. Serve it with any static file host (GitHub Pages, Netlify, a local `npx serve dist`, etc.).

To preview the production build locally:

```bash
npm run preview
```

## Usage

1. **Drop a PNG** — drag your field mask PNG onto the drop zone, or click to browse. The image should be black-and-white: white pixels = fields, black pixels = background.
2. **Set DEM size** — choose the resolution of your DEM minus 1 (e.g. a 2049×2049 DEM → select **2048**).
3. **Adjust settings** (optional):
   - *Simplification strength* — Ramer-Douglas-Peucker tolerance. Higher values reduce polygon point count.
   - *Distance threshold* — maximum gap between consecutive points before a new loop is started.
   - *Border reduction* — inward shrink of the outer field boundary in world units.
4. **Run** — click the green Run button. Progress is shown in the log panel on the left.
5. **Visualise** — once processing finishes the canvas auto-opens. Pan with click-drag, zoom with the scroll wheel.
6. **Download** — click *Download .zip* to save all six intermediate output files.

## Output files (inside the .zip)

| File | Stage | Contents |
|------|-------|----------|
| `stage1_labels.png` | 1 | Colour-coded connected-component map |
| `stage2_fields.xml` | 2 | Raw world coordinates per field |
| `stage3_loops.xml` | 3 | Coordinates split into outer/inner loops |
| `stage4_simplified.xml` | 4 | Loops after RDP simplification + border reduction |
| `stage5_marked.xml` | 5 | Loops with merge-point markers |
| `stage6_final.xml` | 6 | Final flattened field definitions — import this into Giants Editor |
