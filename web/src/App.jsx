import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { zipSync, strToU8 } from 'fflate'
import FieldCanvas from './FieldCanvas.jsx'
import PrivacyNotice from './PrivacyNotice.jsx'
import { trackEvent } from './analytics.js'
import {
  NUMBERING_ORDERS, NUMBERING_LABELS,
  RADIAL_STEPS, RADIAL_CORNERS, RADIAL_CORNER_LABELS,
} from '../../core/numbering.js'
// The importer script ships with the coordinates: the XML is useless in the
// Giants Editor without it, and telling people to go and find it in the
// repository is a step that gets missed.
import luaScript from '../../coordinatesToFields.lua?raw'

const DEM_SIZES = [1024, 2048, 4096, 8192]

const VERSION = '0.3.0'

/** Explanations shown on hover. "wu" in particular is not self-evident. */
const TIP = {
  mask: 'The black-and-white image to trace. White pixels are field, black is everything else.',
  dem: 'Resolution of your map\'s DEM.png minus 1 — a 4097x4097 DEM means 4096. This sets the ' +
       'world scale: the mask is stretched across a DEM-sized square, so a 1024px and an 8192px ' +
       'mask produce the same coordinates at the same setting.',
  simplify: 'How aggressively boundary points are removed (Ramer-Douglas-Peucker tolerance, in ' +
            'world units). Capped per ring at 2% of that ring\'s own size, so small islands keep ' +
            'their shape at settings that noticeably thin a large boundary. 0 disables it.',
  clearance: 'Pulls field boundaries inward and grows islands outward by this many world units, ' +
             'leaving machinery the same clearance around a tree island as at the field edge. ' +
             '0 traces the mask exactly.',
  radialCorner: 'The corner the numbering grows out from.',
  paint: 'Draw lines across the map — along roads, rivers, however you already think about it ' +
         '— and the areas between them become regions. Fields are numbered region by region, ' +
         'outward from a corner within each. A line has to reach the edge of the map, or ' +
         'another line, to actually divide anything.',
  radialSteps: 'How many rings the distance from that corner is divided into. Fields in the ' +
               'innermost ring are numbered first; within a ring the numbering sweeps round ' +
               'the arc, so more rings means the order follows distance more closely.',
  numbering: 'What order the field IDs run in. Detection order numbers each field by its ' +
             'single topmost pixel, which is why it can look arbitrary; the reading orders ' +
             'group fields into rows or columns first so neighbours get neighbouring numbers.',
  upp: 'How many world units one pixel of your mask covers. One Giants unit is one metre, so ' +
       'this is what turns the traced geometry into the hectare figures. Whole numbers only, ' +
       'and it never changes the geometry — only the reported areas.',
  refShow: 'Draw the uploaded mask underneath the field outlines, to compare the traced result ' +
           'against the pixels it came from.',
  refOpacity: 'How strongly the reference mask shows through.',

  fields: 'Field polygons found in the mask, after any that sit inside an island were dropped.',
  islands: 'Non-field areas fully enclosed by a field — trees, ponds, rocks.',
  toBoundary: 'Bridges connecting an island cluster to the field boundary. One per cluster.',
  chained: 'Bridges connecting one island directly to another. Chaining islands keeps bridges ' +
           'short and stops them crossing other islands.',
  bridgeLength: 'Total length of all bridges, in world units (wu) — the coordinate unit the ' +
                'Giants Editor uses. Shorter is better: every bridge is a zero-width slit cut ' +
                'into the field.',
  points: 'Total coordinates across all fields in the exported XML.',
  errors: 'Geometry problems found by validation — a bridge over non-field area, an unclosed ' +
          'ring, a bad winding. Anything above 0 is worth investigating before importing.',
  elapsed: 'Time the pipeline itself took, excluding decoding the image.',
}

function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The coordinates plus the editor script that imports them. */
export function buildOutputZip(xml) {
  return zipSync({
    'final_field_coordinates.xml': strToU8(xml),
    'coordinatesToFields.lua': strToU8(luaScript),
  }, { level: 6 })
}

const fmtHa = m2 => {
  const ha = m2 / 10000
  return ha >= 100 ? Math.round(ha).toLocaleString() : ha.toFixed(1)
}

