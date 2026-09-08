/**
 * Pole of inaccessibility — the point inside a polygon that is farthest from
 * any edge. This is where a field's label belongs.
 *
 * The centroid is the obvious choice and the wrong one: for a crescent, a
 * C-shape or a field wrapped around a lake it lands outside the field
 * altogether, or inside one of its islands. The pole is always strictly inside
 * and, being the centre of the largest inscribed circle, is the roomiest spot
 * available — so a label sitting there is least likely to collide with an edge.
 *
 * Branch-and-bound over a quadtree, after Vladimir Agafonkin's polylabel: cover
 * the bounding box in cells, and repeatedly split the most promising one. A
 * cell's *potential* is the distance at its centre plus its half-diagonal — the
 * best any point inside it could possibly do — so once that potential cannot
 * beat the best point found so far, the whole cell is discarded unopened.
 */
import { bbox, signedArea2 } from './geom.js'

/** Squared distance from (x, y) to segment ab. */
function distSqToSegment(x, y, a, b) {
  let px = a.x, py = a.y
  let dx = b.x - px, dy = b.y - py

  if (dx !== 0 || dy !== 0) {
    const t = ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy)
    if (t > 1) { px = b.x; py = b.y }
    else if (t > 0) { px += dx * t; py += dy * t }
  }
  dx = x - px; dy = y - py
  return dx * dx + dy * dy
}

/**
 * Distance from a point to the nearest ring edge, negative outside the field.
 *
 * Every ring is walked in one pass, toggling an even-odd crossing count. That
 * single test handles holes for free: inside an island the ray has crossed the
 * outer ring once and the island once, so the count is even and the point
 * correctly reads as outside.
 */
export function signedDistance(x, y, rings) {
  let inside = false
  let minSq = Infinity

  for (const ring of rings) {
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const a = ring[i], b = ring[j]
      if ((a.y > y) !== (b.y > y) &&
          x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside
      }
      const d = distSqToSegment(x, y, a, b)
      if (d < minSq) minSq = d
    }
  }
  if (minSq === Infinity) return 0
  return (inside ? 1 : -1) * Math.sqrt(minSq)
}

/** Min-heap keyed on `potential`, popping the most promising cell first. */
class CellQueue {
  constructor() { this.items = [] }
  get size() { return this.items.length }

  push(cell) {
    const a = this.items
    a.push(cell)
    let i = a.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (a[parent].potential >= a[i].potential) break
      const t = a[parent]; a[parent] = a[i]; a[i] = t
      i = parent
    }
  }

  pop() {
    const a = this.items
    const top = a[0]
    const last = a.pop()
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let best = i
        if (l < a.length && a[l].potential > a[best].potential) best = l
        if (r < a.length && a[r].potential > a[best].potential) best = r
        if (best === i) break
        const t = a[best]; a[best] = a[i]; a[i] = t
        i = best
      }
    }
    return top
  }
}

function makeCell(x, y, half, rings) {
  const distance = signedDistance(x, y, rings)
  return { x, y, half, distance, potential: distance + half * Math.SQRT2 }
}

/** Area-weighted centroid of a ring, as a starting guess. */
function centroidCell(ring, rings) {
  let area = 0, x = 0, y = 0
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[i], b = ring[j]
    const f = a.x * b.y - b.x * a.y
    x += (a.x + b.x) * f
    y += (a.y + b.y) * f
    area += f * 3
  }
  if (area === 0) return makeCell(ring[0].x, ring[0].y, 0, rings)
  return makeCell(x / area, y / area, 0, rings)
}

/**
 * @param {Point[][]} rings   [outer, ...islands]
 * @param {number} [precision] stop once the answer cannot improve by more than
 *                             this; defaults to 1% of the field's smaller side
 * @returns {{x: number, y: number, distance: number}}
 */
export function poleOfInaccessibility(rings, precision) {
  const outer = rings[0]
  if (!outer || outer.length < 3) {
    return { x: outer?.[0]?.x ?? 0, y: outer?.[0]?.y ?? 0, distance: 0 }
  }

  const b = bbox(outer)
  const width = b.maxX - b.minX
  const height = b.maxY - b.minY
  const cellSize = Math.min(width, height)
  if (cellSize === 0) {
    return { x: b.minX, y: b.minY, distance: 0 }
  }

  const tolerance = precision ?? cellSize / 100
  let half = cellSize / 2

  const queue = new CellQueue()
  for (let x = b.minX; x < b.maxX; x += cellSize) {
    for (let y = b.minY; y < b.maxY; y += cellSize) {
      queue.push(makeCell(x + half, y + half, half, rings))
    }
  }

  let best = centroidCell(outer, rings)
  const centre = makeCell(b.minX + width / 2, b.minY + height / 2, 0, rings)
  if (centre.distance > best.distance) best = centre

  // A ring with thousands of vertices makes each probe costly; the cap keeps a
  // pathological field from stalling the run, and by then the answer is good.
  let budget = 40000
  while (queue.size && budget-- > 0) {
    const cell = queue.pop()
    if (cell.distance > best.distance) best = cell
    if (cell.potential - best.distance <= tolerance) continue

    half = cell.half / 2
    queue.push(makeCell(cell.x - half, cell.y - half, half, rings))
    queue.push(makeCell(cell.x + half, cell.y - half, half, rings))
    queue.push(makeCell(cell.x - half, cell.y + half, half, rings))
    queue.push(makeCell(cell.x + half, cell.y + half, half, rings))
  }

  return { x: best.x, y: best.y, distance: best.distance }
}
