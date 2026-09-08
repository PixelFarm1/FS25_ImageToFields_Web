/**
 * Shared 2D geometry primitives.
 *
 * A *ring* is an array of {x, y} points, implicitly closed (the last point is
 * NOT a repeat of the first). Rings are the only polygon representation used
 * inside the pipeline; the doubled-back "keyhole" form is produced once, at the
 * very end, by bridge.js.
 */

export const EPS = 1e-9

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function dist2(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  return dx * dx + dy * dy
}

/** Twice the signed area. Positive = counter-clockwise in a y-down system. */
export function signedArea2(ring) {
  let s = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n]
    s += a.x * b.y - b.x * a.y
  }
  return s
}

export function area(ring) {
  return Math.abs(signedArea2(ring)) / 2
}

/** Force a ring to the requested winding. Mutates nothing; may return the input. */
export function orient(ring, counterClockwise) {
  const ccw = signedArea2(ring) > 0
  return ccw === counterClockwise ? ring : ring.slice().reverse()
}

export function bbox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of ring) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function bboxDiagonal(ring) {
  const b = bbox(ring)
  return Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
}

/** Cross product of (a-o) x (b-o). */
export function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/**
 * True when segments p1p2 and p3p4 cross at an interior point of both.
 * Shared endpoints and collinear touching do NOT count — bridges are allowed
 * to land exactly on a ring vertex, which is the whole point of the format.
 */
export function properIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Ray-casting point-in-ring. Boundary cases are not defined; keep test points off edges. */
export function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a.y > pt.y) !== (b.y > pt.y) &&
        pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Closest point to `p` on segment ab, plus the parameter t along it. */
export function closestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < EPS) return { x: a.x, y: a.y, t: 0 }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + t * dx, y: a.y + t * dy, t }
}

/** Perpendicular distance from p to the infinite line through a and b. */
export function perpDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < EPS) return dist(p, a)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.sqrt(len2)
}

export function samePoint(a, b, eps = 1e-6) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
}

/** Drop consecutive duplicates, and the closing repeat if present. */
export function dedupeRing(ring, eps = 1e-6) {
  const out = []
  for (const p of ring) {
    if (out.length === 0 || !samePoint(out[out.length - 1], p, eps)) out.push(p)
  }
  while (out.length > 1 && samePoint(out[0], out[out.length - 1], eps)) out.pop()
  return out
}

/**
 * Uniform spatial grid over a set of segments, for broad-phase intersection
 * queries. Built once per field; queries are what make the visibility filter
 * affordable on rings with thousands of vertices.
 */
export class SegmentIndex {
  constructor(segments, targetCellsPerAxis = 64) {
    this.segments = segments
    if (segments.length === 0) {
      this.empty = true
      return
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const s of segments) {
      minX = Math.min(minX, s.a.x, s.b.x); maxX = Math.max(maxX, s.a.x, s.b.x)
      minY = Math.min(minY, s.a.y, s.b.y); maxY = Math.max(maxY, s.a.y, s.b.y)
    }
    const w = Math.max(maxX - minX, EPS), h = Math.max(maxY - minY, EPS)
    this.minX = minX; this.minY = minY
    this.cell = Math.max(w, h) / targetCellsPerAxis
    this.cols = Math.max(1, Math.ceil(w / this.cell) + 1)
    this.rows = Math.max(1, Math.ceil(h / this.cell) + 1)
    this.buckets = new Map()
    segments.forEach((s, i) => {
      for (const key of this._cellsForSegment(s.a, s.b)) {
        let arr = this.buckets.get(key)
        if (!arr) this.buckets.set(key, (arr = []))
        arr.push(i)
      }
    })
    this.empty = false
  }

  _cellCoords(p) {
    return [
      Math.max(0, Math.min(this.cols - 1, Math.floor((p.x - this.minX) / this.cell))),
      Math.max(0, Math.min(this.rows - 1, Math.floor((p.y - this.minY) / this.cell))),
    ]
  }

  /** Every cell the segment's bounding box touches — conservative, cheap, correct. */
  *_cellsForSegment(a, b) {
    const [ax, ay] = this._cellCoords(a)
    const [bx, by] = this._cellCoords(b)
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx)
    const y0 = Math.min(ay, by), y1 = Math.max(ay, by)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) yield y * this.cols + x
    }
  }

  /** Candidate segment indices that might intersect segment ab. */
  query(a, b) {
    if (this.empty) return []
    const seen = new Set()
    for (const key of this._cellsForSegment(a, b)) {
      const arr = this.buckets.get(key)
      if (arr) for (const i of arr) seen.add(i)
    }
    return seen
  }

  /**
   * True when ab properly crosses any indexed segment, skipping any segment
   * whose `ring` tag is in `ignoreRings` (used to let a bridge leave its own
   * ring's vertex without tripping on the two edges meeting there).
   */
  blocks(a, b, skipSegments = null) {
    for (const i of this.query(a, b)) {
      if (skipSegments && skipSegments.has(i)) continue
      const s = this.segments[i]
      if (properIntersect(a, b, s.a, s.b)) return true
    }
    return false
  }
}

/** Build the segment list for a set of rings, tagging each with its ring index. */
export function ringsToSegments(rings) {
  const segs = []
  rings.forEach((ring, ringIndex) => {
    for (let i = 0, n = ring.length; i < n; i++) {
      segs.push({ a: ring[i], b: ring[(i + 1) % n], ring: ringIndex, vi: i })
    }
  })
  return segs
}
