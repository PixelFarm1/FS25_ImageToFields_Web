/**
 * Stages 1 & 2 — image converter + coordinate extraction.
 * Runs entirely in a Web Worker (uses OffscreenCanvas + createImageBitmap).
 */
import { fieldsToXML } from './xmlUtils.js'

// ---------------------------------------------------------------------------
// Stage 1 — label connected white components
// ---------------------------------------------------------------------------

/**
 * BFS connected-component labelling on a binary pixel array.
 * @param {Uint8Array} binary  255 = foreground, 0 = background
 * @param {number} width
 * @param {number} height
 * @returns {{ labels: Int32Array, count: number }}
 */
function labelComponents(binary, width, height) {
  const labels = new Int32Array(width * height)
  let nextLabel = 1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (binary[i] === 255 && labels[i] === 0) {
        const queue = [i]
        labels[i] = nextLabel
        let head = 0
        while (head < queue.length) {
          const idx = queue[head++]
          const cx = idx % width
          const cy = (idx / width) | 0
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = cx + dx, ny = cy + dy
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const ni = ny * width + nx
              if (binary[ni] === 255 && labels[ni] === 0) {
                labels[ni] = nextLabel
                queue.push(ni)
              }
            }
          }
        }
        nextLabel++
      }
    }
  }
  return { labels, count: nextLabel - 1 }
}

/**
 * Mark all background pixels reachable from the image border (true outside).
 */
function markOutside(labels, width, height) {
  const outside = new Uint8Array(width * height)
  const queue = []

  function seed(x, y) {
    const i = y * width + x
    if (labels[i] === 0 && !outside[i]) { outside[i] = 1; queue.push(i) }
  }

  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1) }
  for (let y = 0; y < height; y++) { seed(0, y); seed(width - 1, y) }

  let head = 0
  while (head < queue.length) {
    const idx = queue[head++]
    const cx = idx % width, cy = (idx / width) | 0
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = cx + dx, ny = cy + dy
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const ni = ny * width + nx
        if (labels[ni] === 0 && !outside[ni]) { outside[ni] = 1; queue.push(ni) }
      }
    }
  }
  return outside
}

// ---------------------------------------------------------------------------
// Stage 2 — Moore boundary tracing + coordinate extraction
// ---------------------------------------------------------------------------

// Clockwise Moore neighbourhood starting from East
const MDX = [1, 1, 0, -1, -1, -1,  0,  1]
const MDY = [0, 1, 1,  1,  0, -1, -1, -1]

function dirIndex(dx, dy) {
  for (let k = 0; k < 8; k++) if (MDX[k] === dx && MDY[k] === dy) return k
  return 0
}

/**
 * Moore boundary tracing — returns ordered contour of a binary region.
 * @param {Uint8Array} mask  1 = foreground
 * @param {number} startX  topmost-leftmost foreground pixel
 * @param {number} startY
 */
function traceContour(mask, startX, startY, width, height) {
  function at(x, y) {
    return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] > 0
  }

  const pts = [[startX, startY]]
  // Virtual background pixel entering from the left of the start
  let bx = startX - 1, by = startY
  let cx = startX, cy = startY
  const limit = width * height + 8

  for (let iter = 0; iter < limit; iter++) {
    const entryDir = dirIndex(bx - cx, by - cy)
    let found = false
    let lbx = cx + MDX[entryDir], lby = cy + MDY[entryDir]

    for (let i = 1; i <= 8; i++) {
      const d = (entryDir + i) % 8
      const nx = cx + MDX[d], ny = cy + MDY[d]
      if (at(nx, ny)) {
        bx = lbx; by = lby
        cx = nx;  cy = ny
        found = true
        break
      }
      lbx = cx + MDX[d]; lby = cy + MDY[d]
    }

    if (!found) break                           // isolated pixel
    if (cx === startX && cy === startY) break   // closed loop
    pts.push([cx, cy])
  }
  return pts
}

/**
 * Find hole contours for a specific field label.
 * Returns array of contour point arrays.
 */
