import { useEffect, useRef, useCallback } from 'react'

/**
 * Format a pre-computed area (m²) into the chosen display unit.
 */
function fmtArea(areaM2, unit) {
  if (unit === 'acres') {
    const acres = areaM2 / 10000 * 2.47105
    return acres >= 10 ? acres.toFixed(1) + ' ac' : acres.toFixed(2) + ' ac'
  }
  // hectares (default)
  const ha = areaM2 / 10000
  return ha >= 10 ? ha.toFixed(1) + ' ha' : ha.toFixed(2) + ' ha'
}

// Watermelon UI palette
const FS_GREEN   = '#E63946'
const FS_FILL    = 'rgba(230,57,70,0.07)'
const GRID_COLOR = '#EDD5CF'
const BG_COLOR   = '#FDF8F5'
const LABEL_BG   = 'rgba(27,67,50,0.88)'
const LABEL_TEXT = '#F0FAF5'

export default function FieldCanvas({ fields, showLabels, areaUnit = 'ha' }) {
  const canvasRef = useRef(null)
  const stateRef  = useRef({
    fields: [], showLabels: true, areaUnit: 'ha',
    transform: { tx: 0, ty: 0, scale: 1 },
    dragging: false, lastX: 0, lastY: 0,
  })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const { transform, fields, showLabels, areaUnit } = stateRef.current
    const { tx, ty, scale } = transform
    const W = canvas.width, H = canvas.height

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, W, H)

    // Grid
    const gridStep = 40 * scale
    const offX = ((tx % gridStep) + gridStep) % gridStep
    const offY = ((ty % gridStep) + gridStep) % gridStep
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 0.5
    for (let x = offX; x < W; x += gridStep) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let y = offY; y < H; y += gridStep) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }

    if (!fields.length) {
      ctx.fillStyle = '#A08E85'
      ctx.font = '13px "Inter Variable", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Run the pipeline to visualise fields', W / 2, H / 2)
      return
    }

    function worldToCanvas(wx, wy) {
      return [tx + wx * scale, ty + wy * scale]
    }

    fields.forEach(field => {
      if (!field.coordinates || field.coordinates.length === 0) return

      const pts = field.coordinates.map(c =>
        worldToCanvas(field.centerX + c.x, field.centerY + c.y)
      )

      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
      ctx.closePath()
      ctx.fillStyle = FS_FILL
      ctx.fill()
      ctx.strokeStyle = FS_GREEN
      ctx.lineWidth = 1.2
      ctx.stroke()

      if (!showLabels) return

      // Two-line label: "ID X" + "N nodes · area"
      const [lx, ly] = worldToCanvas(field.centerX, field.centerY)
      const nodeCount = field.coordinates.length
      const areaStr   = field.areaM2 != null ? fmtArea(field.areaM2, areaUnit) : ''
      const line1     = 'ID ' + field.id
      const line2     = nodeCount + ' nodes · ' + areaStr

      const fs1 = Math.max(9,   Math.min(13, scale * 3))
      const fs2 = Math.max(7.5, fs1 - 1.5)
      const pad = 7
      const lineGap = 3

      ctx.font = 'bold ' + fs1 + 'px "Inter Variable", sans-serif'
      const tw1 = ctx.measureText(line1).width
      ctx.font = fs2 + 'px "Inter Variable", sans-serif'
      const tw2 = ctx.measureText(line2).width

      const bw = Math.max(tw1, tw2) + pad * 2
      const bh = fs1 + fs2 + lineGap + pad * 2
      const rx = lx - bw / 2
      const ry = ly - bh / 2
      const cr = 4

      ctx.fillStyle = LABEL_BG
      ctx.beginPath()
      ctx.moveTo(rx + cr, ry)
      ctx.lineTo(rx + bw - cr, ry)
      ctx.quadraticCurveTo(rx + bw, ry, rx + bw, ry + cr)
      ctx.lineTo(rx + bw, ry + bh - cr)
      ctx.quadraticCurveTo(rx + bw, ry + bh, rx + bw - cr, ry + bh)
      ctx.lineTo(rx + cr, ry + bh)
      ctx.quadraticCurveTo(rx, ry + bh, rx, ry + bh - cr)
      ctx.lineTo(rx, ry + cr)
      ctx.quadraticCurveTo(rx, ry, rx + cr, ry)
      ctx.closePath()
      ctx.fill()

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const y1 = ry + pad + fs1 / 2
      ctx.font      = 'bold ' + fs1 + 'px "Inter Variable", sans-serif'
      ctx.fillStyle = LABEL_TEXT
      ctx.fillText(line1, lx, y1)

      const y2 = y1 + fs1 / 2 + lineGap + fs2 / 2
      ctx.font      = fs2 + 'px "Inter Variable", sans-serif'
      ctx.fillStyle = 'rgba(240,250,245,0.62)'
      ctx.fillText(line2, lx, y2)
    })
  }, [])

  useEffect(() => {
    stateRef.current.fields     = fields ?? []
    stateRef.current.showLabels = showLabels
    stateRef.current.areaUnit   = areaUnit
    if (fields && fields.length > 0) {
      fitToFields(fields)
    } else {
      draw()
    }
  }, [fields, showLabels, areaUnit, draw])

  function fitToFields(flds) {
    const canvas = canvasRef.current
    if (!canvas) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const f of flds) {
      for (const c of (f.coordinates ?? [])) {
        const wx = f.centerX + c.x, wy = f.centerY + c.y
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx)
        minY = Math.min(minY, wy); maxY = Math.max(maxY, wy)
      }
    }
    const W = canvas.width, H = canvas.height
    const margin = 40
    const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1
    const scale = Math.min((W - margin * 2) / rangeX, (H - margin * 2) / rangeY) * 0.92
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    stateRef.current.transform = {
      tx: W / 2 - cx * scale,
      ty: H / 2 - cy * scale,
      scale,
    }
    draw()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      draw()
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw])

  function onMouseDown(e) {
    stateRef.current.dragging = true
    stateRef.current.lastX = e.clientX
    stateRef.current.lastY = e.clientY
  }
  function onMouseMove(e) {
    const s = stateRef.current
    if (!s.dragging) return
    s.transform.tx += e.clientX - s.lastX
    s.transform.ty += e.clientY - s.lastY
    s.lastX = e.clientX
    s.lastY = e.clientY
    draw()
  }
  function onMouseUp() { stateRef.current.dragging = false }

  // Attach wheel with passive:false so preventDefault works
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function handleWheel(e) {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const s = stateRef.current.transform
      s.tx = mx + (s.tx - mx) * factor
      s.ty = my + (s.ty - my) * factor
      s.scale *= factor
      draw()
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [draw])

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex justify-between items-center px-3 py-[6px] bg-card border-b border-border text-[11px] uppercase tracking-widest">
        <span className="text-muted-foreground">Field visualisation</span>
        {fields && fields.length > 0 &&
          <span className="text-primary font-semibold">
            {fields.length} field{fields.length !== 1 ? 's' : ''} detected
          </span>
        }
      </div>
      <canvas
        ref={canvasRef}
        className="flex-1 w-full cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  )
}
