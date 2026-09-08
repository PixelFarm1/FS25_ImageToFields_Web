/**
 * Web Worker. Decodes the PNG, then hands the raw pixels to the same pipeline
 * the CLI uses — core/ contains no DOM or Node specifics, so there is one
 * implementation and no branch between the two environments.
 */
import { runPipeline } from '../../core/pipeline.js'
import { renderDebugSVG } from '../../debugSvg.js'
import { finalFieldsToXML } from '../../core/xml.js'

self.onmessage = async (e) => {
  if (e.data.type !== 'RUN') return
  const { imageBuffer, options } = e.data

  const log = message => self.postMessage({ type: 'LOG', message })

  try {
    const bitmap = await createImageBitmap(new Blob([imageBuffer], { type: 'image/png' }))
    const { width, height } = bitmap

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0)
    const rgba = ctx.getImageData(0, 0, width, height).data
    bitmap.close()

    const result = runPipeline({ width, height, rgba }, options, log)

    const issuesById = new Map(result.validation.report.map(r => [r.id, r.issues]))

    // Rings and bridges are needed for drawing; coordinates for the XML.
    const fields = result.fields.map(f => ({
      id: f.id,
      sourceId: f.sourceId,
      part: f.part,
      centerX: f.centerX,
      centerY: f.centerY,
      areaM2: f.areaM2,
      islandCount: f.islandCount,
      pointCount: f.coordinates.length,
      rings: f.rings,
      bridges: f.bridges,
      coordinates: f.coordinates,
      issues: issuesById.get(f.id) ?? [],
    }))

    self.postMessage({
      type: 'DONE',
      fields,
      stats: result.stats,
      warnings: result.warnings,
      xml: result.xml.final,
      svg: renderDebugSVG(fields),
    })
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: String(err?.stack ?? err?.message ?? err) })
  }
}

// Re-exported so the main thread can rebuild XML after a client-side tweak
// without re-running the whole pipeline.
export { finalFieldsToXML }
