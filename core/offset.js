/**
 * Stage 3 — clearance and cleanup, via Clipper.
 *
 * Border reduction, island clearance, islands merging when they crowd each
 * other, and islands that reach the field edge are all one operation:
 *
 *   field = difference( offset(outer, -d), union(islands.map(h => offset(h, +d))) )
 *
 * The old stage 4 offset only shrank the outer ring, so a field kept full
 * clearance from its boundary and none at all from the tree island it was
 * actually going to hit. It was also a bare miter with no self-intersection
 * cleanup, so narrow necks folded over on themselves.
 *
 * Clipper works in integers; SCALE fixes the working precision. World
 * coordinates carry two decimals, so 1000 leaves three orders of headroom.
 */
import ClipperLib from 'clipper-lib'
import { signedArea2, dedupeRing } from './geom.js'

const SCALE = 1000
const MITER_LIMIT = 2.0
const ARC_TOLERANCE = 0.25 * SCALE / 1000

const toClipper = ring => ring.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }))
const fromClipper = path => path.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }))

function offsetPaths(paths, delta) {
  if (delta === 0) return paths
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, ARC_TOLERANCE)
  co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  const out = new ClipperLib.Paths()
  co.Execute(out, delta * SCALE)
  return out
}

/** Flatten a PolyTree into { outer, islands } groups, one per top-level polygon. */
function polyTreeToGroups(node, groups = []) {
  for (const child of node.Childs()) {
    if (!child.IsHole()) {
      const group = { outer: fromClipper(child.Contour()), islands: [] }
      for (const hole of child.Childs()) {
        group.islands.push(fromClipper(hole.Contour()))
        // A field nested inside an island is not a field (see raster.js); if
        // Clipper produces one anyway it is an artefact of offsetting, and its
        // own children are ignored deliberately.
        polyTreeToGroups(hole, groups)
      }
      groups.push(group)
    }
  }
  return groups
}

/**
 * Apply clearance to one field and return the resulting polygon groups.
 * A single input field can yield more than one group: pulling the boundary in
 * far enough will pinch a dumbbell-shaped field into two, and each part has to
 * become its own polygon.
 *
 * @param {{outer: Point[], islands: Point[][]}} field
 * @param {number} clearance   world units; 0 means cleanup only
 */
export function applyClearance(field, clearance) {
  const outerPaths = offsetPaths([toClipper(field.outer)], -clearance)
  if (outerPaths.length === 0) return [] // field vanished entirely

  const clipper = new ClipperLib.Clipper()
  // Clipper's own vertex reduction only drops collinear points, which is
  // lossless — measured area is identical before and after — so it is left on
  // as free compression of the pixel staircases. StrictlySimple guarantees the
  // output polygons are strictly simple (no self-touching vertices), which the
  // bridging stage relies on when it reasons about what a segment can cross.
  clipper.StrictlySimple = true
  clipper.AddPaths(outerPaths, ClipperLib.PolyType.ptSubject, true)

  if (field.islands.length > 0) {
    // Offset each island outward, then union so that islands closer than 2*d
    // become one obstacle rather than leaving an impassable sliver between them.
    const islandPaths = offsetPaths(field.islands.map(toClipper), clearance)
    if (islandPaths.length > 0) {
      clipper.AddPaths(islandPaths, ClipperLib.PolyType.ptClip, true)
    }
  }

  const tree = new ClipperLib.PolyTree()
  clipper.Execute(
    ClipperLib.ClipType.ctDifference, tree,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero,
  )

  return polyTreeToGroups(tree)
    .map(g => ({
      outer: dedupeRing(g.outer),
      // Called through an arrow, not passed by reference: Array.map hands the
      // callback (element, index, array), and the index would land in
      // dedupeRing's `eps` parameter — silently collapsing the nth island with
      // a tolerance of n world units.
      islands: g.islands.map(r => dedupeRing(r)).filter(r => r.length >= 3),
    }))
    .filter(g => g.outer.length >= 3)
    // Largest part first, so a split field keeps its main body as part 1.
    .sort((a, b) => Math.abs(signedArea2(b.outer)) - Math.abs(signedArea2(a.outer)))
}

/**
 * Run clearance across every field, renumbering when a field splits.
 *
 * @returns {{fields: Array, warnings: string[]}}
 */
export function offsetFields(fields, clearance, log = () => {}) {
  log(clearance > 0
    ? `Clearance: offsetting boundaries in and islands out by ${clearance} wu...`
    : 'Clearance: cleaning polygons (no border reduction requested)...')

  const out = []
  const warnings = []

  for (const f of fields) {
    // A one- or two-pixel island traces to a contour with no area. It carries
    // no shape to preserve and cannot be bridged, so it is dropped — but said
    // out loud, because a silently vanishing island is exactly the kind of
    // thing that is impossible to explain later.
    const degenerate = f.islands.filter(r => r.length < 3).length
    if (degenerate > 0) {
      warnings.push(
        `Field ${f.id}: ${degenerate} island(s) smaller than 3 pixels dropped as noise.`)
    }

    const groups = applyClearance(f, clearance)
    const keptIslands = groups.reduce((s, g) => s + g.islands.length, 0)
    const lost = f.islands.length - degenerate - keptIslands
    if (lost > 0) {
      warnings.push(
        `Field ${f.id}: ${lost} island(s) merged or removed while cleaning the polygon.`)
    }

    if (groups.length === 0) {
      warnings.push(`Field ${f.id} disappeared at a clearance of ${clearance} wu and was dropped.`)
      continue
    }
    if (groups.length > 1) {
      warnings.push(`Field ${f.id} was split into ${groups.length} parts by the ${clearance} wu clearance.`)
    }

    groups.forEach((g, i) => {
      out.push({
        id: out.length + 1,
        sourceId: f.id,
        part: groups.length > 1 ? i + 1 : null,
        centerX: f.centerX,
        centerY: f.centerY,
        outer: g.outer,
        islands: g.islands,
      })
    })
  }

  const islandCount = out.reduce((s, f) => s + f.islands.length, 0)
  log(`Clearance: ${out.length} field(s), ${islandCount} island(s).`)
  for (const w of warnings) log(`  WARNING: ${w}`)

  return { fields: out, warnings }
}
