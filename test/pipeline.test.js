/**
 * Property tests over every fixture.
 *
 * These assert invariants rather than compare against golden output, so a
 * change that alters coordinates but keeps the geometry sound passes, while one
 * that opens a sliver or routes a bridge over an island fails — which is the
 * distinction a golden diff cannot make.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { fixtures } from '../fixtures/masks.js'
import { runPipeline } from '../core/pipeline.js'
import { area, signedArea2, properIntersect, pointInRing } from '../core/geom.js'
import { signedDistance } from '../core/labelPoint.js'
import { NUMBERING_ORDERS, RADIAL_CORNERS } from '../core/numbering.js'
import { buildRegions, fieldsExtent } from '../core/regions.js'
import { decomposeField } from '../audit.js'

const NAMES = Object.keys(fixtures)
const cache = new Map()

function run(name, options = {}) {
  const key = `${name}:${JSON.stringify(options)}`
  if (!cache.has(key)) {
    const image = fixtures[name]().toImage()
    cache.set(key, runPipeline(image, { demSize: image.width, ...options }))
  }
  return cache.get(key)
}

const crossCount = (p, q, ring) => {
  let n = 0
  for (let i = 0; i < ring.length; i++) {
    if (properIntersect(p, q, ring[i], ring[(i + 1) % ring.length])) n++
  }
  return n
}

// ---------------------------------------------------------------------------

test('every fixture emits a closed ring', () => {
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      const c = f.coordinates
      assert.ok(c.length >= 4, `${name} field ${f.id}: only ${c.length} points`)
      assert.deepEqual(
        { x: c[0].x, y: c[0].y },
        { x: c[c.length - 1].x, y: c[c.length - 1].y },
        `${name} field ${f.id}: ring does not close`)
    }
  }
})

test('emitted area equals boundary minus islands', () => {
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      const expected = area(f.rings[0]) - f.rings.slice(1).reduce((s, r) => s + area(r), 0)
      const got = area(f.coordinates)
      assert.ok(Math.abs(got - expected) < Math.max(1e-6, expected * 1e-9),
        `${name} field ${f.id}: emitted ${got}, expected ${expected}`)
    }
  }
})

test('winding is normalised — boundary CCW, islands CW', () => {
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      assert.ok(signedArea2(f.rings[0]) > 0, `${name} field ${f.id}: boundary not CCW`)
      f.rings.slice(1).forEach((r, i) => {
        assert.ok(signedArea2(r) < 0, `${name} field ${f.id}: island ${i} not CW`)
      })
    }
  }
})

test('no bridge crosses any ring', () => {
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      for (const b of f.bridges) {
        let crossings = 0
        for (const ring of f.rings) crossings += crossCount(b.from, b.to, ring)
        assert.equal(crossings, 0,
          `${name} field ${f.id}: bridge (${b.from.x},${b.from.y})->(${b.to.x},${b.to.y}) ` +
          `crosses geometry ${crossings} time(s)`)
      }
    }
  }
})

test('no bridge leaves the field or runs through an island', () => {
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      for (const b of f.bridges) {
        for (const t of [0.25, 0.5, 0.75]) {
          const s = { x: b.from.x + (b.to.x - b.from.x) * t, y: b.from.y + (b.to.y - b.from.y) * t }
          assert.ok(pointInRing(s, f.rings[0]),
            `${name} field ${f.id}: bridge leaves the field boundary`)
          f.rings.slice(1).forEach((r, i) => {
            assert.ok(!pointInRing(s, r),
              `${name} field ${f.id}: bridge passes through island ${i}`)
          })
        }
      }
    }
  }
})

test('both ends of every bridge are visited twice', () => {
  // This is what keeps the slit zero-width. A single visit means the walk cut
  // the corner coming back out and left a sliver of non-field area behind.
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      const counts = new Map()
      const key = p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`
      for (const c of f.coordinates) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1)
      for (const b of f.bridges) {
        assert.ok((counts.get(key(b.from)) ?? 0) >= 2,
          `${name} field ${f.id}: bridge entry visited once`)
        assert.ok((counts.get(key(b.to)) ?? 0) >= 2,
          `${name} field ${f.id}: bridge exit visited once`)
      }
    }
  }
})

test('every island is reachable from the boundary', () => {
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      assert.equal(f.bridges.length, f.rings.length - 1,
        `${name} field ${f.id}: ${f.bridges.length} bridge(s) for ${f.rings.length - 1} island(s)`)
    }
  }
})

test('validation passes on every fixture', () => {
  for (const name of NAMES) {
    const r = run(name)
    assert.equal(r.stats.errors, 0,
      `${name}: ${JSON.stringify(r.validation.report, null, 2)}`)
  }
})

// ---------------------------------------------------------------------------
// Behaviour specific to individual fixtures
// ---------------------------------------------------------------------------

test('fan-cluster: islands chain instead of fanning to the boundary', () => {
  const f = run('fan-cluster').fields[0]
  assert.equal(f.islandCount, 6)
  const toBoundary = f.bridges.filter(b => b.fromRing === 0).length
  assert.equal(toBoundary, 1,
    `expected one boundary bridge for the cluster, got ${toBoundary}`)
})

test('nested-field: a field inside an island is dropped', () => {
  const r = run('nested-field')
  assert.equal(r.fields.length, 1, 'the blob inside the island must not become a field')
  assert.equal(r.fields[0].islandCount, 1)
  assert.ok(r.warnings.some(w => /inside an island/.test(w)),
    'the drop should be reported, not silent')
})

test('tiny-islands: small islands keep their shape', () => {
  // A 3 px island traces to roughly a dozen vertices. Simplification must not
  // reduce it to a triangle or remove it: the cap on tolerance is relative to
  // each ring's own size precisely so that slider settings tuned for a big
  // boundary do not flatten small obstacles.
  const f = run('tiny-islands', { simplification: 1.0 }).fields[0]
  assert.ok(f.islandCount >= 5, `expected the small islands to survive, got ${f.islandCount}`)
  for (const island of f.rings.slice(1)) {
    assert.ok(island.length >= 4,
      `island collapsed to ${island.length} vertices`)
    assert.ok(area(island) > 0, 'island lost all of its area')
  }
})

test('dumbbell: clearance that pinches the neck splits the field', () => {
  const plain = run('dumbbell', { clearance: 0 })
  assert.equal(plain.fields.length, 1)

  const split = run('dumbbell', { clearance: 12 })
  assert.equal(split.fields.length, 2, 'the pinched neck should yield two polygons')
  assert.ok(split.warnings.some(w => /split into 2 parts/.test(w)))
  for (const f of split.fields) assert.equal(f.sourceId, 1)
})

test('island-near-edge: clearance grows islands as well as pulling the boundary in', () => {
  const before = run('island-near-edge', { clearance: 0 }).fields[0]
  const after = run('island-near-edge', { clearance: 4 }).fields[0]

  const islandArea = f => f.rings.slice(1).reduce((s, r) => s + area(r), 0)
  assert.ok(islandArea(after) > islandArea(before),
    'islands must expand under clearance, not stay flush against the machinery')
  assert.ok(area(after.rings[0]) < area(before.rings[0]),
    'the boundary must pull inward')
})

test('every label point sits inside its field', () => {
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      const p = { x: f.labelX, y: f.labelY }
      assert.ok(pointInRing(p, f.rings[0]),
        `${name} field ${f.id}: label is outside the field boundary`)
      f.rings.slice(1).forEach((r, i) => {
        assert.ok(!pointInRing(p, r),
          `${name} field ${f.id}: label sits inside island ${i}`)
      })
      assert.ok(f.labelClearance > 0,
        `${name} field ${f.id}: label has no clearance from the edges`)
    }
  }
})

test('c-shape: the label avoids the gap the centroid falls into', () => {
  // The whole point of the pole of inaccessibility rather than the centre: on
  // this shape the centroid is not in the field at all.
  const f = run('c-shape').fields[0]

  // Coordinates are relative to the field's centroid, so the origin is it.
  const centroidClearance = signedDistance(0, 0, f.rings)
  assert.ok(centroidClearance < 0,
    `fixture proves nothing — its centroid is already ${centroidClearance} inside`)

  assert.ok(signedDistance(f.labelX, f.labelY, f.rings) > 0,
    'label should be inside the field')
  // Roomy, not merely inside: the arm of the C is ~60 units thick.
  assert.ok(f.labelClearance > 20,
    `expected a roomy label spot, got clearance ${f.labelClearance}`)
})

test('grid: numbering orders read the way they say they do', () => {
  // Positions on the 3x3 grid, read left-to-right then top-to-bottom.
  const cells = order => {
    const fs = run('grid', { numbering: order }).fields
      .map(f => ({ id: f.id, x: f.centerX, y: f.centerY }))
      .sort((a, b) => a.y - b.y || a.x - b.x)
    return [fs.slice(0, 3), fs.slice(3, 6), fs.slice(6, 9)]
      .flatMap(row => row.sort((a, b) => a.x - b.x).map(f => f.id))
  }

  assert.deepEqual(cells('rows'), [1, 2, 3, 4, 5, 6, 7, 8, 9],
    'rows should number left to right, top to bottom')
  assert.deepEqual(cells('columns'), [1, 4, 7, 2, 5, 8, 3, 6, 9],
    'columns should number top to bottom, left to right')

  // Detection order is what looks scrambled — the fixture is only meaningful
  // if it actually differs from a clean reading order.
  assert.notDeepEqual(cells('source'), [1, 2, 3, 4, 5, 6, 7, 8, 9],
    'fixture proves nothing: detection order already reads cleanly')

  // Largest first: the deliberately tall field takes id 1.
  const byArea = run('grid', { numbering: 'area' }).fields
  const areas = byArea.map(f => f.areaM2)
  for (let i = 1; i < areas.length; i++) {
    assert.ok(areas[i] <= areas[i - 1] + 1e-6, 'area order should be descending')
  }
})

test('every numbering order produces ids 1..n exactly once', () => {
  for (const order of NUMBERING_ORDERS) {
    const ids = run('grid', { numbering: order }).fields.map(f => f.id).sort((a, b) => a - b)
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9], `${order} produced ${ids}`)
  }
})

test('radial: rings are numbered strictly outward from the chosen corner', () => {
  for (const corner of RADIAL_CORNERS) {
    const steps = 3
    const fields = run('grid', { numbering: 'radial', radialCorner: corner, radialSteps: steps }).fields
    const xs = fields.map(f => f.centerX), ys = fields.map(f => f.centerY)
    const ox = corner[1] === 'w' ? Math.min(...xs) : Math.max(...xs)
    const oy = corner[0] === 'n' ? Math.min(...ys) : Math.max(...ys)
    const dist = f => Math.hypot(f.centerX - ox, f.centerY - oy)
    const furthest = Math.max(...fields.map(dist))

    let previousMax = 0
    for (let s = 1; s <= steps; s++) {
      const lo = (furthest * (s - 1)) / steps
      const hi = (furthest * s) / steps
      const bucket = f => Math.min(steps - 1,
        Math.max(0, Math.floor((dist(f) / furthest) * steps)))
      const ring = fields.filter(f => bucket(f) === s - 1)
      if (!ring.length) continue
      const ids = ring.map(f => f.id)
      assert.ok(Math.min(...ids) > previousMax,
        `${corner}: ring ${s} overlaps an inner ring`)
      previousMax = Math.max(...ids)
    }

    // The field in the innermost occupied ring must come first overall.
    const first = fields.find(f => f.id === 1)
    assert.ok(dist(first) <= furthest / steps + 1e-6,
      `${corner}: field 1 is not in the innermost ring`)
  }
})

test('painted: strokes cut the map into regions, each a contiguous id block', () => {
  // Two lines across the grid fixture, crossing near the middle: four regions.
  const S = 4000
  const strokes = [
    [{ x: -S, y: 10 }, { x: 0, y: 40 }, { x: S, y: -20 }],
    [{ x: 20, y: -S }, { x: -10, y: 0 }, { x: 40, y: S }],
  ]
  const fields = run('grid', { numbering: 'painted', strokes }).fields
  const regions = buildRegions(strokes, fieldsExtent(
    fields.map(f => ({ centerX: f.centerX, centerY: f.centerY, outer: f.rings[0] }))))
  assert.ok(regions.count > 1, `expected the strokes to divide the map, got ${regions.count} region`)

  const byRegion = new Map()
  for (const f of fields) {
    const label = regions.labelAt(f.centerX, f.centerY)
    if (!byRegion.has(label)) byRegion.set(label, [])
    byRegion.get(label).push(f.id)
  }

  let previousMax = 0
  const inOrder = [...byRegion.values()].sort((a, b) => Math.min(...a) - Math.min(...b))
  for (const ids of inOrder) {
    const sorted = [...ids].sort((a, b) => a - b)
    assert.equal(sorted[sorted.length - 1] - sorted[0] + 1, sorted.length,
      `region ids are not contiguous: ${sorted}`)
    assert.ok(sorted[0] > previousMax, `region starting at ${sorted[0]} overlaps the previous one`)
    previousMax = sorted[sorted.length - 1]
  }
})

test('painted: with nothing drawn it is plain radial numbering', () => {
  const withNone = run('grid', { numbering: 'painted', strokes: [] }).fields
  const plain = run('grid', { numbering: 'radial' }).fields
  const ids = f => f.map(x => x.id)
  assert.deepEqual(ids(withNone), ids(plain))
})

test('painted: a stroke that divides nothing leaves one region', () => {
  // A short stub in the middle reaches no edge, so both sides stay connected.
  const fields = run('grid', {
    numbering: 'painted', strokes: [[{ x: -20, y: 0 }, { x: 20, y: 0 }]],
  }).fields
  const ids = fields.map(f => f.id).sort((a, b) => a - b)
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('the exported XML declares an origin inside its own field', () => {
  // The importer hangs nameIndicator and teleportIndicator off the field's
  // origin, so an origin outside the polygon puts the field's name marker and
  // its teleport target on open ground.
  for (const name of NAMES) {
    const xml = run(name).xml.final
    for (const m of xml.matchAll(/<Field ID="(\d+)"[^>]*>([\s\S]*?)<\/Field>/g)) {
      const ring = [...m[2].matchAll(/<coordinate X="([-\d.]+)" Y="([-\d.]+)"/g)]
        .map(c => ({ x: +c[1], y: +c[2] }))
      assert.ok(pointInRing({ x: 0, y: 0 }, ring),
        `${name} field ${m[1]}: XML origin is outside the polygon`)
    }
  }
})

test('re-origining leaves the polygon where it was', () => {
  // Moving the pivot must not move the field. origin + offset has to match the
  // absolute position the pipeline computed.
  for (const name of NAMES) {
    const r = run(name)
    for (const m of r.xml.final.matchAll(
      /<Field ID="(\d+)" X="([-\d.]+)" Y="([-\d.]+)">([\s\S]*?)<\/Field>/g)) {
      const f = r.fields.find(x => x.id === +m[1])
      const originX = +m[2], originY = +m[3]
      const first = [...m[4].matchAll(/<coordinate X="([-\d.]+)" Y="([-\d.]+)"/g)][0]
      const absX = originX + +first[1]
      const absY = originY + +first[2]
      assert.ok(Math.abs(absX - (f.centerX + f.coordinates[0].x)) < 0.02 &&
                Math.abs(absY - (f.centerY + f.coordinates[0].y)) < 0.02,
        `${name} field ${f.id}: polygon moved when the pivot did`)
    }
  }
})

test('audit round-trips the emitted format', () => {
  // The stitched output has to remain self-describing: mergeID markers plus
  // repeated vertices must be enough to recover the rings again.
  for (const name of NAMES) {
    for (const f of run(name).fields) {
      const d = decomposeField(f.coordinates)
      assert.equal(d.islands.length, f.islandCount,
        `${name} field ${f.id}: recovered ${d.islands.length} island(s), expected ${f.islandCount}`)
      assert.equal(d.bridges.length, f.bridges.length,
        `${name} field ${f.id}: recovered ${d.bridges.length} bridge(s)`)
    }
  }
})
