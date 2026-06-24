/**
 * Stages 3 & 4 — loop segmentation and simplification.
 */
import simplify from 'simplify-js'
import { loopFieldsToXML } from './xmlUtils.js'

// ---------------------------------------------------------------------------
// Stage 3 — split flat coordinates into loops
// ---------------------------------------------------------------------------

function euclidean(a, b) {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
}

function closeLoop(loop) {
  if (loop.length > 0 && (loop[0][0] !== loop[loop.length - 1][0] || loop[0][1] !== loop[loop.length - 1][1])) {
    loop.push([...loop[0]])
  }
  return loop
}

export function stage3(fields, distanceThreshold, log) {
  log(`Processing field loops: threshold=${distanceThreshold}...`)

  const result = fields.map(field => {
    const coords = field.coordinates
    if (coords.length === 0) return { ...field, loops: [] }

    // Split on large gaps
    const rawLoops = []
    let current = [coords[0]]
    for (let i = 1; i < coords.length; i++) {
      if (euclidean(coords[i - 1], coords[i]) > distanceThreshold) {
        rawLoops.push(closeLoop(current))
        current = []
      }
      current.push(coords[i])
    }
    rawLoops.push(closeLoop(current))

    log(`  Field ${field.id}: segmented into ${rawLoops.length} loop(s).`)

    // Rearrange loops 2..n by proximity to base loop
    const baseLoop = rawLoops[0]
    const otherLoops = rawLoops.slice(1)

    const arranged = otherLoops
      .map(loop => {
        let minDist = Infinity
        let closestBase = null
        for (const bp of baseLoop) {
          for (const op of loop) {
            const d = euclidean(bp, op)
            if (d < minDist) { minDist = d; closestBase = bp }
          }
        }
        return { loop, closestBase, minDist }
      })
      .sort((a, b) => a.minDist - b.minDist)
      .map(x => x.loop)

    const loops = [baseLoop, ...arranged].map((pts, idx) => ({
      id: idx + 1,
      coordinates: pts,
    }))

    return { id: field.id, centerX: field.centerX, centerY: field.centerY, loops }
  })

  log('Processing field loops: Done.')
  return { fields: result, xml: loopFieldsToXML(result) }
}

// ---------------------------------------------------------------------------
// Stage 4 — RDP simplification + optional outer boundary shrink
// ---------------------------------------------------------------------------

/**
 * Shrink (or expand) a polygon by `distance` units using miter-based offset.
 * Only applied to the outer loop (Loop ID=1).
 * Positive distance = shrink inward for a CW polygon (Y-down coords).
 */
function shrinkPolygon(pts, distance) {
  if (!distance || pts.length < 3) return pts

  const n = pts.length
  const result = []

  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[(i - 1 + n) % n]
    const [bx, by] = pts[i]
    const [cx, cy] = pts[(i + 1) % n]

    const e1x = bx - ax, e1y = by - ay
    const e2x = cx - bx, e2y = cy - by
    const l1 = Math.hypot(e1x, e1y), l2 = Math.hypot(e2x, e2y)
    if (l1 < 1e-10 || l2 < 1e-10) { result.push([bx, by]); continue }

    // Inward (right) normals for CW polygon
    const n1x = e1y / l1, n1y = -e1x / l1
    const n2x = e2y / l2, n2y = -e2x / l2

    const bisx = n1x + n2x, bisy = n1y + n2y
    const bisl2 = bisx * bisx + bisy * bisy
    if (bisl2 < 1e-10) { result.push([bx, by]); continue }

    // Miter scale: 2d / |bisector|²  (derived from d/sin(half-angle))
    const scale = Math.min(2 * distance / bisl2, distance * 6)
    result.push([
      parseFloat((bx + bisx * scale).toFixed(2)),
      parseFloat((by + bisy * scale).toFixed(2)),
    ])
  }
  return result
}

export function stage4(fields, simplificationStrength, borderReduction, log) {
  log(`Simplifying: tolerance=${simplificationStrength}, borderReduction=${borderReduction}...`)

  let totalOriginal = 0, totalRemoved = 0

  const result = fields.map(field => {
    const loops = field.loops.map(loop => {
      const original = loop.coordinates
      totalOriginal += original.length

      // Convert to simplify-js format {x, y}
      const pts = original.map(([x, y]) => ({ x, y }))
      const simplified = simplify(pts, simplificationStrength, false)
      let coords = simplified.map(p => [p.x, p.y])

      // Shrink only the outer loop
      if (loop.id === 1 && borderReduction > 0) {
        coords = shrinkPolygon(coords, -borderReduction)
      }

      totalRemoved += original.length - coords.length
      log(`  Field ${field.id} Loop ${loop.id}: ${original.length} → ${coords.length} pts`)

      return { id: loop.id, coordinates: coords }
    })

    return { id: field.id, centerX: field.centerX, centerY: field.centerY, loops }
  })

  const pct = totalOriginal > 0 ? ((totalRemoved / totalOriginal) * 100).toFixed(1) : 0
  log(`Simplifying: Done. Reduced ${totalOriginal} → ${totalOriginal - totalRemoved} pts (${pct}% removed).`)

  return { fields: result, xml: loopFieldsToXML(result) }
}
