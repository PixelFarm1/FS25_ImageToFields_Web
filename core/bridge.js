/**
 * Stage 5 — island bridging.  This is the fix.
 *
 * The old stage 5 attached every island straight to the outer ring, choosing
 * the attachment by nearest *vertex pair* and never testing the segment. After
 * simplification the outer ring is sparse, so a whole cluster of islands
 * resolved to the same vertex — usually a concave notch tip, the vertex
 * physically closest to the interior — and the resulting fan of long bridges
 * cut straight through the other islands.
 *
 * Replaced by three steps:
 *
 *   1. Candidate bridges between every pair of rings, filtered by visibility:
 *      a candidate that crosses any ring, or whose interior leaves the field,
 *      is discarded before it can ever be chosen.
 *   2. A minimum spanning tree over the rings. Short island-to-island links win
 *      over long island-to-boundary ones, so nearby islands chain together and
 *      each cluster reaches the outer ring through exactly one bridge.
 *   3. A depth-first walk that emits the tree as a single closed ring, with
 *      duplicated vertices at both ends of every bridge so the slit stays
 *      closed and no sliver of non-field area is introduced.
 */
import {
  dist, signedArea2, orient, properIntersect, pointInRing,
  closestOnSegment, SegmentIndex, ringsToSegments,
} from './geom.js'

/** How many nearest pairs to consider per ring pair before giving up. */
const CANDIDATES_PER_PAIR = 12
/** Above this many point-pairs, scan coarsely first and refine locally. */
const FULL_SCAN_BUDGET = 2_000_000

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

/** Keep the k smallest-distance pairs seen, without sorting the whole product. */
class TopK {
  constructor(k) { this.k = k; this.items = [] }
  offer(item) {
    if (this.items.length < this.k) {
      this.items.push(item)
      if (this.items.length === this.k) this.items.sort((a, b) => a.d - b.d)
      return
    }
    if (item.d >= this.items[this.k - 1].d) return
    this.items[this.k - 1] = item
    for (let i = this.k - 1; i > 0 && this.items[i].d < this.items[i - 1].d; i--) {
      const t = this.items[i]; this.items[i] = this.items[i - 1]; this.items[i - 1] = t
    }
  }
  get sorted() { return this.items.slice().sort((a, b) => a.d - b.d) }
}

/**
 * Nearest connections between two rings, as ports rather than bare vertices.
 *
 * Both vertex-to-vertex pairs and vertex-to-edge projections are offered. The
 * projection matters: letting a bridge land part-way along an edge, instead of
 * snapping to whichever vertex survived simplification, is what stops a sparse
 * outer ring from funnelling a whole cluster into one notch.
 */
