/**
 * Debug renderer — draws the field boundary, its islands and every bridge in
 * distinct colours so a mask can be checked without opening the Giants Editor.
 */

const ESC = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function renderDebugSVG(fields, { padding = 40, labels = true } = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const f of fields) {
    for (const c of f.coordinates) {
      const x = f.centerX + c.x, y = f.centerY + c.y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!isFinite(minX)) return '<svg xmlns="http://www.w3.org/2000/svg"/>'

  const w = maxX - minX + padding * 2
  const h = maxY - minY + padding * 2
  const vb = `${minX - padding} ${minY - padding} ${w} ${h}`
  const stroke = Math.max(w, h) / 900

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${Math.round(Math.min(2000, w))}">`,
    `<rect x="${minX - padding}" y="${minY - padding}" width="${w}" height="${h}" fill="#fdfaf7"/>`,
    `<style>text{font-family:monospace}</style>`,
  ]

  for (const f of fields) {
    const abs = pts => pts.map(p => `${(f.centerX + p.x).toFixed(2)},${(f.centerY + p.y).toFixed(2)}`).join(' ')
    const bad = f.issues?.some(i => i.level === 'error')

    // The emitted keyhole ring, filled with the even-odd rule so islands read
    // as holes exactly the way the stitched polygon intends them to.
    parts.push(
      `<polygon points="${abs(f.coordinates)}" fill="${bad ? '#f9d7d9' : '#e8f2ea'}" ` +
      `fill-rule="evenodd" stroke="${bad ? '#c62b37' : '#2d6a4f'}" stroke-width="${stroke}"/>`)

    // Islands, so a bridge running over one is obvious.
    for (const r of f.rings?.slice(1) ?? []) {
      parts.push(`<polygon points="${abs(r)}" fill="none" stroke="#b0741b" stroke-width="${stroke * 0.8}"/>`)
    }

    // Bridges on top, thick.
    for (const b of f.bridges ?? []) {
      const colour = b.fromRing === 0 ? '#1d4ed8' : '#0891b2'
      parts.push(
        `<line x1="${(f.centerX + b.from.x).toFixed(2)}" y1="${(f.centerY + b.from.y).toFixed(2)}" ` +
        `x2="${(f.centerX + b.to.x).toFixed(2)}" y2="${(f.centerY + b.to.y).toFixed(2)}" ` +
        `stroke="${colour}" stroke-width="${stroke * 2.2}" stroke-linecap="round"/>`)
    }

    if (labels) {
      parts.push(
        `<text x="${f.centerX.toFixed(2)}" y="${f.centerY.toFixed(2)}" font-size="${stroke * 12}" ` +
        `text-anchor="middle" fill="#1b4332">${ESC(`#${f.id}`)}</text>`)
    }
  }

  parts.push(
    `<g font-size="${stroke * 11}" fill="#42574b">`,
    `<text x="${minX}" y="${minY - padding * 0.45}">`,
    `green = field boundary · orange = island · blue = bridge to boundary · cyan = island-to-island chain`,
    `</text></g>`,
    '</svg>')
  return parts.join('\n')
}
