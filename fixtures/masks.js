/**
 * The synthetic field masks, as data. `generate.js` writes them out as PNGs;
 * the tests build them in memory and skip the file system entirely.
 */

export class Mask {
  constructor(width, height) {
    this.width = width; this.height = height
    this.data = new Uint8Array(width * height) // 0 = background, 1 = field
  }
  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    this.data[y * this.width + x] = v
  }
  /** Even-odd scanline fill of a polygon given as [[x, y], ...]. */
  polygon(pts, v = 1) {
    let minY = Infinity, maxY = -Infinity
    for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = []
      for (let i = 0, n = pts.length; i < n; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1))
        }
      }
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.set(x, y, v)
      }
    }
  }
  circle(cx, cy, r, v = 1) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, v)
      }
    }
  }
  rect(x0, y0, w, h, v = 1) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, v)
  }
  /** RGBA view, the shape the pipeline consumes. */
  toRGBA() {
    const rgba = new Uint8Array(this.width * this.height * 4)
    for (let i = 0; i < this.width * this.height; i++) {
      const c = this.data[i] ? 255 : 0
      rgba[i * 4] = c; rgba[i * 4 + 1] = c; rgba[i * 4 + 2] = c; rgba[i * 4 + 3] = 255
    }
    return rgba
  }
  toImage() {
    return { width: this.width, height: this.height, rgba: this.toRGBA() }
  }
}

export const fixtures = {
  /**
   * The reported bug. A boundary with a concave notch and a cluster of islands
   * above it: every island's nearest boundary vertex is the notch tip, so the
   * old bridging fans out from one point and cuts through the islands between.
   */
  'fan-cluster': () => {
    const m = new Mask(512, 512)
    m.polygon([[40, 60], [460, 50], [470, 430], [300, 480], [256, 300], [200, 380], [50, 390]])
    for (const [cx, cy] of [[250, 240], [285, 245], [245, 200], [290, 200], [320, 255], [325, 285]]) {
      m.circle(cx, cy, 14, 0)
    }
    return m
  },

  /** Nested arcs of non-field, so an island sits behind another island. */
  spiral: () => {
    const m = new Mask(512, 512)
    m.circle(256, 256, 220)
    for (let a = 0; a <= 350; a++) {
      const rad = (a * Math.PI) / 180
      m.circle(256 + Math.cos(rad) * 160, 256 + Math.sin(rad) * 160, 11, 0)
    }
    for (let a = 180; a <= 530; a++) {
      const rad = (a * Math.PI) / 180
      m.circle(256 + Math.cos(rad) * 90, 256 + Math.sin(rad) * 90, 11, 0)
    }
    return m
  },

  /** An island close enough to the boundary that clearance should open it up. */
  'island-near-edge': () => {
    const m = new Mask(400, 400)
    m.rect(60, 60, 280, 280)
    m.circle(200, 200, 30, 0)
    m.circle(90, 200, 18, 0)
    return m
  },

  /**
   * A field inside an island. Per the spec this cannot exist — a field loop
   * contains only non-field area — so the inner blob must be dropped.
   */
  'nested-field': () => {
    const m = new Mask(400, 400)
    m.rect(50, 50, 300, 300)
    m.circle(200, 200, 80, 0)
    m.circle(200, 200, 30, 1)
    return m
  },

  /** Islands small enough that a careless simplifier flattens them. */
  'tiny-islands': () => {
    const m = new Mask(400, 400)
    m.rect(40, 40, 320, 320)
    for (const [cx, cy, r] of [[120, 120, 4], [200, 120, 6], [280, 120, 8],
                               [120, 260, 10], [200, 260, 3], [280, 260, 5]]) {
      m.circle(cx, cy, r, 0)
    }
    return m
  },

  /** Two fields, one plain and one with a single island. */
  'two-fields': () => {
    const m = new Mask(400, 300)
    m.rect(30, 40, 150, 200)
    m.rect(220, 40, 150, 200)
    m.circle(295, 140, 35, 0)
    return m
  },

  /**
   * A dumbbell: two lobes joined by a thin neck. Enough clearance pinches the
   * neck and the field has to split into two polygons.
   */
  dumbbell: () => {
    const m = new Mask(400, 200)
    m.circle(110, 100, 60)
    m.circle(290, 100, 60)
    m.rect(110, 94, 180, 12)
    return m
  },
}
