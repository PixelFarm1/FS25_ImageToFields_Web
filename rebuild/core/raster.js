/**
 * Stage 1 — raster analysis.
 *
 * One connected-component pass over the field pixels and one over the
 * background, then the nesting between them is resolved directly instead of
 * being re-derived per field. This replaces the old stage 1 + stage 2 scan,
 * which walked the whole image once per field label (twice, counting
 * findHoles) and was O(fields x width x height).
 *
 * Nesting rule, per the spec: inside a field there can only be non-field area.
 * A field component enclosed by an island is therefore not a field at all, and
 * is dropped with a warning rather than emitted.
 */

/**
 * Two-pass union-find connected-component labelling, 4-connected.
 * Cheap on memory (no BFS queue that can grow to the size of the image) and
 * collects per-component statistics in the same pass that resolves labels.
 *
 * @param {Uint8Array} mask   one byte per pixel
 * @param {number} target     the value that counts as "inside"
 * @returns {{labels: Int32Array, count: number, comps: Array}}
 */
function labelComponents(mask, width, height, target) {
  const n = width * height
  const labels = new Int32Array(n)

  let parent = new Int32Array(4096)
  let nProvisional = 0

  function makeSet() {
    if (++nProvisional >= parent.length) {
      const bigger = new Int32Array(parent.length * 2)
      bigger.set(parent)
      parent = bigger
    }
    parent[nProvisional] = nProvisional
    return nProvisional
  }
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  function union(a, b) {
    a = find(a); b = find(b)
    if (a === b) return
    if (a < b) parent[b] = a; else parent[a] = b
  }

  // Pass 1 — provisional labels + equivalences from the west and north neighbours.
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      if (mask[i] !== target) continue
      const west  = x > 0 && mask[i - 1] === target ? labels[i - 1] : 0
      const north = y > 0 && mask[i - width] === target ? labels[i - width] : 0
      if (west && north) {
        labels[i] = west < north ? west : north
        if (west !== north) union(west, north)
      } else if (west) {
        labels[i] = west
      } else if (north) {
        labels[i] = north
      } else {
        labels[i] = makeSet()
      }
    }
  }

  // Pass 2 — collapse to root labels, compact ids to 1..count, gather stats.
  const remap = new Int32Array(nProvisional + 1)
  const comps = [null] // 1-based
  let count = 0

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      const provisional = labels[i]
      if (provisional === 0) continue
      const root = find(provisional)
      let id = remap[root]
      if (id === 0) {
        id = remap[root] = ++count
        // Row-major scan order means this first pixel is the topmost-leftmost one.
        comps.push({
          id, pixels: 0, sumX: 0, sumY: 0,
          minX: x, minY: y, maxX: x, maxY: y,
          startX: x, startY: y,
          touchesBorder: false,
        })
      }
      labels[i] = id
      const c = comps[id]
      c.pixels++
      c.sumX += x; c.sumY += y
      if (x < c.minX) c.minX = x
      if (x > c.maxX) c.maxX = x
      if (y > c.maxY) c.maxY = y
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) c.touchesBorder = true
    }
  }

  return { labels, count, comps }
}

/**
 * Threshold an RGBA buffer to a binary field mask.
 * 255 = field (white), 0 = background — matching the documented input format.
 */
export function thresholdRGBA(rgba, width, height, cutoff = 127) {
  const out = new Uint8Array(width * height)
  for (let i = 0, n = width * height; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
    out[i] = (r + g + b) / 3 > cutoff ? 255 : 0
  }
  return out
}

/**
 * Analyse a binary mask into fields and the islands each one contains.
 *
 * @param {Uint8Array} binary  255 = field, 0 = background
 * @returns {{
 *   width: number, height: number,
 *   fieldLabels: Int32Array, bgLabels: Int32Array,
 *   fields: Array<{id, label, pixels, centroidPx, startX, startY, islands: number[]}>,
 *   islands: Map<number, {label, owner, pixels, startX, startY}>,
 *   warnings: string[]
 * }}
 */
export function analyseRaster(binary, width, height, log = () => {}) {
  log('Raster: labelling field components...')
  const field = labelComponents(binary, width, height, 255)
  log(`Raster: ${field.count} field component(s).`)

  log('Raster: labelling background components...')
  const bg = labelComponents(binary, width, height, 0)
  log(`Raster: ${bg.count} background component(s).`)

  // Background regions that reach the image border are "outside the map".
  const outside = new Set()
  for (let id = 1; id <= bg.count; id++) {
    if (bg.comps[id].touchesBorder) outside.add(id)
  }

  const warnings = []

  // A component's topmost-leftmost pixel always has a north neighbour that
  // belongs to the region enclosing it: if that neighbour were part of the same
  // component, the component would have started a row higher. That single
  // lookup replaces the old per-field flood fill over the whole image.
  const enclosingOf = (comp, otherLabels) => {
    if (comp.startY === 0) return 0 // reached the top edge: enclosed by the outside
    return otherLabels[(comp.startY - 1) * width + comp.startX]
  }

  // Which fields are genuinely top-level?
  const fieldValid = new Uint8Array(field.count + 1)
  for (let id = 1; id <= field.count; id++) {
    const c = field.comps[id]
    const encl = enclosingOf(c, bg.labels)
    fieldValid[id] = (c.startY === 0 || c.touchesBorder || outside.has(encl)) ? 1 : 0
    if (!fieldValid[id]) {
      warnings.push(
        `Field component at pixel (${c.startX}, ${c.startY}) sits inside an island ` +
        `and was dropped — a field loop may only contain non-field area.`
      )
    }
  }

  // Islands: enclosed background regions, attributed to the field around them.
  const islands = new Map()
  const islandsByField = new Map()
  for (let id = 1; id <= bg.count; id++) {
    if (outside.has(id)) continue
    const c = bg.comps[id]
    const owner = enclosingOf(c, field.labels)
    if (owner === 0 || !fieldValid[owner]) continue // island of a dropped field
    islands.set(id, { label: id, owner, pixels: c.pixels, startX: c.startX, startY: c.startY })
    if (!islandsByField.has(owner)) islandsByField.set(owner, [])
    islandsByField.get(owner).push(id)
  }

  const fields = []
  for (let id = 1; id <= field.count; id++) {
    if (!fieldValid[id]) continue
    const c = field.comps[id]
    fields.push({
      label: id,
      pixels: c.pixels,
      centroidPx: { x: c.sumX / c.pixels, y: c.sumY / c.pixels },
      startX: c.startX, startY: c.startY,
      islands: islandsByField.get(id) ?? [],
    })
  }

  // Renumber sequentially so dropped components don't leave gaps in field IDs.
  fields.forEach((f, i) => { f.id = i + 1 })

  const totalIslands = fields.reduce((s, f) => s + f.islands.length, 0)
  log(`Raster: ${fields.length} field(s), ${totalIslands} island(s).`)
  for (const w of warnings) log(`  WARNING: ${w}`)

  return {
    width, height,
    fieldLabels: field.labels,
    bgLabels: bg.labels,
    fields, islands, warnings,
  }
}
