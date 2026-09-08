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
