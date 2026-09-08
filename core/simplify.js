/**
 * Stage 4 — shape-preserving simplification.
 *
 * Three things separate this from running simplify-js over each loop:
 *
 *  1. Rings are simplified as rings. Feeding a closed ring to a polyline
 *     simplifier anchors whichever vertex happens to be at index 0 and lets the
 *     seam drift; here the ring is split at two extreme anchors, each half is
 *     reduced, and the halves are rejoined.
 *
 *  2. Tolerance is capped relative to each ring's own size. A 1.0 tolerance is
 *     mild on a 400 m field boundary and destroys an 8 m island; the cap means
 *     small islands keep their shape at slider settings that noticeably thin
 *     out a large boundary.
 *
 *  3. Every result is checked before it is accepted — vertex floor, area
 *     change, self-intersection, and no ring crossing another ring in the same
 *     field. A ring that fails is retried at half tolerance, and kept
 *     unsimplified rather than emitted broken.
 *
 * Simplification runs before bridging, so the duplicated entry/exit vertices
 * that keep the keyhole slit closed are created afterwards and can never be
 * removed here. validate.js asserts that separately.
 */
import {
  perpDistance, area, bboxDiagonal, properIntersect,
  SegmentIndex, ringsToSegments,
} from './geom.js'

export const DEFAULTS = {
  /** Never reduce a ring below this many vertices. */
  minVertices: 8,
  /** Tolerance may not exceed this fraction of a ring's bounding-box diagonal. */
  maxRelativeTolerance: 0.02,
  /** Reject a simplification that changes the ring's area by more than this. */
  maxAreaChange: 0.02,
  /** How many times to halve the tolerance before giving up and keeping the original. */
  retries: 4,
}

/** Iterative Ramer-Douglas-Peucker over an open polyline. */
function rdpOpen(pts, tolerance) {
  const n = pts.length
  if (n < 3) return pts.slice()

  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1

  const stack = [[0, n - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    if (last <= first + 1) continue

    let maxDist = -1, index = -1
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(pts[i], pts[first], pts[last])
      if (d > maxDist) { maxDist = d; index = i }
    }

    if (maxDist > tolerance) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }

  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i])
  return out
}

/** Index of the vertex farthest from `from`. */
function farthestFrom(ring, from) {
  let best = -1, bestD = -1
  for (let i = 0; i < ring.length; i++) {
    const dx = ring[i].x - from.x, dy = ring[i].y - from.y
    const d = dx * dx + dy * dy
    if (d > bestD) { bestD = d; best = i }
  }
  return best
}

/** RDP over a closed ring, anchored at two well-separated extreme vertices. */
function rdpClosed(ring, tolerance) {
  const n = ring.length
  if (n < 4) return ring.slice()

  // Leftmost vertex is guaranteed to sit on the convex hull, so it is a stable
  // anchor; its farthest partner splits the ring into two balanced halves.
  let a = 0
  for (let i = 1; i < n; i++) if (ring[i].x < ring[a].x) a = i
  const b = farthestFrom(ring, ring[a])
  if (a === b) return ring.slice()

  const firstHalf = []
  for (let i = a; ; i = (i + 1) % n) {
    firstHalf.push(ring[i])
    if (i === b) break
  }
  const secondHalf = []
  for (let i = b; ; i = (i + 1) % n) {
    secondHalf.push(ring[i])
    if (i === a) break
  }

  const s1 = rdpOpen(firstHalf, tolerance)
  const s2 = rdpOpen(secondHalf, tolerance)
  // Both halves carry the shared anchors; drop the repeats when rejoining.
  return [...s1.slice(0, -1), ...s2.slice(0, -1)]
}

/** True when any two non-adjacent edges of a ring properly cross. */
export function ringSelfIntersects(ring) {
  const n = ring.length
  if (n < 4) return false
  const index = new SegmentIndex(ringsToSegments([ring]))
  for (let i = 0; i < n; i++) {
    const a1 = ring[i], a2 = ring[(i + 1) % n]
    for (const j of index.query(a1, a2)) {
      if (j === i) continue
      if ((j + 1) % n === i || (i + 1) % n === j) continue // adjacent edges share a vertex
      const b1 = ring[j], b2 = ring[(j + 1) % n]
      if (properIntersect(a1, a2, b1, b2)) return true
    }
  }
  return false
}

/** True when any edge of `a` properly crosses any edge of `b`. */
export function ringsIntersect(a, b) {
  const index = new SegmentIndex(ringsToSegments([b]))
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length]
    for (const j of index.query(p, q)) {
      const s = index.segments[j]
      if (properIntersect(p, q, s.a, s.b)) return true
    }
  }
  return false
}

/**
 * Simplify one ring, backing off until the result passes every guard.
 * Returns the original ring when no tolerance produces an acceptable result.
 */
export function simplifyRing(ring, tolerance, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  if (tolerance <= 0 || ring.length <= o.minVertices) return ring

  const originalArea = area(ring)
  const cap = bboxDiagonal(ring) * o.maxRelativeTolerance
  let tol = Math.min(tolerance, cap)

  for (let attempt = 0; attempt <= o.retries; attempt++) {
    if (tol <= 0) break
    const candidate = rdpClosed(ring, tol)

    const bigEnough = candidate.length >= Math.min(o.minVertices, ring.length)
    const areaOk = originalArea === 0 ||
      Math.abs(area(candidate) - originalArea) / originalArea <= o.maxAreaChange
    if (bigEnough && areaOk && !ringSelfIntersects(candidate)) return candidate

    tol /= 2
  }
  return ring
}

/**
 * Simplify every ring of every field, then enforce that no ring in a field
 * crosses another. Offending islands are reverted to their unsimplified form.
 */
export function simplifyFields(fields, tolerance, opts = {}, log = () => {}) {
  log(`Simplify: tolerance=${tolerance} (capped per ring at ` +
      `${(DEFAULTS.maxRelativeTolerance * 100).toFixed(0)}% of its own size)...`)

  let before = 0, after = 0, reverted = 0

  const out = fields.map(f => {
    const originalRings = [f.outer, ...f.islands]
    before += originalRings.reduce((s, r) => s + r.length, 0)

    let rings = originalRings.map(r => simplifyRing(r, tolerance, opts))

    // Cross-ring topology guard: a simplified island must not cross the
    // simplified boundary or another island. Revert whichever ring is at fault.
    for (let i = 1; i < rings.length; i++) {
      let bad = ringsIntersect(rings[i], rings[0])
      if (!bad) {
        for (let j = 1; j < rings.length && !bad; j++) {
          if (j !== i) bad = ringsIntersect(rings[i], rings[j])
        }
      }
      if (bad) {
        rings[i] = originalRings[i]
        reverted++
        log(`  Field ${f.id}: island ${i} kept unsimplified (would have crossed another ring).`)
      }
    }

    after += rings.reduce((s, r) => s + r.length, 0)
    return { ...f, outer: rings[0], islands: rings.slice(1) }
  })

  const pct = before > 0 ? (((before - after) / before) * 100).toFixed(1) : '0.0'
  log(`Simplify: ${before} -> ${after} points (${pct}% removed` +
      (reverted ? `, ${reverted} ring(s) reverted to protect topology` : '') + ').')
  return out
}