export default function App() {
  const [file, setFile] = useState(null)
  const [demSize, setDemSize] = useState(4096)
  const [simplification, setSimplification] = useState(0.7)
  const [clearance, setClearance] = useState(0)
  const [unitsPerPixel, setUnitsPerPixel] = useState(1)
  const [numbering, setNumbering] = useState('radial')
  const [strokes, setStrokes] = useState([])
  const [painting, setPainting] = useState(false)
  const [radialCorner, setRadialCorner] = useState('nw')
  const [radialSteps, setRadialSteps] = useState(RADIAL_STEPS.default)

  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  const [over, setOver] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)

  // Reference underlay: the uploaded mask, drawn beneath the vectors.
  const [refImage, setRefImage] = useState(null)
  const [refVisible, setRefVisible] = useState(true)
  const [refOpacity, setRefOpacity] = useState(0.4)
  // The DEM size the on-screen result was produced with. Using the live slider
  // instead would slide the underlay out of register the moment it changed.
  const [ranDemSize, setRanDemSize] = useState(null)

  const worker = useRef(null)
  const logEnd = useRef(null)
  const liveBitmap = useRef(null)
  const rowRefs = useRef(new Map())

  useEffect(() => {
    worker.current = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    worker.current.onmessage = ({ data }) => {
      if (data.type === 'LOG') setLogs(l => [...l, data.message])
      else if (data.type === 'DONE') {
        setResult(data)
        setRunning(false)
        trackEvent('pipeline_completed', {
          fields: data.stats.fields,
          islands: data.stats.islands,
          errors: data.stats.errors,
        })
      } else if (data.type === 'ERROR') {
        setLogs(l => [...l, `ERROR: ${data.message}`])
        setRunning(false)
        trackEvent('pipeline_failed')
      }
    }
    worker.current.onerror = e => {
      setLogs(l => [...l, `Worker error: ${e.message}`])
      setRunning(false)
    }
    return () => worker.current?.terminate()
  }, [])

  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }) }, [logs])

  // Decode the mask once for the underlay. An ImageBitmap draws far faster than
  // an <img> when it is redrawn on every pan frame, which matters at 8192².
  // The live bitmap is tracked in a ref so the previous one can be released
  // without putting a side effect inside a state updater.
  useEffect(() => {
    if (!file) {
      liveBitmap.current?.close?.()
      liveBitmap.current = null
      setRefImage(null)
      return
    }
    let cancelled = false
    createImageBitmap(file).then(bmp => {
      if (cancelled) { bmp.close?.(); return }
      liveBitmap.current?.close?.()
      liveBitmap.current = bmp
      setRefImage(bmp)
    }).catch(() => { if (!cancelled) setRefImage(null) })
    return () => { cancelled = true }
  }, [file])

  // Keep the selected row in view when the selection came from the canvas.
  useEffect(() => {
    if (selected == null) return
    rowRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const run = useCallback(async () => {
    if (!file || running) return
    setRunning(true); setResult(null); setSelected(null); setLogs([])
    setRanDemSize(demSize)
    trackEvent('pipeline_started', { demSize, simplification, clearance, numbering, strokes: strokes.length })
    const buffer = await file.arrayBuffer()
    worker.current.postMessage(
      { type: 'RUN', imageBuffer: buffer,
        options: { demSize, simplification, clearance, unitsPerPixel,
                   numbering, radialCorner, radialSteps, strokes } },
      [buffer])
  }, [file, running, demSize, simplification, clearance, unitsPerPixel,
      numbering, radialCorner, radialSteps, strokes])

  function pick(f) {
    if (f && /\.png$/i.test(f.name)) { setFile(f); setResult(null); setLogs([]); setSelected(null) }
  }

  const stats = result?.stats
  const chained = stats ? stats.bridges - stats.bridgesToBoundary : 0
  const totalAreaM2 = useMemo(
    () => result?.fields.reduce((s, f) => s + f.areaM2, 0) ?? 0,
    [result])

  return (
    <div className="app">
      <header>
        <h1>ImageToFields</h1>
        <span className="tag">v{VERSION}</span>
        <span className="spacer" />
        <button className="headerlink" onClick={() => setPrivacyOpen(true)}>Privacy</button>
        <span className="note">{file ? file.name : 'no mask loaded'}</span>
      </header>

      <div className="body">
        {/* ---------------- controls ---------------- */}
        <div className="col left">
          <div className="section">
            <h2 className="tip" title={TIP.mask}>Field mask</h2>
            <label
              className={`drop${over ? ' over' : ''}`}
              onDragOver={e => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]) }}
            >
              <input type="file" accept="image/png" hidden
                     onChange={e => pick(e.target.files?.[0])} />
              <strong>{file ? file.name : 'Drop a PNG'}</strong>
              <small>{file ? 'click to replace' : 'white = field, black = everything else'}</small>
            </label>
          </div>

          <div className="section">
            <h2>Settings</h2>

            <div className="field">
              <label className="tip" htmlFor="dem" title={TIP.dem}>DEM size</label>
              <select id="dem" value={demSize} onChange={e => setDemSize(+e.target.value)}>
                {DEM_SIZES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            <div className="field">
              <label className="tip" htmlFor="simp" title={TIP.simplify}>Simplification</label>
              <input id="simp" type="range" min="0" max="2" step="0.05"
                     value={simplification} onChange={e => setSimplification(+e.target.value)} />
              <span className="val">{simplification.toFixed(2)}</span>
            </div>

            <div className="field">
              <label className="tip" htmlFor="clr" title={TIP.clearance}>Clearance</label>
              <input id="clr" type="range" min="0" max="10" step="0.5"
                     value={clearance} onChange={e => setClearance(+e.target.value)} />
              <span className="val">{clearance.toFixed(1)}</span>
            </div>

            <div className="field">
              <label className="tip" htmlFor="upp" title={TIP.upp}>Units per pixel</label>
              <input id="upp" type="number" min="1" step="1" inputMode="numeric"
                     value={unitsPerPixel}
                     onKeyDown={e => { if (e.key === '.' || e.key === ',' || e.key === 'e') e.preventDefault() }}
                     onChange={e => {
                       // Whole units only, so the spinner and the arrow keys
                       // both move by exactly one.
                       const v = parseInt(e.target.value, 10)
                       if (Number.isFinite(v) && v >= 1) setUnitsPerPixel(v)
                     }} />
            </div>

            <div className="field stack">
              <label className="tip" htmlFor="num" title={TIP.numbering}>Numbering</label>
              <select id="num" value={numbering} onChange={e => setNumbering(e.target.value)}>
                {NUMBERING_ORDERS.map(o => (
                  <option key={o} value={o}>{NUMBERING_LABELS[o]}</option>
                ))}
              </select>
            </div>


            {numbering === 'radial' && (
              <>
                <div className="field stack">
                  <label className="tip" htmlFor="corner" title={TIP.radialCorner}>Start corner</label>
                  <select id="corner" value={radialCorner}
                          onChange={e => setRadialCorner(e.target.value)}>
                    {RADIAL_CORNERS.map(c => (
                      <option key={c} value={c}>{RADIAL_CORNER_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="tip" htmlFor="rings" title={TIP.radialSteps}>Rings</label>
                  <input id="rings" type="number" inputMode="numeric"
                         min={RADIAL_STEPS.min} max={RADIAL_STEPS.max} step="1" value={radialSteps}
                         onChange={e => {
                           const v = parseInt(e.target.value, 10)
                           if (Number.isFinite(v)) {
                             setRadialSteps(Math.max(RADIAL_STEPS.min, Math.min(RADIAL_STEPS.max, v)))
                           }
                         }} />
                </div>
              </>
            )}

            {numbering === 'painted' && (
              <div className="paintbox">
                <button
                  className={`btn${painting ? ' primary' : ''}`}
                  title={TIP.paint}
                  onClick={() => setPainting(p => !p)}>
                  {painting ? 'Done painting' : 'Paint regions'}
                </button>
                <div className="paintrow">
                  <span>{strokes.length === 0
                    ? 'No lines yet'
                    : `${strokes.length} line${strokes.length > 1 ? 's' : ''}`}</span>
                  <button className="linkbtn" disabled={!strokes.length}
                          onClick={() => setStrokes(s => s.slice(0, -1))}>Undo</button>
                  <button className="linkbtn" disabled={!strokes.length}
                          onClick={() => setStrokes([])}>Clear</button>
                </div>
                {painting && (
                  <p className="hint">Drag to draw a dividing line. Middle-drag pans, wheel zooms.</p>
                )}
              </div>
            )}
          </div>

          <div className="section">
            <h2>Reference image</h2>
            <label className={`check${refImage ? '' : ' disabled'}`} title={TIP.refShow}>
              <input type="checkbox" checked={refVisible && !!refImage} disabled={!refImage}
                     onChange={e => setRefVisible(e.target.checked)} />
              <span>Show uploaded mask</span>
            </label>
            <div className="field">
              <label className="tip" htmlFor="op" title={TIP.refOpacity}>Opacity</label>
              <input id="op" type="range" min="0.05" max="1" step="0.05"
                     value={refOpacity} disabled={!refImage || !refVisible}
                     onChange={e => setRefOpacity(+e.target.value)} />
              <span className="val">{refOpacity.toFixed(2)}</span>
            </div>
            {refImage && (
              <p className="hint">
                {refImage.width}×{refImage.height} px spanning {(ranDemSize ?? demSize).toLocaleString()} wu wide
                {refImage.width !== refImage.height &&
                  ` × ${Math.round((ranDemSize ?? demSize) * refImage.height / refImage.width).toLocaleString()} wu tall`}
              </p>
            )}
          </div>

          <div className="section">
            <button className="btn primary" onClick={run} disabled={!file || running}>
              {running ? 'Running…' : 'Run'}
            </button>
            <button className="btn" disabled={!result}
                    title="Downloads the field coordinates together with coordinatesToFields.lua, the script that imports them into the Giants Editor."
                    onClick={() => {
                      trackEvent('zip_downloaded')
                      download('fs25_fields.zip', buildOutputZip(result.xml), 'application/zip')
                    }}>
              Download .zip
            </button>
          </div>

          {stats && (
            <div className="section">
              <h2>Result</h2>
              <dl className="stats">
                <dt className="tip" title={TIP.fields}>Fields</dt>
                <dd>{stats.fields}</dd>

                <dt className="tip" title={TIP.islands}>Islands</dt>
                <dd>{stats.islands}</dd>

                <dt className="tip" title={TIP.toBoundary}>Bridges to boundary</dt>
                <dd>{stats.bridgesToBoundary}</dd>

                <dt className="tip" title={TIP.chained}>Island-to-island</dt>
                <dd>{chained}</dd>

                <dt className="tip" title={TIP.bridgeLength}>Bridge length</dt>
                <dd>{stats.bridgeLength.toFixed(0)} wu</dd>

                <dt className="tip" title={TIP.points}>Output points</dt>
                <dd>{stats.points.toLocaleString()}</dd>

                <dt className="tip" title={TIP.errors}>Errors</dt>
                <dd className={stats.errors ? 'bad' : 'good'}>{stats.errors}</dd>

                <dt className="tip" title={TIP.elapsed}>Elapsed</dt>
                <dd>{stats.elapsedMs.toLocaleString()} ms ({(stats.elapsedMs / 1000).toFixed(2)} s)</dd>
              </dl>
            </div>
          )}
        </div>

        {/* ---------------- canvas ---------------- */}
        <div className="col">
          <FieldCanvas
            fields={result?.fields}
            selected={selected}
            onSelect={setSelected}
            refImage={refImage}
            refVisible={refVisible}
            refOpacity={refOpacity}
            refDemSize={ranDemSize ?? demSize}
            drawing={painting && numbering === 'painted'}
            strokes={numbering === 'painted' ? strokes : []}
            onStroke={points => setStrokes(s => [...s, points])}
          />
        </div>

        {/* ---------------- fields + log ---------------- */}
        <div className="col right">
          <div className="panel-head">
            <h2>
              Fields {result ? `(${result.fields.length})` : ''}
              {result && <span className="sub">{fmtHa(totalAreaM2)} ha</span>}
            </h2>
          </div>

          <div className="list">
            {result?.fields.map(f => {
              const chain = f.bridges.filter(b => b.fromRing !== 0).length
              const err = f.issues.some(i => i.level === 'error')
              return (
                <div key={f.id}
                     ref={el => { el ? rowRefs.current.set(f.id, el) : rowRefs.current.delete(f.id) }}
                     className={`row${selected === f.id ? ' sel' : ''}${err ? ' err' : ''}`}
                     onClick={() => setSelected(selected === f.id ? null : f.id)}>
                  <span className="id">#{f.id}</span>
                  <span className="meta">
                    {f.pointCount} pts
                    {f.islandCount > 0 && ` · ${f.islandCount} island${f.islandCount > 1 ? 's' : ''}`}
                    {chain > 0 && <span className="pill chain">{chain} chained</span>}
                    {err && <span className="pill err">error</span>}
                  </span>
                  <span className="area">{(f.areaM2 / 10000).toFixed(1)} ha</span>
                </div>
              )
            })}
          </div>

          <div className="panel-head divider">
            <h2>Log</h2>
          </div>
          <pre className="log">
            {logs.map((l, i) => (
              <div key={i} className={/ERROR/.test(l) ? 'e' : /WARNING/.test(l) ? 'w' : ''}>{l}</div>
            ))}
            <div ref={logEnd} />
          </pre>
        </div>
      </div>

      <PrivacyNotice open={privacyOpen} onClose={setPrivacyOpen} />
    </div>
  )
}
