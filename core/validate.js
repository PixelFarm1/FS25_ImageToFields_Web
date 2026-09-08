/**
 * Stage 6 — validation.
 *
 * The original pipeline had no equivalent: the first place a malformed polygon
 * showed up was the Giants Editor, after a full import. Every check here is
 * cheap enough to run on every field, every time.
 */
import {
  area, signedArea2, properIntersect, samePoint,
  SegmentIndex, ringsToSegments,
} from './geom.js'

/**
 * @param {object} field  a bridged field: { id, coordinates, rings, bridges }
 * @returns {Array<{level: 'error'|'warning', code: string, message: string}>}
 */
export function validateField(field) {
  const issues = []
  const err = (code, message) => issues.push({ level: 'error', code, message })
  const warn = (code, message) => issues.push({ level: 'warning', code, message })

  const coords = field.coordinates ?? []
  if (coords.length < 4) {
    err('too-few-points', `only ${coords.length} points`)
    return issues
  }

  // --- the emitted ring must close -----------------------------------------
  if (!samePoint(coords[0], coords[coords.length - 1])) {
    err('not-closed', 'first and last coordinate differ')
  }

  // --- bridges must be doubled at both ends --------------------------------
  // Both ends of every bridge are visited twice: once travelling in, once
  // coming back out. The two visits are separated by the whole island ring, so
  // they are never adjacent in the list — what matters is that each endpoint
  // occurs at least twice. A single visit would mean the walk cut the corner on
  // the way back and left a sliver of non-field area inside the field.
  const occurrences = new Map()
  const key = p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`
  for (const c of coords) occurrences.set(key(c), (occurrences.get(key(c)) ?? 0) + 1)

  for (const b of field.bridges ?? []) {
    if ((occurrences.get(key(b.from)) ?? 0) < 2) {
      err('bridge-entry-not-doubled',
        `bridge entry at (${b.from.x}, ${b.from.y}) is visited once — the slit would open a sliver`)
    }
    if ((occurrences.get(key(b.to)) ?? 0) < 2) {
      err('bridge-exit-not-doubled',
        `bridge exit at (${b.to.x}, ${b.to.y}) is visited once — the slit would open a sliver`)
    }
  }

  // --- degenerate edges ----------------------------------------------------
  // Zero-length edges are consecutive identical points, which is a different
  // thing entirely from the intended doubled visits and is never wanted.
  let zeroLen = 0
  for (let i = 1; i < coords.length; i++) {
    if (samePoint(coords[i], coords[i - 1])) zeroLen++
  }

  // --- geometry of the underlying rings ------------------------------------
  const rings = field.rings
  if (rings && rings.length) {
    // Winding: boundary counter-clockwise, islands clockwise, so islands
    // subtract under a non-zero fill.
    if (signedArea2(rings[0]) <= 0) err('bad-winding', 'outer ring is not counter-clockwise')
    for (let i = 1; i < rings.length; i++) {
      if (signedArea2(rings[i]) >= 0) err('bad-winding', `island ${i} is not clockwise`)
    }

    // Every bridge must clear every ring.
    const index = new SegmentIndex(ringsToSegments(rings))
    let crossings = 0
    for (const b of field.bridges ?? []) {
      for (const j of index.query(b.from, b.to)) {
        const s = index.segments[j]
        if (properIntersect(b.from, b.to, s.a, s.b)) crossings++
      }
    }
    if (crossings > 0) {
      err('bridge-crosses-geometry',
        `${crossings} bridge/ring intersection(s) — a bridge runs over non-field area`)
    }

    // Area conservation: the emitted keyhole ring should enclose exactly the
    // boundary minus the islands. Bridges are zero-width and contribute nothing.
    const expected = area(rings[0]) - rings.slice(1).reduce((s, r) => s + area(r), 0)
    const got = area(coords)
    const tolerance = Math.max(1e-6, Math.abs(expected) * 1e-6)
    if (Math.abs(got - expected) > tolerance) {
      err('area-mismatch',
        `emitted area ${got.toFixed(2)} but boundary minus islands is ${expected.toFixed(2)}`)
    }
  }

  if (zeroLen > 0) {
    warn('zero-length-edges', `${zeroLen} consecutive identical coordinate(s)`)
  }

  return issues
}

export function validateFields(fields, log = () => {}) {
  log('Validate: checking emitted polygons...')

  const report = []
  let errors = 0, warnings = 0

  for (const f of fields) {
    const issues = validateField(f)
    if (!issues.length) continue
    report.push({ id: f.id, issues })
    for (const i of issues) {
      if (i.level === 'error') errors++; else warnings++
      log(`  ${i.level.toUpperCase()} field ${f.id}: ${i.message}`)
    }
  }

  log(errors === 0 && warnings === 0
    ? `Validate: all ${fields.length} field(s) passed.`
    : `Validate: ${errors} error(s), ${warnings} warning(s) across ${report.length} field(s).`)

  return { report, errors, warnings }
}
