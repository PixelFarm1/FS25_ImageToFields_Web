/**
 * Audit an existing final_field_coordinates.xml — from any version of the tool
 * — and report bridges that run over non-field area.
 *
 * The stitched keyhole format is self-describing: an island begins at a vertex
 * carrying a mergeID and ends at the next vertex with identical coordinates, so
 * the outer ring and the islands can be recovered from the flat list without
 * any of the intermediate files.
 */
import { properIntersect, pointInRing } from './core/geom.js'

const FIELD_RE = /<Field ID="(\d+)" X="([-\d.]+)" Y="([-\d.]+)">([\s\S]*?)<\/Field>/g
const COORD_RE = /<coordinate X="([-\d.]+)" Y="([-\d.]+)"(?: mergeID="(\d+)")?\s*\/>/g

const same = (a, b) => a.x === b.x && a.y === b.y

/**
 * Decompose one ring's emitted span into its own vertices, the islands nested
 * inside it, and the bridges reaching them.
 *
 * Recursive because islands may now be chained to each other rather than all
 * hanging off the boundary: an island's span can itself contain further spans.
 * Handles the old star-shaped output too, where the recursion simply never goes
 * deeper than one level.
 */
function decomposeSpan(coords) {
  const own = []
  const islands = []
  const bridges = []

  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]
    if (c.mergeID) {
      let j = i + 1
      while (j < coords.length && !same(coords[j], c)) j++
      if (j < coords.length) {
        const inner = coords.slice(i + 1, j)
        if (inner.length) {
          bridges.push({ from: c, to: inner[0] })
          const sub = decomposeSpan(inner)
          islands.push(sub.ring, ...sub.islands)
          bridges.push(...sub.bridges)
        }
        own.push(c)
        i = j // skip the closing repeat of the child's span
        continue
      }
    }
    own.push(c)
  }

  // Drop the span's own closing repeat.
  while (own.length > 1 && same(own[0], own[own.length - 1])) own.pop()
  return { ring: own, islands, bridges }
}

/** Recover { outer, islands, bridges } from one field's flat coordinate list. */
export function decomposeField(coords) {
  const { ring, islands, bridges } = decomposeSpan(coords)
  return { outer: ring, islands, bridges }
}

function crossCount(p, q, ring) {
  let n = 0
  for (let i = 0; i < ring.length; i++) {
    if (properIntersect(p, q, ring[i], ring[(i + 1) % ring.length])) n++
  }
  return n
}

export function auditXML(xml) {
  let fields = 0, fieldsWithIslands = 0, islands = 0
  let bridgeLength = 0, crossings = 0
  const badFields = []

  for (const m of xml.matchAll(FIELD_RE)) {
    fields++
    const coords = [...m[4].matchAll(COORD_RE)]
      .map(c => ({ x: +c[1], y: +c[2], mergeID: c[3] }))
    const d = decomposeField(coords)
    if (!d.islands.length) continue

    fieldsWithIslands++
    islands += d.islands.length

    // Every bridge is tested against every ring, its own two included. A bridge
    // only touches those at its endpoints, and a shared endpoint is not a
    // proper crossing — but a bridge that re-enters the concave island it came
    // from is a genuine defect, so there is no reason to exempt it.
    let fieldCrossings = 0
    for (const { from, to } of d.bridges) {
      bridgeLength += Math.hypot(to.x - from.x, to.y - from.y)

      fieldCrossings += crossCount(from, to, d.outer)
      for (const island of d.islands) fieldCrossings += crossCount(from, to, island)

      // A bridge that crosses nothing but still lies outside the field, or
      // inside an island, is caught by sampling its interior.
      for (const t of [0.25, 0.5, 0.75]) {
        const s = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
        if (!pointInRing(s, d.outer)) { fieldCrossings++; break }
      }
      for (const island of d.islands) {
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
        if (pointInRing(mid, island)) { fieldCrossings++; break }
      }
    }

    if (fieldCrossings) {
      crossings += fieldCrossings
      badFields.push({ id: m[1], islands: d.islands.length, crossings: fieldCrossings })
    }
  }

  return { fields, fieldsWithIslands, islands, bridgeLength, crossings, badFields }
}
