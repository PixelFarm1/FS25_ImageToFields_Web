/**
 * Stages 5 & 6 — mark merge points and flatten loops into single path.
 */
import { markedFieldsToXML, finalFieldsToXML } from './xmlUtils.js'

function euclidean(ax, ay, bx, by) {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2)
}

// ---------------------------------------------------------------------------
// Stage 5 — mark where inner loops attach to the outer loop
// ---------------------------------------------------------------------------

export function stage5(fields, log) {
  log('Marking field loops...')

  const result = fields.map(field => {
    if (field.loops.length <= 1) {
      // No inner loops — convert coords to {x,y} objects and pass through
      const loops = field.loops.map(l => ({
        id: l.id,
        coordinates: l.coordinates.map(([x, y]) => ({ x, y })),
      }))
      return { ...field, loops }
    }

    log(`  Field ${field.id}: merging ${field.loops.length - 1} inner loop(s) into main loop.`)

    // Convert all loops to {x,y} objects (mutable)
    const loops = field.loops.map(l => ({
      id: l.id,
      coordinates: l.coordinates.map(([x, y]) => ({ x, y })),
    }))

    const mainLoop = loops[0]

    for (let li = 1; li < loops.length; li++) {
      const otherLoop = loops[li]
      const mergeId = String(otherLoop.id)

      // Find closest pair between main loop and this inner loop
      let minDist = Infinity
      let mainIdx = -1, otherIdx = -1

      for (let mi = 0; mi < mainLoop.coordinates.length; mi++) {
        const mc = mainLoop.coordinates[mi]
        for (let oi = 0; oi < otherLoop.coordinates.length; oi++) {
          const oc = otherLoop.coordinates[oi]
          const d = euclidean(mc.x, mc.y, oc.x, oc.y)
          if (d < minDist) { minDist = d; mainIdx = mi; otherIdx = oi }
        }
      }

      // Mark the closest main-loop coordinate with mergeID
      mainLoop.coordinates[mainIdx] = { ...mainLoop.coordinates[mainIdx], mergeID: mergeId }
      // Insert a duplicate immediately after
      mainLoop.coordinates.splice(mainIdx + 1, 0, { ...mainLoop.coordinates[mainIdx] })

      // Reorder inner loop to start at closest point
      const reordered = [
        ...otherLoop.coordinates.slice(otherIdx),
        ...otherLoop.coordinates.slice(0, otherIdx),
      ]
      // Close the inner loop
      reordered.push({ ...reordered[0] })
      loops[li] = { id: otherLoop.id, coordinates: reordered }
    }

    return { id: field.id, centerX: field.centerX, centerY: field.centerY, loops }
  })

  log('Marking field loops: Done.')
  return { fields: result, xml: markedFieldsToXML(result) }
}

// ---------------------------------------------------------------------------
// Stage 6 — flatten: splice inner loops into main loop at merge points
// ---------------------------------------------------------------------------

export function stage6(fields, log) {
  log('Finalizing field coordinates...')

  const result = fields.map(field => {
    if (field.loops.length <= 1) {
      return {
        id: field.id,
        centerX: field.centerX,
        centerY: field.centerY,
        coordinates: field.loops[0]?.coordinates ?? [],
      }
    }

    const loop1 = field.loops[0]
    // Build lookup of inner loops by id
    const innerLoops = {}
    for (const l of field.loops.slice(1)) innerLoops[String(l.id)] = l.coordinates

    const ordered = []
    for (const coord of loop1.coordinates) {
      ordered.push(coord)
      if (coord.mergeID && innerLoops[coord.mergeID]) {
        ordered.push(...innerLoops[coord.mergeID])
        delete innerLoops[coord.mergeID]
      }
    }

    return { id: field.id, centerX: field.centerX, centerY: field.centerY, coordinates: ordered }
  })

  log('Finalizing field coordinates: Done.')
  return { fields: result, xml: finalFieldsToXML(result) }
}
