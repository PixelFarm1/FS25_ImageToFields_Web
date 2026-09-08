/**
 * Field numbering order.
 *
 * Components come out of the raster in scan order, which numbers a field by its
 * single topmost-leftmost pixel. That is well defined but reads as arbitrary on
 * a map: a long diagonal field is numbered by the one corner that happens to
 * poke highest, not by where the field actually sits, so neighbouring fields
 * can be dozens apart.
 *
 * The reading orders below band fields into rows (or columns) first. Sorting
 * purely by centre Y would be just as jumpy as scan order — two fields side by
 * side are never at exactly the same height, so a few metres of difference
 * would separate them in the sequence. A field joins the current row if its
 * centre is within a fraction of a typical field's height of the row's first
 * field, and rows are then read across.
 */
import { bbox, area } from './geom.js'

export const NUMBERING_ORDERS = ['rows', 'columns', 'chunks', 'radial', 'area', 'source']

export const NUMBERING_LABELS = {
  rows: 'Top-left to bottom-right',
  columns: 'Top-left, down each column',
  chunks: 'In chunks, top to bottom',
  radial: 'Outward from a corner',
  area: 'Largest field first',
  source: 'Detection order',
}

export const CHUNK_COUNT = { min: 2, max: 20, default: 4 }
export const RADIAL_STEPS = { min: 2, max: 20, default: 6 }

export const RADIAL_CORNERS = ['nw', 'ne', 'sw', 'se']
export const RADIAL_CORNER_LABELS = {
  nw: 'Top-left', ne: 'Top-right', sw: 'Bottom-left', se: 'Bottom-right',
}

const clamp = (v, { min, max, default: dflt }) =>
  Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : dflt

/** Extent of the fields themselves — chunks and rings are laid out over this. */
function fieldExtent(fields) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const f of fields) {
    if (f.centerX < minX) minX = f.centerX
    if (f.centerX > maxX) maxX = f.centerX
    if (f.centerY < minY) minY = f.centerY
    if (f.centerY > maxY) maxY = f.centerY
  }
  return { minX, maxX, minY, maxY }
}

/**
 * Equal horizontal bands, numbered top band first, each band read top-left to
 * bottom-right. Unlike `rows`, the band count is the user's choice rather than
 * derived from field sizes, so the numbering can be lined up with however the
 * map is actually worked on.
 *
 * The bands span the area the fields occupy rather than the whole DEM, so every
 * chunk holds fields instead of some coming out empty when the fields sit in
 * the middle of the map.
 */
function chunked(fields, count) {
  const { minY, maxY } = fieldExtent(fields)
  const span = maxY - minY || 1

  const buckets = bucketise(fields, count, f => (f.centerY - minY) / span)
  return buckets.flatMap(band => banded(band, 'rows'))
}

/**
 * Drop each field into one of `count` buckets by a 0..1 position.
 *
 * Computing the index per field, rather than filtering the list once per
 * bucket with a lo/hi range, is what makes this total: comparing against
 * recomputed edges leaves a field exactly on the outermost edge able to fail
 * every test at once — `max * count / count` need not come back as `max` in
 * floating point — and it silently vanishes from the numbering.
 */
function bucketise(fields, count, position) {
  const buckets = Array.from({ length: count }, () => [])
  for (const f of fields) {
    const t = position(f)
    const i = Math.min(count - 1, Math.max(0, Math.floor(t * count)))
    buckets[i].push(f)
  }
  return buckets
}

/**
 * Rings growing out of one corner.
 *
 * Fields are grouped by distance from the corner into `steps` equal rings, and
 * each ring is then swept by angle. The sweep is what gives the step count any
 * effect: ordering a ring by distance instead would just reproduce a plain
 * distance sort, and the number of steps would change nothing.
 */
