import { useEffect, useRef, useCallback } from 'react'
import { pointInRing } from '../../core/geom.js'

/** Pointer travel, in CSS pixels, above which a press counts as a pan not a click. */
const DRAG_SLOP = 5

/**
 * World-space footprint of the reference mask, centred on the origin.
 *
 * toWorld divides both axes by the same ratio = imageWidth / demSize, so the
 * mask spans exactly demSize world units across — but only demSize *
 * height/width down. It is a square just for a square mask; assuming a square
 * for everything stretches a 400x300 mask vertically against the vectors traced
 * from it.
 */
export function refWorldSize(image, demSize) {
  const w = demSize
  const h = demSize * (image.height / image.width)
  return { w, h }
}

// Watermelon UI, matching web/src/components/FieldCanvas.jsx: warm cream ground,
// flesh-red field boundaries, rind-green labels. The three overlay hues are new
// — the old canvas drew only the flattened polygon, so islands and bridges had
// no colours of their own — and are picked to stay legible against the cream.
const COL = {
  bg: '#FDF8F5',
  grid: '#EDD5CF',
  fill: 'rgba(230,57,70,0.07)',
  fillBad: 'rgba(230,57,70,0.18)',
  outer: '#E63946',
  outerBad: '#7F1D1D',
  island: '#1B4332',
  bridge: '#1D4ED8',
  chain: '#7C3AED',
  labelBg: 'rgba(27,67,50,0.88)',
  labelText: '#F0FAF5',
}

/**
 * Draws each field from its ring structure rather than the flattened output, so
 * the boundary, the islands and every bridge are separately visible. The old
 * canvas drew only the stitched polygon, which is exactly why a bridge running
 * across an island was invisible until it reached the editor.
 */