function findHoles(labels, outside, fieldLabel, width, height) {
  const visited = new Uint8Array(width * height)
  const holes = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (labels[i] !== 0 || outside[i] || visited[i]) continue

      // BFS to collect this enclosed background component
      const component = [i]
      visited[i] = 1
      let head = 0, owner = -1

      while (head < component.length) {
        const idx = component[head++]
        const cx = idx % width, cy = (idx / width) | 0
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (labels[ni] !== 0) {
            if (owner === -1) owner = labels[ni]
          } else if (!outside[ni] && !visited[ni]) {
            visited[ni] = 1
            component.push(ni)
          }
        }
      }

      if (owner !== fieldLabel) continue

      // Build hole mask and find topmost pixel
      const holeMask = new Uint8Array(width * height)
      let startX = -1, startY = height
      for (const idx of component) {
        holeMask[idx] = 1
        const px = idx % width, py = (idx / width) | 0
        if (py < startY || (py === startY && px < startX)) { startX = px; startY = py }
      }
      holes.push(traceContour(holeMask, startX, startY, width, height))
    }
  }
  return holes
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stage 1: Convert PNG ArrayBuffer → labelled component data + coloured PNG blob.
 */
export async function stage1(imageBuffer, log) {
  log('Image analysis: Loading image...')
  const blob = new Blob([imageBuffer], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const { width, height } = bitmap

  const oc = new OffscreenCanvas(width, height)
  const ctx = oc.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, width, height)
  const pixels = imageData.data // RGBA

  log('Image analysis: Thresholding...')
  const binary = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2]
    binary[i] = ((r + g + b) / 3 > 127) ? 255 : 0
  }

  log('Image analysis: Labelling components...')
  const { labels, count } = labelComponents(binary, width, height)
  log(`Image analysis: Found ${count} field regions.`)

  // Build coloured output image (red channel = label index)
  const outData = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const lbl = labels[i]
    outData[i * 4]     = lbl > 0 ? lbl : 0   // R = label
    outData[i * 4 + 1] = 0
    outData[i * 4 + 2] = 0
    outData[i * 4 + 3] = 255
  }

  const outCanvas = new OffscreenCanvas(width, height)
  outCanvas.getContext('2d').putImageData(new ImageData(outData, width, height), 0, 0)
  const pngBlob = await outCanvas.convertToBlob({ type: 'image/png' })
  const pngBuffer = await pngBlob.arrayBuffer()

  log('Image analysis: Done.')
  return { labels, count, width, height, pngBuffer }
}

/**
 * Stage 2: Labels → world-space field coordinates XML.
 */
export function stage2(labelData, demSize, log) {
  const { labels, count, width, height } = labelData
  log('Creating coordinates: Computing centroid & contours for each field...')

  const ratio = width / demSize
  const outside = markOutside(labels, width, height)
  const fields = []

  for (let label = 1; label <= count; label++) {
    log(`Creating coordinates: Processing field ${label}/${count}...`)

    // Find centroid and topmost pixel
    let sumX = 0, sumY = 0, pixCount = 0
    let topX = -1, topY = height

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (labels[y * width + x] === label) {
          sumX += x; sumY += y; pixCount++
          if (y < topY || (y === topY && x < topX)) { topX = x; topY = y }
        }
      }
    }

    if (pixCount === 0) continue

    const cPixelX = sumX / pixCount
    const cPixelY = sumY / pixCount
    const centerX = parseFloat(((cPixelX - width / 2) / ratio).toFixed(2))
    const centerY = parseFloat(((cPixelY - height / 2) / ratio).toFixed(2))

    // Build mask and trace outer contour
    const mask = new Uint8Array(width * height)
    for (let i = 0; i < labels.length; i++) if (labels[i] === label) mask[i] = 1

    const outerPts = traceContour(mask, topX, topY, width, height)

    // Find hole contours
    const holePtArrays = findHoles(labels, outside, label, width, height)

    // Combine all points (gaps between outer/hole contours will be detected in stage 3)
    const allPts = [...outerPts, ...holePtArrays.flat()]

    // Convert to world coords relative to centre
    const coordinates = allPts.map(([px, py]) => [
      parseFloat(((px - width / 2) / ratio - centerX).toFixed(2)),
      parseFloat(((py - height / 2) / ratio - centerY).toFixed(2)),
    ])

    fields.push({ id: label, centerX, centerY, coordinates })
  }

  log(`Creating coordinates: Done — ${fields.length} fields processed.`)
  const xml = fieldsToXML(fields)
  return { fields, xml }
}
