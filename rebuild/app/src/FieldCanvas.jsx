import { useEffect, useRef, useCallback } from 'react'

const COL = {
  bg: '#101613',
  grid: '#1b241f',
  fill: 'rgba(82,183,136,0.10)',
  fillBad: 'rgba(242,112,122,0.13)',
  outer: '#52b788',
  outerBad: '#f2707a',
  island: '#e0a44e',
  bridge: '#6aa9ff',
  chain: '#34d3c8',
  label: '#9fb3a7',
}

/**
 * Draws each field from its ring structure rather than the flattened output, so
 * the boundary, the islands and every bridge are separately visible. The old
 * canvas drew only the stitched polygon, which is exactly why a bridge running
 * across an island was invisible until it reached the editor.
 */
export default function FieldCanvas({ fields, selected, onSelect }) {
  const ref = useRef(null)
  const view = useRef({ tx: 0, ty: 0, scale: 1, drag: false, lx: 0, ly: 0, fitted: false })

  const draw = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const { tx, ty, scale } = view.current
    const W = canvas.width, H = canvas.height

    ctx.fillStyle = COL.bg
    ctx.fillRect(0, 0, W, H)

    const step = 50 * scale
    if (step > 8) {
      ctx.strokeStyle = COL.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = ((tx % step) + step) % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
      for (let y = ((ty % step) + step) % step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
      ctx.stroke()
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

    if (scale > 0.08) {
      ctx.fillStyle = COL.label
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      for (const f of fields) {
        const [x, y] = [tx + f.centerX * scale, ty + f.centerY * scale]
        if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue
        ctx.fillText(String(f.id), x, y)
      }
    }
  }, [fields, selected])

  const fit = useCallback(() => {
    const canvas = ref.current
    if (!canvas || !fields?.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const f of fields) {
      for (const p of f.rings?.[0] ?? []) {
        const x = f.centerX + p.x, y = f.centerY + p.y
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
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
  }, [fields, draw])

  // Resize to the element's real pixel size, then redraw.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      if (!view.current.fitted && fields?.length) { view.current.fitted = true; fit() }
      else draw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw, fit, fields])

  // A fresh result should re-fit rather than keep the previous viewport.
  useEffect(() => {
    view.current.fitted = false
    if (fields?.length) { view.current.fitted = true; fit() }
    else draw()
  }, [fields, fit, draw])

  // Centre the selected field without changing zoom.
  useEffect(() => {
    if (selected == null || !fields?.length) return
    const f = fields.find(x => x.id === selected)
    const canvas = ref.current
    if (!f || !canvas) return
    const { scale } = view.current
    view.current.tx = canvas.width / 2 - f.centerX * scale
    view.current.ty = canvas.height / 2 - f.centerY * scale
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
    view.current.drag = true
    view.current.lx = e.clientX; view.current.ly = e.clientY
    ref.current.classList.add('dragging')
  }
  function onMove(e) {
    const v = view.current
    if (!v.drag) return
    const dpr = window.devicePixelRatio || 1
    v.tx += (e.clientX - v.lx) * dpr
    v.ty += (e.clientY - v.ly) * dpr
    v.lx = e.clientX; v.ly = e.clientY
    draw()
  }
  function onUp() {
    view.current.drag = false
    ref.current?.classList.remove('dragging')
  }

  function onClick(e) {
    if (!fields?.length) return
    const canvas = ref.current
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr
    const { tx, ty, scale } = view.current
    let best = null, bd = Infinity
    for (const f of fields) {
      const d = Math.hypot(tx + f.centerX * scale - mx, ty + f.centerY * scale - my)
      if (d < bd) { bd = d; best = f }
    }
    if (best && bd < 200) onSelect(best.id === selected ? null : best.id)
  }

  return (
    <div className="canvas-wrap">
      <canvas
        ref={ref}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onClick={onClick}
      />
      {!fields?.length && (
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