export default function FieldCanvas({
  fields, selected, onSelect,
  refImage = null, refVisible = false, refOpacity = 0.35, refDemSize = 2048,
}) {
  const ref = useRef(null)
  // `moved` accumulates pointer travel since mousedown. A press that travelled
  // more than DRAG_SLOP was a pan, not a click, so the click that the browser
  // fires afterwards is ignored — otherwise every drag also selected whatever
  // field happened to be nearest when the button came up.
  const view = useRef({
    tx: 0, ty: 0, scale: 1,
    drag: false, lx: 0, ly: 0, moved: 0, fitted: false,
  })

  const draw = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const { tx, ty, scale } = view.current
    const W = canvas.width, H = canvas.height

    ctx.fillStyle = COL.bg
    ctx.fillRect(0, 0, W, H)

    // Same 40-unit grid and hairline weight as the main app's canvas; the
    // guard just stops the loop from running away when zoomed far out.
    const step = 40 * scale
    if (step > 8) {
      ctx.strokeStyle = COL.grid
      ctx.lineWidth = 0.5
      ctx.beginPath()
      for (let x = ((tx % step) + step) % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
      for (let y = ((ty % step) + step) % step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
      ctx.stroke()
    }

    // Reference mask, underneath the vectors.
    if (refVisible && refImage) {
      const { w: worldW, h: worldH } = refWorldSize(refImage, refDemSize)
      ctx.save()
      ctx.globalAlpha = refOpacity
      // Crisp pixels when magnified, so the staircase the simplifier is being
      // judged against stays visible; smoothed when minified, to avoid aliasing.
      ctx.imageSmoothingEnabled = scale < 1
      ctx.drawImage(
        refImage,
        tx - (worldW / 2) * scale, ty - (worldH / 2) * scale,
        worldW * scale, worldH * scale)
      ctx.restore()
    }

    if (!fields?.length) return

    const P = (f, p) => [tx + (f.centerX + p.x) * scale, ty + (f.centerY + p.y) * scale]
    const path = (f, ring) => {
      ctx.beginPath()
      const [x0, y0] = P(f, ring[0])
      ctx.moveTo(x0, y0)
      for (let i = 1; i < ring.length; i++) { const [x, y] = P(f, ring[i]); ctx.lineTo(x, y) }
      ctx.closePath()
    }

    for (const f of fields) {
      if (!f.rings?.length) continue
      const bad = f.issues?.some(i => i.level === 'error')
      const sel = selected === f.id

      // Boundary minus islands, via even-odd so islands read as holes.
      ctx.beginPath()
      for (const ring of f.rings) {
        const [x0, y0] = P(f, ring[0])
        ctx.moveTo(x0, y0)
        for (let i = 1; i < ring.length; i++) { const [x, y] = P(f, ring[i]); ctx.lineTo(x, y) }
        ctx.closePath()
      }
      ctx.fillStyle = bad ? COL.fillBad : COL.fill
      ctx.fill('evenodd')

      path(f, f.rings[0])
      ctx.strokeStyle = bad ? COL.outerBad : COL.outer
      ctx.lineWidth = sel ? 2.2 : 1.2
      ctx.stroke()

      for (const island of f.rings.slice(1)) {
        path(f, island)
        ctx.strokeStyle = COL.island
        ctx.lineWidth = 1
        ctx.stroke()
      }

      for (const b of f.bridges ?? []) {
        const [x1, y1] = P(f, b.from), [x2, y2] = P(f, b.to)
        ctx.beginPath()
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
        ctx.strokeStyle = b.fromRing === 0 ? COL.bridge : COL.chain
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    // Rounded rind-green chips, as in the main app's canvas.
    if (scale > 0.08) {
      ctx.font = '600 11px "Inter Variable", Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const f of fields) {
        const x = tx + f.centerX * scale, y = ty + f.centerY * scale
        if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue

        const text = String(f.id)
        const w = ctx.measureText(text).width + 12
        const h = 17, r = 4
        const rx = x - w / 2, ry = y - h / 2

        ctx.fillStyle = COL.labelBg
        ctx.beginPath()
        ctx.moveTo(rx + r, ry)
        ctx.arcTo(rx + w, ry, rx + w, ry + h, r)
        ctx.arcTo(rx + w, ry + h, rx, ry + h, r)
        ctx.arcTo(rx, ry + h, rx, ry, r)
        ctx.arcTo(rx, ry, rx + w, ry, r)
        ctx.closePath()
        ctx.fill()

        ctx.fillStyle = COL.labelText
        ctx.fillText(text, x, y + 0.5)
      }
    }
  }, [fields, selected, refImage, refVisible, refOpacity, refDemSize])

  const fit = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const f of fields ?? []) {
      for (const p of f.rings?.[0] ?? []) {
        const x = f.centerX + p.x, y = f.centerY + p.y
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
    // With no result yet, frame the reference mask so it can be inspected on
    // its own before a run.
    if (!isFinite(minX) && refImage && refVisible) {
      const { w, h } = refWorldSize(refImage, refDemSize)
      minX = -w / 2; maxX = w / 2
      minY = -h / 2; maxY = h / 2
    }
    if (!isFinite(minX)) return
    const pad = 40
    const scale = Math.min(
      (canvas.width - pad * 2) / Math.max(1, maxX - minX),
      (canvas.height - pad * 2) / Math.max(1, maxY - minY))
    view.current.scale = scale
    view.current.tx = canvas.width / 2 - ((minX + maxX) / 2) * scale
    view.current.ty = canvas.height / 2 - ((minY + maxY) / 2) * scale
    draw()
  }, [fields, draw, refImage, refVisible, refDemSize])

  const hasContent = !!fields?.length || (!!refImage && refVisible)

  // Resize to the element's real pixel size, then redraw.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      if (!view.current.fitted && hasContent) { view.current.fitted = true; fit() }
      else draw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw, fit, hasContent])

  // A fresh result should re-fit rather than keep the previous viewport.
  useEffect(() => {
    view.current.fitted = false
    if (fields?.length) { view.current.fitted = true; fit() }
    else draw()
  }, [fields, fit, draw])

  // Toggling the reference on with nothing else drawn should frame it, but an
  // opacity change — or a toggle while a result is on screen — must not move
  // the viewport the user has set up for comparison.
  useEffect(() => {
    if (!refVisible || !refImage || fields?.length) { draw(); return }
    if (!view.current.fitted) { view.current.fitted = true; fit() }
    else draw()
  }, [refVisible, refImage, refOpacity, refDemSize, fields, fit, draw])

  // Selecting a field frames it: centred and zoomed to its own extent, so a
  // small field in a large map is actually readable once picked.
  useEffect(() => {
    if (selected == null || !fields?.length) return
    const f = fields.find(x => x.id === selected)
    const canvas = ref.current
    if (!f || !canvas) return

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of f.rings?.[0] ?? []) {
      const x = f.centerX + p.x, y = f.centerY + p.y
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
    if (!isFinite(minX)) return

    const pad = 60
    const scale = Math.min(
      (canvas.width - pad * 2) / Math.max(1, maxX - minX),
      (canvas.height - pad * 2) / Math.max(1, maxY - minY))
    view.current.scale = scale
    view.current.tx = canvas.width / 2 - ((minX + maxX) / 2) * scale
    view.current.ty = canvas.height / 2 - ((minY + maxY) / 2) * scale
    draw()
  }, [selected, fields, draw])

  function onWheel(e) {
    const canvas = ref.current
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr
    const v = view.current
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const next = Math.max(0.01, Math.min(400, v.scale * factor))
    v.tx = mx - ((mx - v.tx) / v.scale) * next
    v.ty = my - ((my - v.ty) / v.scale) * next
    v.scale = next
    draw()
  }

  function onDown(e) {
    if (e.button !== 0) return
    const v = view.current
    v.drag = true
    v.lx = e.clientX; v.ly = e.clientY
    v.moved = 0
    ref.current.classList.add('dragging')
    ref.current.setPointerCapture?.(e.pointerId)
  }
  function onMove(e) {
    const v = view.current
    if (!v.drag) return
    const dx = e.clientX - v.lx, dy = e.clientY - v.ly
    v.moved += Math.abs(dx) + Math.abs(dy)
    const dpr = window.devicePixelRatio || 1
    v.tx += dx * dpr
    v.ty += dy * dpr
    v.lx = e.clientX; v.ly = e.clientY
    draw()
  }
  function onUp(e) {
    const v = view.current
    if (!v.drag) return
    v.drag = false
    ref.current?.classList.remove('dragging')
    ref.current?.releasePointerCapture?.(e?.pointerId)
  }

  function onClick(e) {
    // A pan ends in a click event too; only treat it as a selection if the
    // pointer effectively stayed put.
    if (view.current.moved > DRAG_SLOP) { view.current.moved = 0; return }
    if (!fields?.length) return

    const canvas = ref.current
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr
    const { tx, ty, scale } = view.current

    // World-space hit test: prefer a field the click actually landed inside,
    // and fall back to the nearest centre only when the click hit no field.
    const wx = (mx - tx) / scale, wy = (my - ty) / scale
    let hit = null, best = null, bd = Infinity
    for (const f of fields) {
      const local = { x: wx - f.centerX, y: wy - f.centerY }
      if (f.rings?.[0] && pointInRing(local, f.rings[0])) {
        const inIsland = f.rings.slice(1).some(r => pointInRing(local, r))
        if (!inIsland) { hit = f; break }
      }
      const d = Math.hypot(f.centerX - wx, f.centerY - wy)
      if (d < bd) { bd = d; best = f }
    }
    const picked = hit ?? (bd * scale < 60 ? best : null)
    onSelect(picked ? (picked.id === selected ? null : picked.id) : null)
  }

  return (
    <div className="canvas-wrap">
      <canvas
        ref={ref}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={onClick}
      />
      {!fields?.length && !(refImage && refVisible) && (
        <div className="empty">Drop a field mask and press Run.<br />Scroll to zoom, drag to pan.</div>
      )}
      {!!fields?.length && (
        <div className="legend">
          <span><i style={{ background: COL.outer }} />field boundary</span>
          <span><i style={{ background: COL.island }} />island</span>
          <span><i style={{ background: COL.bridge }} />bridge to boundary</span>
          <span><i style={{ background: COL.chain }} />island-to-island chain</span>
        </div>
      )}
    </div>
  )
}