function candidatePorts(ringA, ringB, ia, ib, k) {
  const top = new TopK(k)
  const stride = Math.max(1, Math.ceil(Math.sqrt((ringA.length * ringB.length) / FULL_SCAN_BUDGET)))

  // Coarse (or full, when stride is 1) vertex-to-vertex scan.
  let bestAi = 0, bestBi = 0, bestD = Infinity
  for (let i = 0; i < ringA.length; i += stride) {
    for (let j = 0; j < ringB.length; j += stride) {
      const d = dist(ringA[i], ringB[j])
      top.offer({ d, a: { ring: ia, kind: 'vertex', index: i }, b: { ring: ib, kind: 'vertex', index: j } })
      if (d < bestD) { bestD = d; bestAi = i; bestBi = j }
    }
  }

  // When the scan was coarse, refine fully inside the window around the best hit.
  if (stride > 1) {
    const w = stride * 2
    for (let di = -w; di <= w; di++) {
      const i = (bestAi + di + ringA.length) % ringA.length
      for (let dj = -w; dj <= w; dj++) {
        const j = (bestBi + dj + ringB.length) % ringB.length
        top.offer({
          d: dist(ringA[i], ringB[j]),
          a: { ring: ia, kind: 'vertex', index: i },
          b: { ring: ib, kind: 'vertex', index: j },
        })
      }
    }
  }

  // Project the closest few vertices of each ring onto the other ring's edges.
  const project = (from, fromRing, fromIdx, onto, ontoIdxRing, ontoIsA) => {
    const p = fromRing[fromIdx]
    let best = null
    for (let e = 0; e < onto.length; e++) {
      const a = onto[e], b = onto[(e + 1) % onto.length]
      const c = closestOnSegment(p, a, b)
      if (c.t <= 1e-6 || c.t >= 1 - 1e-6) continue // that's a vertex; already covered
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      if (!best || d < best.d) best = { d, e, t: c.t }
    }
    if (!best) return
    const vertexPort = { ring: from, kind: 'vertex', index: fromIdx }
    const edgePort = { ring: ontoIdxRing, kind: 'edge', index: best.e, t: best.t }
    top.offer(ontoIsA
      ? { d: best.d, a: edgePort, b: vertexPort }
      : { d: best.d, a: vertexPort, b: edgePort })
  }

  const seedsA = top.sorted.filter(c => c.a.kind === 'vertex').slice(0, 4).map(c => c.a.index)
  for (const i of new Set(seedsA)) project(ia, ringA, i, ringB, ib, false)
  const seedsB = top.sorted.filter(c => c.b.kind === 'vertex').slice(0, 4).map(c => c.b.index)
  for (const j of new Set(seedsB)) project(ib, ringB, j, ringA, ia, true)

  return top.sorted
}

