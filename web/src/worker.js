/**
 * Web Worker — orchestrates the full 6-stage pipeline.
 * Communicates with the main thread via postMessage.
 *
 * Inbound:  { type: 'RUN', payload: { imageBuffer, demSize, simplificationStrength, distanceThreshold, borderReduction, metersPerPixel } }
 * Outbound: { type: 'LOG',  message: string }
 *           { type: 'DONE', fields: Field[], zipBuffer: ArrayBuffer }
 *           { type: 'ERROR', message: string }
 */
import JSZip from 'jszip'
import { stage1, stage2 } from './pipeline/imageProcessing.js'
import { stage3, stage4 } from './pipeline/fieldLoops.js'
import { stage5, stage6 } from './pipeline/fieldMerge.js'
import luaScript from '../../coordinatesToFields.lua?raw'

function log(msg) {
  self.postMessage({ type: 'LOG', message: msg })
}

/**
 * Shoelace formula — area of a polygon defined by {x,y} point objects.
 * Coordinates are relative to field centre (world units).
 */
function shoelaceArea(pts) {
  const n = pts.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

self.onmessage = async (e) => {
  if (e.data.type !== 'RUN') return
  const {
    imageBuffer, demSize, simplificationStrength,
    distanceThreshold, borderReduction,
    metersPerPixel = 2,
  } = e.data.payload

  try {
    // Stage 1
    const s1 = await stage1(imageBuffer, log)

    // Stage 2
    const s2 = stage2(s1, demSize, log)

    // Stage 3
    const s3 = stage3(s2.fields, distanceThreshold, log)

    // Stage 4
    const s4 = stage4(s3.fields, simplificationStrength, borderReduction, log)

    // Stage 5
    const s5 = stage5(s4.fields, log)

    // -------------------------------------------------------------------
    // Compute real-world area per field from stage-5 loop structure.
    // Loop 1 = outer boundary, loops 2+ = holes to subtract.
    // metersPerWorldUnit converts world units² to m².
    // -------------------------------------------------------------------
    const ratio = s1.width / demSize                          // world units per pixel (1px = 1/ratio wu)
    const metersPerWorldUnit = metersPerPixel * ratio         // m per world unit (1wu = ratio px × m/px)
    const m2Scale = metersPerWorldUnit * metersPerWorldUnit   // (m/wu)²

    const fieldAreaM2 = {}
    for (const field of s5.fields) {
      const outerArea = shoelaceArea(field.loops[0]?.coordinates ?? [])
      const holeArea  = field.loops.slice(1).reduce((sum, l) => sum + shoelaceArea(l.coordinates), 0)
      fieldAreaM2[field.id] = Math.max(0, outerArea - holeArea) * m2Scale
    }

    // Stage 6
    const s6 = stage6(s5.fields, log)

    // Attach areaM2 to each final field
    const fields = s6.fields.map(f => ({ ...f, areaM2: fieldAreaM2[f.id] ?? 0 }))

    // Assemble zip
    log('Assembling output zip...')
    const zip = new JSZip()
    zip.file('processed_image.png',           s1.pngBuffer)
    zip.file('coordinates1.xml',              s2.xml)
    zip.file('field_loops.xml',               s3.xml)
    zip.file('simplified_field_loops.xml',    s4.xml)
    zip.file('field_coordinates_marked.xml',  s5.xml)
    zip.file('final_field_coordinates.xml',   s6.xml)
    zip.file('coordinatesToFields.lua',       luaScript)

    const zipBlob = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    log('Done! Click "Download .zip" to save all output files.')

    self.postMessage({ type: 'DONE', fields, zipBuffer: zipBlob }, [zipBlob])
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: String(err?.message ?? err) })
  }
}
