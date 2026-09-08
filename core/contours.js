/**
 * Stage 2 — boundary tracing.
 *
 * Unlike the original stage 2, this keeps the structure it discovers. Each
 * field comes out as { outer, islands } instead of one flat coordinate list
 * that a later stage has to re-split on a distance threshold.
 */

// Moore neighbourhood, clockwise from East.
const MDX = [1, 1, 0, -1, -1, -1, 0, 1]
const MDY = [0, 1, 1, 1, 0, -1, -1, -1]

function dirIndex(dx, dy) {
  for (let k = 0; k < 8; k++) if (MDX[k] === dx && MDY[k] === dy) return k
  return 0
}

/**
 * Moore boundary tracing over an arbitrary membership predicate, so callers can
 * trace straight out of a label array without materialising a per-region mask.
 *
 * The start pixel must be the topmost-leftmost of the region, which guarantees
 * its western neighbour is outside and gives a well-defined starting backtrack.
 * Termination uses the full (current, backtrack) state rather than "we reached
 * the start pixel again" — a pinched region can pass through its start pixel
 * mid-traversal, and the simpler test truncates the contour there.
 */
export function traceContour(inside, startX, startY, limit = 1 << 24) {
  const pts = [{ x: startX, y: startY }]
  let cx = startX, cy = startY
  let bx = startX - 1, by = startY

  // Jacob's stopping criterion, keyed on the first *real* transition rather
  // than on the starting state. The initial backtrack pixel is virtual — the
  // walk never actually enters the start pixel from there — so a contour that
  // re-enters its start from any other side would never match it, and the trace
  // would spin until it hit the iteration cap. That produced a garbage
  // multi-million-point ring on a real mask.
  let firstCx = 0, firstCy = 0, firstBx = 0, firstBy = 0, haveFirst = false
  let truncated = false

  for (let iter = 0; ; iter++) {
    if (iter >= limit) { truncated = true; break }

    const entry = dirIndex(bx - cx, by - cy)
    let nx = 0, ny = 0, nbx = 0, nby = 0, found = false
    for (let k = 1; k <= 8; k++) {
      const d = (entry + k) % 8
      const tx = cx + MDX[d], ty = cy + MDY[d]
      if (inside(tx, ty)) {
        const prev = (entry + k - 1) % 8
        nbx = cx + MDX[prev]; nby = cy + MDY[prev]
        nx = tx; ny = ty
        found = true
        break
      }
    }
    if (!found) break // isolated pixel

    if (!haveFirst) {
      firstCx = nx; firstCy = ny; firstBx = nbx; firstBy = nby
      haveFirst = true
    } else if (nx === firstCx && ny === firstCy && nbx === firstBx && nby === firstBy) {
      break // back to the first transition: the contour is closed
    }

    cx = nx; cy = ny; bx = nbx; by = nby
    pts.push({ x: cx, y: cy })
  }

  // The walk re-enters the start pixel before repeating the first transition,
  // so the start appears at both ends; rings are implicitly closed.
  if (pts.length > 1 &&
      pts[pts.length - 1].x === pts[0].x && pts[pts.length - 1].y === pts[0].y) {
    pts.pop()
  }

  pts.truncated = truncated
  return pts
}

/**
 * Extract every field's outer contour and island contours, in pixel space.
 *
 * @param {ReturnType<import('./raster.js').analyseRaster>} raster
 * @returns {Array<{id, label, centroidPx, outer: Point[], islands: Point[][]}>}
 */
export function extractContours(raster, log = () => {}) {
  const { width, height, fieldLabels, bgLabels, fields, islands } = raster
  log('Contours: tracing field boundaries...')

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height

  const warnings = []

  const out = fields.map(f => {
    const isField = (x, y) => inBounds(x, y) && fieldLabels[y * width + x] === f.label
    const outer = traceContour(isField, f.startX, f.startY)
    if (outer.truncated) {
      warnings.push(`Field ${f.id}: boundary trace hit the iteration limit.`)
    }

    const islandRings = []
    for (const islandId of f.islands) {
      const info = islands.get(islandId)
      const isIsland = (x, y) => inBounds(x, y) && bgLabels[y * width + x] === islandId
      const ring = traceContour(isIsland, info.startX, info.startY)
      if (ring.truncated) {
        warnings.push(
          `Field ${f.id}: island trace at pixel (${info.startX}, ${info.startY}) ` +
          `hit the iteration limit and was dropped.`)
        continue
      }
      islandRings.push(ring)
    }

    return {
      id: f.id,
      label: f.label,
      pixels: f.pixels,
      centroidPx: f.centroidPx,
      outer,
      islands: islandRings,
    }
  })

  const totalPts = out.reduce(
    (s, f) => s + f.outer.length + f.islands.reduce((t, r) => t + r.length, 0), 0)
  log(`Contours: ${out.length} field(s), ${totalPts} boundary points.`)
  for (const w of warnings) log(`  WARNING: ${w}`)
  out.warnings = warnings
  return out
}

/**
 * Convert pixel-space contours to world coordinates relative to each field's
 * centre, matching the coordinate convention the Giants importer expects.
 *
 * ratio = imageWidth / demSize  (world units per pixel = 1 / ratio)
 */
export function toWorld(contourFields, width, height, demSize) {
  const ratio = width / demSize
  const round = v => Math.round(v * 100) / 100

  // The half-pixel matters. A pixel index names that pixel's top-left corner —
  // pixel p covers [p, p+1) — but a traced contour vertex is the *centre* of a
  // boundary pixel, and a centroid averaged over pixel indices is likewise half
  // a pixel up-left of the true centre of mass. Dropping the 0.5 made the two
  // errors cancel along a field's top and left edges and add along its bottom
  // and right, leaving those a full pixel short of the mask and letting a field
  // overlap the bottom and right edge of its own islands.
  const toWorldX = px => (px + 0.5 - width / 2) / ratio
  const toWorldY = py => (py + 0.5 - height / 2) / ratio

  return contourFields.map(f => {
    const centerX = round(toWorldX(f.centroidPx.x))
    const centerY = round(toWorldY(f.centroidPx.y))
    const conv = pts => pts.map(p => ({
      x: round(toWorldX(p.x) - centerX),
      y: round(toWorldY(p.y) - centerY),
    }))
    return {
      id: f.id,
      centerX, centerY,
      outer: conv(f.outer),
      islands: f.islands.map(conv),
    }
  })
}