const portPoint = (rings, port) => {
  const ring = rings[port.ring]
  if (port.kind === 'vertex') return ring[port.index]
  const a = ring[port.index], b = ring[(port.index + 1) % ring.length]
  return { x: a.x + (b.x - a.x) * port.t, y: a.y + (b.y - a.y) * port.t }
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * A bridge is usable when it crosses no ring edge and stays inside the field.
 * Because a non-crossing segment cannot leave and re-enter the field, sampling
 * a few interior points is enough to settle containment; three samples rather
 * than one guards against a sample landing exactly on a boundary, where
 * ray-casting is undefined.
 */
function isVisible(p, q, rings, index) {
  if (index.blocks(p, q)) return false

  const outer = rings[0]
  for (const t of [0.25, 0.5, 0.75]) {
    const s = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
    if (!pointInRing(s, outer)) return false
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(s, rings[i])) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Minimum spanning tree
// ---------------------------------------------------------------------------

/**
 * Kruskal over an edge list that is already in preference order. Callers pass
 * visible bridges first and blocked ones after, so a blocked bridge is only
 * ever taken when nothing unobstructed can connect that ring.
 */
function kruskal(nRings, orderedEdges) {
  const parent = Array.from({ length: nRings }, (_, i) => i)
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }

  const chosen = []
  for (const e of orderedEdges) {
    const ra = find(e.a.ring), rb = find(e.b.ring)
    if (ra === rb) continue
    parent[ra] = rb
    chosen.push(e)
    if (chosen.length === nRings - 1) break
  }
  return { chosen }
}

// ---------------------------------------------------------------------------
// Ring rebuilding (materialising edge ports as real vertices)
// ---------------------------------------------------------------------------

/**
 * Insert every edge port into its ring as a genuine vertex and report where
 * each port ended up. Points land exactly on existing edges, so the ring's
 * geometry — and every visibility decision already made against it — is
 * unchanged.
 */
function materialisePorts(rings, ports) {
  const byRing = rings.map(() => ({ vertex: new Map(), edge: new Map() }))
  for (const { port, id } of ports) {
    const bucket = byRing[port.ring][port.kind === 'vertex' ? 'vertex' : 'edge']
    if (!bucket.has(port.index)) bucket.set(port.index, [])
    bucket.get(port.index).push({ id, t: port.t ?? 0 })
  }

  const finalIndex = new Map()
  const newRings = rings.map((ring, r) => {
    const { vertex, edge } = byRing[r]
    if (vertex.size === 0 && edge.size === 0) return ring

    const out = []
    for (let k = 0; k < ring.length; k++) {
      for (const { id } of vertex.get(k) ?? []) finalIndex.set(id, out.length)
      out.push(ring[k])

      const onEdge = (edge.get(k) ?? []).slice().sort((a, b) => a.t - b.t)
      if (onEdge.length) {
        const a = ring[k], b = ring[(k + 1) % ring.length]
        for (const { id, t } of onEdge) {
          finalIndex.set(id, out.length)
          out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
        }
      }
    }
    return out
  })

  return { rings: newRings, finalIndex }
}

// ---------------------------------------------------------------------------
// Depth-first emission
// ---------------------------------------------------------------------------

/**
 * Walk the bridge tree into one closed ring.
 *
 * At every bridge the parent vertex is emitted, the child ring is traversed in
 * full starting and ending at its own attachment vertex, and the parent vertex
 * is emitted again. Both ends of every bridge therefore appear twice, which is
 * what keeps the slit zero-width: without the duplicates the traversal would
 * cut a corner on the way back out and open a sliver of non-field area inside
 * the field.
 */
function emitRing(rings, children, ringIdx, startVertex, mergeIds) {
  const ring = rings[ringIdx]
  const n = ring.length
  const out = []

  const kids = new Map()
  for (const c of children.get(ringIdx) ?? []) {
    if (!kids.has(c.parentVertex)) kids.set(c.parentVertex, [])
    kids.get(c.parentVertex).push(c)
  }

  for (let k = 0; k <= n; k++) {
    const idx = (startVertex + k) % n
    const attached = k < n ? kids.get(idx) : null

    out.push(attached
      ? { ...ring[idx], mergeID: mergeIds.get(attached[0].childRing) }
      : { ...ring[idx] })

    if (k === n) break

    for (const child of attached ?? []) {
      out.push(...emitRing(rings, children, child.childRing, child.childVertex, mergeIds))
      // Exit duplicate — the return trip along the same zero-width bridge.
      out.push({ ...ring[idx] })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Bridge one field's islands into its outer ring.
 *
 * @param {{outer: Point[], islands: Point[][]}} field
 * @returns {{coordinates: Point[], bridges: Array, warnings: string[]}}
 */
export function bridgeField(field) {
  const warnings = []

  // Winding is normalised here, not left to whatever the tracer produced: in a
  // stitched keyhole polygon the islands have to run opposite the boundary or
  // they do not subtract under a non-zero winding fill.
  const outer = orient(field.outer, true)
  const islands = field.islands.map(r => orient(r, false))
  let rings = [outer, ...islands]

  if (rings.length === 1) {
    return { coordinates: [...outer, { ...outer[0] }], bridges: [], warnings, rings }
  }

  const index = new SegmentIndex(ringsToSegments(rings))

  // --- candidate bridges, visibility-filtered -----------------------------
  const edges = []
  const blockedPairs = []
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const cands = candidatePorts(rings[i], rings[j], i, j, CANDIDATES_PER_PAIR)
      let taken = null
      for (const c of cands) {
        const p = portPoint(rings, c.a), q = portPoint(rings, c.b)
        if (isVisible(p, q, rings, index)) { taken = c; break }
      }
      if (taken) edges.push(taken)
      else if (cands.length) blockedPairs.push(cands[0])
    }
  }

  // --- spanning tree -------------------------------------------------------
  // Visible bridges first, cheapest to dearest; blocked ones only afterwards,
  // so a blocked bridge is taken solely when a ring has no clean route at all.
  // That keeps the island in the output — validate.js reports the crossing
  // rather than letting it pass silently.
  const visible = edges.slice().sort((a, b) => a.d - b.d)
  const blocked = blockedPairs.slice().sort((a, b) => a.d - b.d).map(e => ({ ...e, blocked: true }))
  const { chosen } = kruskal(rings.length, [...visible, ...blocked])

  for (const e of chosen) {
    if (e.blocked) {
      warnings.push(
        `No unobstructed route between ring ${e.a.ring} and ring ${e.b.ring} — ` +
        `fell back to the shortest blocked bridge.`)
    }
  }
  if (chosen.length < rings.length - 1) {
    warnings.push(`Only ${chosen.length} of ${rings.length - 1} islands could be connected.`)
  }

  // --- materialise ports, then orient the tree away from the outer ring ----
  const ports = []
  chosen.forEach((e, i) => {
    ports.push({ port: e.a, id: `${i}a` }, { port: e.b, id: `${i}b` })
  })
  const mat = materialisePorts(rings, ports)
  rings = mat.rings

  const adjacency = new Map()
  chosen.forEach((e, i) => {
    const av = mat.finalIndex.get(`${i}a`), bv = mat.finalIndex.get(`${i}b`)
    if (!adjacency.has(e.a.ring)) adjacency.set(e.a.ring, [])
    if (!adjacency.has(e.b.ring)) adjacency.set(e.b.ring, [])
    adjacency.get(e.a.ring).push({ to: e.b.ring, here: av, there: bv, edge: i })
    adjacency.get(e.b.ring).push({ to: e.a.ring, here: bv, there: av, edge: i })
  })

  const children = new Map()
  const mergeIds = new Map()
  const bridges = []
  const seen = new Set([0])
  const stack = [0]
  while (stack.length) {
    const r = stack.pop()
    for (const link of adjacency.get(r) ?? []) {
      if (seen.has(link.to)) continue
      seen.add(link.to)
      if (!children.has(r)) children.set(r, [])
      children.get(r).push({ childRing: link.to, parentVertex: link.here, childVertex: link.there })
      mergeIds.set(link.to, String(link.to + 1))
      bridges.push({
        from: rings[r][link.here],
        to: rings[link.to][link.there],
        fromRing: r,
        toRing: link.to,
        length: dist(rings[r][link.here], rings[link.to][link.there]),
      })
      stack.push(link.to)
    }
  }

  for (let r = 1; r < rings.length; r++) {
    if (!seen.has(r)) warnings.push(`Island ${r} could not be attached and was omitted.`)
  }

  const coordinates = emitRing(rings, children, 0, 0, mergeIds)
  return { coordinates, bridges, warnings, rings }
}

/** Bridge every field. */
export function bridgeFields(fields, log = () => {}) {
  log('Bridging: connecting islands (visibility-filtered spanning tree)...')

  let totalBridges = 0, toOuter = 0, totalLength = 0
  const warnings = []

  const out = fields.map(f => {
    const r = bridgeField(f)
    totalBridges += r.bridges.length
    toOuter += r.bridges.filter(b => b.fromRing === 0).length
    totalLength += r.bridges.reduce((s, b) => s + b.length, 0)
    for (const w of r.warnings) {
      warnings.push(`Field ${f.id}: ${w}`)
      log(`  WARNING: Field ${f.id}: ${w}`)
    }
    if (r.bridges.length) {
      const chained = r.bridges.length - r.bridges.filter(b => b.fromRing === 0).length
      log(`  Field ${f.id}: ${r.bridges.length} bridge(s), ` +
          `${r.bridges.filter(b => b.fromRing === 0).length} to the boundary` +
          (chained ? `, ${chained} island-to-island` : '') + '.')
    }
    return {
      ...f,
      coordinates: r.coordinates,
      bridges: r.bridges,
      rings: r.rings,
    }
  })

  log(`Bridging: ${totalBridges} bridge(s), ${toOuter} touching a field boundary, ` +
      `${totalLength.toFixed(1)} wu total.`)
  return { fields: out, warnings }
}
