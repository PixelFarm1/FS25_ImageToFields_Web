/**
 * Pipeline orchestrator.
 *
 * Pure and platform-agnostic: it takes raw pixels and returns plain objects, so
 * the same code runs in a Web Worker (fed from OffscreenCanvas) and in Node
 * (fed from pngjs), with no branching between them.
 */
import { thresholdRGBA, analyseRaster } from './raster.js'
import { extractContours, toWorld } from './contours.js'
import { offsetFields } from './offset.js'
import { simplifyFields } from './simplify.js'
import { bridgeFields } from './bridge.js'
import { validateFields } from './validate.js'
import { finalFieldsToXML, ringFieldsToXML } from './xml.js'
import { area } from './geom.js'
import { poleOfInaccessibility } from './labelPoint.js'
import { renumberFields } from './numbering.js'

export const DEFAULT_OPTIONS = {
  demSize: 2048,
  /** RDP tolerance, capped per ring at a fraction of the ring's own size. */
  simplification: 0.7,
  /** Border reduction / island clearance, in world units. */
  clearance: 0,
  /** World units one source pixel covers. Affects reported areas only. */
  unitsPerPixel: 1,
  /** Field id order: 'rows' | 'columns' | 'chunks' | 'radial' | 'area' | 'source'. */
  numbering: 'rows',
  /** Horizontal bands, for numbering: 'chunks'. */
  chunkCount: 4,
  /** Corner to grow rings from, for numbering: 'radial'. */
  radialCorner: 'nw',
  /** Ring count, for numbering: 'radial'. */
  radialSteps: 6,
}

/**
 * @param {{width: number, height: number, rgba: Uint8ClampedArray|Uint8Array}} image
 * @param {Partial<typeof DEFAULT_OPTIONS>} options
 * @param {(msg: string) => void} log
 */
export function runPipeline(image, options = {}, log = () => {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options }
  const { width, height } = image
  const started = Date.now()

  log(`Input: ${width}x${height}, DEM ${opt.demSize}, ` +
      `simplification ${opt.simplification}, clearance ${opt.clearance} wu.`)

  const binary = thresholdRGBA(image.rgba, width, height)

  const raster = analyseRaster(binary, width, height, log)
  const contours = extractContours(raster, log)
  const world = toWorld(contours, width, height, opt.demSize)

  const offset = offsetFields(world, opt.clearance, log)
  // Before the later stages, so the ids in the log, the field list and the XML
  // are all the same numbers.
  const numbered = renumberFields(offset.fields, opt, log)
  const simplified = simplifyFields(numbered, opt.simplification, {}, log)
  const bridged = bridgeFields(simplified, log)
  const validation = validateFields(bridged.fields, log)

  // Reported areas. ratio is source pixels per world unit, and unitsPerPixel is
  // how many real units one source pixel covers, so their product converts a
  // world-unit length to a real one; squared, it converts an area. One Giants
  // unit is one metre, which is why the areas are reported as m² / hectares.
  const ratio = width / opt.demSize
  const areaScale = (opt.unitsPerPixel * ratio) ** 2

  const fields = bridged.fields.map(f => {
    const rings = f.rings ?? [f.outer, ...(f.islands ?? [])]
    const outerArea = area(rings[0])
    const islandArea = rings.slice(1).reduce((s, r) => s + area(r), 0)

    // Where a label belongs — see labelPoint.js. Field-local, like the
    // coordinates, so it moves with the field's centre.
    const label = poleOfInaccessibility(rings)

    return {
      id: f.id,
      sourceId: f.sourceId,
      part: f.part,
      centerX: f.centerX,
      centerY: f.centerY,
      labelX: Math.round(label.x * 100) / 100,
      labelY: Math.round(label.y * 100) / 100,
      labelClearance: Math.round(label.distance * 100) / 100,
      coordinates: f.coordinates,
      bridges: f.bridges,
      rings,
      islandCount: rings.length - 1,
      areaM2: Math.max(0, outerArea - islandArea) * areaScale,
    }
  })

  const stats = {
    fields: fields.length,
    islands: fields.reduce((s, f) => s + f.islandCount, 0),
    bridges: fields.reduce((s, f) => s + f.bridges.length, 0),
    bridgesToBoundary: fields.reduce(
      (s, f) => s + f.bridges.filter(b => b.fromRing === 0).length, 0),
    bridgeLength: fields.reduce(
      (s, f) => s + f.bridges.reduce((t, b) => t + b.length, 0), 0),
    points: fields.reduce((s, f) => s + f.coordinates.length, 0),
    errors: validation.errors,
    warnings: validation.warnings,
    elapsedMs: Date.now() - started,
  }

  log(`Done in ${stats.elapsedMs} ms — ${stats.fields} field(s), ${stats.islands} island(s), ` +
      `${stats.bridges} bridge(s) (${stats.bridgesToBoundary} to a boundary), ` +
      `${stats.bridgeLength.toFixed(1)} wu of bridge.`)

  return {
    fields,
    stats,
    validation,
    warnings: [
      ...raster.warnings,
      ...(contours.warnings ?? []),
      ...offset.warnings,
      ...bridged.warnings,
    ],
    xml: {
      final: finalFieldsToXML(fields),
      rings: ringFieldsToXML(simplified),
    },
  }
}
