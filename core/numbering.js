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

export const NUMBERING_ORDERS = ['rows', 'columns', 'area', 'source']

export const NUMBERING_LABELS = {
  rows: 'Top-left to bottom-right',
  columns: 'Top-left, down each column',
  area: 'Largest field first',
  source: 'Detection order',
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
 * @param {'rows'|'columns'|'area'|'source'} order
 */
export function renumberFields(fields, order = 'rows', log = () => {}) {
  if (!NUMBERING_ORDERS.includes(order)) order = 'rows'
  if (order === 'source' || fields.length < 2) return fields

  const sorted = order === 'area'
    ? [...fields].sort((a, b) => area(b.outer) - area(a.outer))
    : banded(fields, order)

  log(`Numbering: ${NUMBERING_LABELS[order].toLowerCase()}.`)
  return sorted.map((f, i) => ({ ...f, id: i + 1 }))
}