function radial(fields, corner, steps) {
  const { minX, maxX, minY, maxY } = fieldExtent(fields)
  // World y grows downward, so 'n' is the top of the map.
  const ox = corner[1] === 'w' ? minX : maxX
  const oy = corner[0] === 'n' ? minY : maxY

  const distance = f => Math.hypot(f.centerX - ox, f.centerY - oy)
  const angle = f => Math.atan2(f.centerY - oy, f.centerX - ox)

  const furthest = Math.max(...fields.map(distance)) || 1

  return bucketise(fields, steps, f => distance(f) / furthest)
    .flatMap(ring => ring.sort((a, b) => angle(a) - angle(b)))
}

/**
 * How close two centres must be, across the banding axis, to share a band,
 * as a fraction of the median field's size along that axis.
 *
 * Measured on a 101-field map, by the share of consecutive ids that step
 * rightward and the number that jump back up the map:
 *
 *   detection order   48% rightward    1 upward jump
 *   0.4x median       77%              0
 *   0.6x median       81%              0
 *   1.0x median       88%              5
 *   2.0x median       94%             22
 *
 * Wider bands sweep across more consistently but start reordering fields
 * vertically within a band, which reads worse than the occasional short step
 * leftward. 0.6 is the last value that never jumps back up.
 */
const BAND_FRACTION = 0.6

function bandTolerance(fields, axis) {
  const sizes = fields
    .map(f => {
      const b = bbox(f.outer)
      return axis === 'y' ? b.maxY - b.minY : b.maxX - b.minX
    })
    .sort((a, b) => a - b)
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0
  return median * BAND_FRACTION
}

/**
 * Group by one axis, then read along the other.
 * `rows` bands on y and reads left to right; `columns` bands on x and reads top
 * to bottom.
 */
function banded(fields, order) {
  const across = order === 'rows' ? 'centerY' : 'centerX'
  const along = order === 'rows' ? 'centerX' : 'centerY'
  const axis = order === 'rows' ? 'y' : 'x'
  const tolerance = bandTolerance(fields, axis)

  const sorted = [...fields].sort((a, b) => a[across] - b[across])
  const out = []

  let i = 0
  while (i < sorted.length) {
    const bandStart = sorted[i][across]
    const group = []
    while (i < sorted.length && sorted[i][across] - bandStart <= tolerance) {
      group.push(sorted[i++])
    }
    group.sort((a, b) => a[along] - b[along])
    out.push(...group)
  }
  return out
}

/**
 * Reassign field ids in the requested order.
 *
 * Runs before the remaining stages so the ids in the log, in the field list and
 * in the exported XML are all the same numbers.
 *
 * @param {Array} fields  fields carrying centerX / centerY / outer
 * @param {{numbering?: string, chunkCount?: number,
 *          radialCorner?: string, radialSteps?: number}} options
 */
export function renumberFields(fields, options = {}, log = () => {}) {
  const order = NUMBERING_ORDERS.includes(options.numbering) ? options.numbering : 'rows'
  if (order === 'source' || fields.length < 2) return fields

  let sorted
  let detail = ''

  if (order === 'area') {
    sorted = [...fields].sort((a, b) => area(b.outer) - area(a.outer))
  } else if (order === 'chunks') {
    const count = clamp(options.chunkCount, CHUNK_COUNT)
    sorted = chunked(fields, count)
    detail = ` (${count} chunks)`
  } else if (order === 'radial') {
    const corner = RADIAL_CORNERS.includes(options.radialCorner) ? options.radialCorner : 'nw'
    const steps = clamp(options.radialSteps, RADIAL_STEPS)
    sorted = radial(fields, corner, steps)
    detail = ` (${RADIAL_CORNER_LABELS[corner].toLowerCase()}, ${steps} rings)`
  } else {
    sorted = banded(fields, order)
  }

  log(`Numbering: ${NUMBERING_LABELS[order].toLowerCase()}${detail}.`)
  return sorted.map((f, i) => ({ ...f, id: i + 1 }))
}
