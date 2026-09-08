/**
 * Painted regions.
 *
 * The user draws dividing lines over the map — along roads, rivers, however
 * they already think about the place — and the areas between those lines become
 * regions that fields are numbered within.
 *
 * The lines are open strokes, not closed shapes, so there is no polygon to test
 * a field against. Instead the strokes are burned into a raster and the gaps
 * between them are flood filled: a connected run of unpainted cells is a region.
 * That is the same trick the pipeline already uses to find fields, and it gets
 * the awkward cases right for free — a line that forks, one that crosses
 * another twice, or several that enclose an area between them all.
 *
 * It also fails honestly. A stroke that stops short of the map edge leaves the
 * two sides connected, so they come out as one region — which is exactly what
 * the drawing looks like on screen, rather than what the user may have meant.
 * The grid covers the fields exactly, with no margin, so a stroke taken to the
 * edge does separate the sides; anything drawn beyond is clipped.
 */

/** Cells across the longer axis. 700 puts a cell at well under a field's width. */
const GRID = 700

/** Burned half-width, in cells. 1 gives a 3-cell line, thick enough not to leak. */
const STROKE_CELLS = 1

/** Bounding box of the fields' geometry, in world coordinates. */
export function fieldsExtent(fields) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const f of fields) {
    for (const p of f.outer ?? []) {
      const x = f.centerX + p.x, y = f.centerY + p.y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  return { minX, minY, maxX, maxY }
}

function stamp(blocked, W, H, cx, cy, radius) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    if (y < 0 || y >= H) continue
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || x >= W) continue
      blocked[y * W + x] = 1
    }
  }
}

/** Bresenham, stamping a small square at each step so the line cannot leak. */
function burnLine(blocked, W, H, x0, y0, x1, y1, radius) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy

  for (;;) {
    stamp(blocked, W, H, x0, y0, radius)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x0 += sx }
    if (e2 < dx) { err += dx; y0 += sy }
  }
}

/**
 * Burn the strokes into a grid over `extent` and flood fill what is left.
 *
 * @param {Array<Array<{x,y}>>} strokes  world-space polylines
 * @param {{minX,minY,maxX,maxY}} extent
 * @returns {{count, labelAt(x,y), centroid(label)}}
 */
export function buildRegions(strokes, extent, opts = {}) {
  const { minX, minY, maxX, maxY } = extent
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)
  const cell = Math.max(spanX, spanY) / (opts.gridSize ?? GRID)
  const W = Math.max(2, Math.ceil(spanX / cell))
  const H = Math.max(2, Math.ceil(spanY / cell))

  const col = x => Math.max(0, Math.min(W - 1, Math.floor((x - minX) / cell)))
  const row = y => Math.max(0, Math.min(H - 1, Math.floor((y - minY) / cell)))

  const blocked = new Uint8Array(W * H)
  const radius = opts.strokeCells ?? STROKE_CELLS
  for (const stroke of strokes ?? []) {
    if (!stroke?.length) continue
    if (stroke.length === 1) {
      stamp(blocked, W, H, col(stroke[0].x), row(stroke[0].y), radius)
      continue
    }
    for (let i = 1; i < stroke.length; i++) {
      burnLine(blocked, W, H,
        col(stroke[i - 1].x), row(stroke[i - 1].y),
        col(stroke[i].x), row(stroke[i].y), radius)
    }
  }

  // Flood fill the unpainted cells. An explicit stack rather than recursion:
  // a region can span the whole grid.
  const labels = new Int32Array(W * H)
  const sums = [null]
  let count = 0
  const stack = []

  for (let seed = 0; seed < W * H; seed++) {
    if (blocked[seed] || labels[seed]) continue
    count++
    sums.push({ x: 0, y: 0, n: 0 })
    labels[seed] = count
    stack.push(seed)

    while (stack.length) {
      const i = stack.pop()
      const x = i % W, y = (i / W) | 0
      const acc = sums[count]
      acc.x += minX + (x + 0.5) * cell
      acc.y += minY + (y + 0.5) * cell
      acc.n++

      if (x > 0 && !blocked[i - 1] && !labels[i - 1]) { labels[i - 1] = count; stack.push(i - 1) }
      if (x < W - 1 && !blocked[i + 1] && !labels[i + 1]) { labels[i + 1] = count; stack.push(i + 1) }
      if (y > 0 && !blocked[i - W] && !labels[i - W]) { labels[i - W] = count; stack.push(i - W) }
      if (y < H - 1 && !blocked[i + W] && !labels[i + W]) { labels[i + W] = count; stack.push(i + W) }
    }
  }

  const centroids = sums.map(s => (s ? { x: s.x / s.n, y: s.y / s.n } : null))

  return {
    count,
    /**
     * Region containing a world point. A point that lands on a burned stroke
     * has no region of its own, so the nearest labelled cell is used — the
     * alternative is dropping the field out of the numbering entirely.
     */
    labelAt(x, y) {
      const cx = col(x), cy = row(y)
      const here = labels[cy * W + cx]
      if (here) return here
      for (let r = 1; r <= Math.max(W, H); r++) {
        for (let dy = -r; dy <= r; dy++) {
          const yy = cy + dy
          if (yy < 0 || yy >= H) continue
          // Only the ring at radius r, not the filled square.
          const step = Math.abs(dy) === r ? 1 : 2 * r
          for (let dx = -r; dx <= r; dx += step) {
            const xx = cx + dx
            if (xx < 0 || xx >= W) continue
            const l = labels[yy * W + xx]
            if (l) return l
          }
        }
      }
      return 1
    },
    centroid(label) { return centroids[label] ?? { x: minX, y: minY } },
  }
}
