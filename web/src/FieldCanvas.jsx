import { useEffect, useRef, useCallback } from 'react'
import { pointInRing } from '../../core/geom.js'

/** Pointer travel, in CSS pixels, above which a press counts as a pan not a click. */
const DRAG_SLOP = 5

/**
 * Smooth zoom-and-pan interpolation (Van Wijk & Nuij 2003) — the path
 * d3.interpolateZoom uses.
 *
 * Interpolating centre and zoom separately does not work: zoom is
 * multiplicative and translation is additive, so whichever you ease, the other
 * misbehaves. Easing the pair with an ordinary ease-out is worse still — it is
 * roughly half finished in the first fifth of its time, which is why it reads
 * as a snap followed by a crawl rather than a glide.
 *
 * This treats the two as one path through (x, y, viewportWidth) space and
 * traverses it at constant *perceived* velocity: while zoomed out the camera
 * covers ground quickly, while zoomed in it slows, exactly as it looks like it
 * should. It also arcs outward on long moves — zooming out to cross, then back
 * in — instead of grinding across at full magnification.
 *
 * Each point is [centreX, centreY, viewport width in world units]. `S` is the
 * path length in the transformed space, which is the natural basis for how long
 * the move should take.
 */
export function smoothZoomPath(p0, p1) {
  const rho = Math.SQRT2, rho2 = 2, rho4 = 4
  const [ux0, uy0, w0] = p0
  const [ux1, uy1, w1] = p1
  const dx = ux1 - ux0, dy = uy1 - uy0
  const d2 = dx * dx + dy * dy

  // Same centre: a pure zoom, where the general solution degenerates.
  if (d2 < 1e-12) {
    const S = Math.abs(Math.log(w1 / w0)) / rho
    return {
      S,
      at: t => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S * Math.sign(Math.log(w1 / w0) || 1))],
    }
  }

  const d1 = Math.sqrt(d2)
  const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1)
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1)
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0)
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1)
  const S = (r1 - r0) / rho
  const coshr0 = Math.cosh(r0)

  return {
    S: Math.abs(S),
    at: t => {
      const s = t * S
      const u = (w0 / (rho2 * d1)) * (coshr0 * Math.tanh(rho * s + r0) - Math.sinh(r0))
      return [ux0 + u * dx, uy0 + u * dy, (w0 * coshr0) / Math.cosh(rho * s + r0)]
    },
  }
}

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
  // Region strokes: orange, so they never read as another thin red field edge.
  stroke: '#EA580C',
  strokeDraft: '#FB923C',
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
  drawing = false, strokes = [], onStroke = null,
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
  // The stroke being drawn right now, in world coordinates. Held in a ref so
  // every pointer move repaints without a React render per sample.
  const draftRef = useRef([])

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

    // Painted region dividers, over the fields they cut between.
    const drawStroke = (points, colour) => {
      if (points.length < 2) return
      ctx.beginPath()
      ctx.moveTo(tx + points[0].x * scale, ty + points[0].y * scale)
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(tx + points[i].x * scale, ty + points[i].y * scale)
      }
      ctx.strokeStyle = colour
      ctx.lineWidth = 3.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    for (const s of strokes) drawStroke(s, COL.stroke)
    if (draftRef.current.length > 1) drawStroke(draftRef.current, COL.strokeDraft)

    // Rounded rind-green chips, as in the main app's canvas.
    if (scale > 0.08) {
      ctx.font = '600 11px "Inter Variable", Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const f of fields) {
        // The pole of inaccessibility, not the centroid — on a crescent or a
        // field wrapped around a lake the centroid sits outside the field.
        const x = tx + (f.centerX + (f.labelX ?? 0)) * scale
        const y = ty + (f.centerY + (f.labelY ?? 0)) * scale
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
  }, [fields, selected, refImage, refVisible, refOpacity, refDemSize, strokes])

  // --- camera -------------------------------------------------------------
  // Held in refs so a running tween always calls the current draw and is not
  // restarted by an unrelated re-render.
  const drawRef = useRef(draw)
  drawRef.current = draw
  const animRef = useRef(0)

  const stopAnimation = useCallback(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = 0 }
  }, [])

  /** Place the camera so world point (cx, cy) sits at the canvas centre. */
  const applyCamera = useCallback((scale, cx, cy) => {
    const canvas = ref.current
    if (!canvas) return
    const v = view.current
    v.scale = scale
    v.tx = canvas.width / 2 - cx * scale
    v.ty = canvas.height / 2 - cy * scale
  }, [])

  /**
   * Glide the camera to a target framing.
   *
   * The centre is interpolated linearly but the scale geometrically: zoom is
   * multiplicative, so a linear ramp from 1x to 50x spends almost all its time
   * at the far end and reads as a lurch. Easing the exponent instead keeps the
   * apparent rate of magnification steady.
   */
  const animateTo = useCallback((scale, cx, cy) => {
    const canvas = ref.current
    if (!canvas) return
    stopAnimation()

    const v = view.current
    const fromScale = v.scale
    const fromCx = (canvas.width / 2 - v.tx) / v.scale
    const fromCy = (canvas.height / 2 - v.ty) / v.scale

    const path = smoothZoomPath(
      [fromCx, fromCy, canvas.width / fromScale],
      [cx, cy, canvas.width / scale])

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || path.S < 1e-3) {
      applyCamera(scale, cx, cy)
      drawRef.current()
      return
    }

    // Duration grows with the path length, so a nudge stays brisk and a jump
    // across the map takes its time, both at the same apparent speed. On a
    // 4096 DEM this puts a typical whole-map-to-field move around 1.4 s.
    const duration = Math.min(2200, Math.max(700, path.S * 750))

    const start = performance.now()
    const tick = now => {
      const t = Math.min(1, (now - start) / duration)
      // The path is already constant-velocity, so this only softens the two
      // ends — enough to stop the start and stop reading as abrupt.
      const [ux, uy, w] = path.at(t * t * (3 - 2 * t))
      applyCamera(canvas.width / w, ux, uy)
      drawRef.current()
      animRef.current = t < 1 ? requestAnimationFrame(tick) : 0
    }
    animRef.current = requestAnimationFrame(tick)
  }, [applyCamera, stopAnimation])

  useEffect(() => stopAnimation, [stopAnimation])

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
    // A fresh result is a new scene, not a move within one, so it snaps.
    stopAnimation()
    applyCamera(scale, (minX + maxX) / 2, (minY + maxY) / 2)
    draw()
  }, [fields, draw, refImage, refVisible, refDemSize, applyCamera, stopAnimation])

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
  //
  // Keyed on the identity of `fields`, not on the effect's dependencies: `draw`
  // is rebuilt whenever `selected` changes, which rebuilds `fit` with it, so
  // depending on those alone re-ran this on every selection and yanked the
  // camera back to the whole-map extent an instant before the tween started —
  // which is what made selecting a field look like a snap.
  const fittedFor = useRef(null)
  useEffect(() => {
    if (fields === fittedFor.current) { draw(); return }
    fittedFor.current = fields
    view.current.fitted = !!fields?.length
    if (fields?.length) fit()
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
  // small field in a large map is actually readable once picked. The camera
  // glides there rather than cutting, so it stays obvious where the view went.
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
    animateTo(scale, (minX + maxX) / 2, (minY + maxY) / 2)
  }, [selected, fields, animateTo])

  function onWheel(e) {
    stopAnimation() // the user's input always wins over a running tween
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

  /** Pointer position in world coordinates. */
  function toWorld(e) {
    const rect = ref.current.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const { tx, ty, scale } = view.current
    return {
      x: ((e.clientX - rect.left) * dpr - tx) / scale,
      y: ((e.clientY - rect.top) * dpr - ty) / scale,
    }
  }

  function startPan(e) {
    const v = view.current
    v.drag = true
    v.lx = e.clientX; v.ly = e.clientY
    v.moved = 0
    ref.current.classList.add('dragging')
    ref.current.setPointerCapture?.(e.pointerId)
  }

  function onDown(e) {
    stopAnimation()
    // Middle-drag always pans, so the map can still be moved without leaving
    // paint mode part-way through drawing a boundary.
    if (e.button === 1) { e.preventDefault(); startPan(e); return }
    if (e.button !== 0) return

    if (drawing) {
      draftRef.current = [toWorld(e)]
      ref.current.setPointerCapture?.(e.pointerId)
      return
    }
    startPan(e)
  }

  function onMove(e) {
    if (draftRef.current.length) {
      const p = toWorld(e)
      const last = draftRef.current[draftRef.current.length - 1]
      // Thin the samples: a stroke does not need a point per pixel of travel,
      // and the region raster cannot resolve them anyway.
      if (Math.hypot(p.x - last.x, p.y - last.y) * view.current.scale >= 3) {
        draftRef.current.push(p)
        draw()
      }
      return
    }

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
    if (draftRef.current.length) {
      const points = draftRef.current
      draftRef.current = []
      ref.current?.releasePointerCapture?.(e?.pointerId)
      // A click without travel is not a boundary.
      if (points.length > 1) onStroke?.(points)
      else draw()
      return
    }
    const v = view.current
    if (!v.drag) return
    v.drag = false
    ref.current?.classList.remove('dragging')
    ref.current?.releasePointerCapture?.(e?.pointerId)
  }

  function onClick(e) {
    // A pan ends in a click event too; only treat it as a selection if the
    // pointer effectively stayed put. Paint mode never selects.
    if (drawing) return
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
      const d = Math.hypot(f.centerX + (f.labelX ?? 0) - wx,
                           f.centerY + (f.labelY ?? 0) - wy)
      if (d < bd) { bd = d; best = f }
    }
    const picked = hit ?? (bd * scale < 60 ? best : null)
    onSelect(picked ? (picked.id === selected ? null : picked.id) : null)
  }

  return (
    <div className="canvas-wrap">
      <canvas
        ref={ref}
        className={drawing ? 'painting' : undefined}
        onContextMenu={e => e.preventDefault()}
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
