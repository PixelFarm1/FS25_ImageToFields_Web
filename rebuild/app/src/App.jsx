import { useState, useRef, useEffect, useCallback } from 'react'
import FieldCanvas from './FieldCanvas.jsx'

const DEM_SIZES = [1024, 2048, 4096, 8192]

function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const [file, setFile] = useState(null)
  const [demSize, setDemSize] = useState(4096)
  const [simplification, setSimplification] = useState(0.2)
  const [clearance, setClearance] = useState(0)
  const [metersPerPixel, setMetersPerPixel] = useState(2)

  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  const [over, setOver] = useState(false)

  const worker = useRef(null)
  const logEnd = useRef(null)

  useEffect(() => {
    worker.current = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    worker.current.onmessage = ({ data }) => {
      if (data.type === 'LOG') setLogs(l => [...l, data.message])
      else if (data.type === 'DONE') { setResult(data); setRunning(false) }
      else if (data.type === 'ERROR') {
        setLogs(l => [...l, `ERROR: ${data.message}`])
        setRunning(false)
      }
    }
    worker.current.onerror = e => {
      setLogs(l => [...l, `Worker error: ${e.message}`])
      setRunning(false)
    }
    return () => worker.current?.terminate()
  }, [])

  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }) }, [logs])

  const run = useCallback(async () => {
    if (!file || running) return
    setRunning(true); setResult(null); setSelected(null); setLogs([])
    const buffer = await file.arrayBuffer()
    worker.current.postMessage(
      { type: 'RUN', imageBuffer: buffer, options: { demSize, simplification, clearance, metersPerPixel } },
      [buffer])
  }, [file, running, demSize, simplification, clearance, metersPerPixel])

  function pick(f) {
    if (f && /\.png$/i.test(f.name)) { setFile(f); setResult(null); setLogs([]) }
  }

  const stats = result?.stats
  const chained = stats ? stats.bridges - stats.bridgesToBoundary : 0

  return (
    <div className="app">
      <header>
        <h1>ImageToFields</h1>
        <span className="tag">REBUILD</span>
        <span className="note">visibility-filtered island bridging · shares core/ with the CLI</span>
        <span className="spacer" />
        <span className="note">{file ? file.name : 'no mask loaded'}</span>
      </header>

      <div className="body">
        {/* ---------------- controls ---------------- */}
        <div className="col left">
          <div className="section">
            <h2>Field mask</h2>
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
              <label htmlFor="dem">DEM size</label>
              <select id="dem" value={demSize} onChange={e => setDemSize(+e.target.value)}>
                {DEM_SIZES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="simp">Simplification</label>
              <input id="simp" type="range" min="0" max="2" step="0.05"
                     value={simplification} onChange={e => setSimplification(+e.target.value)} />
              <span className="val">{simplification.toFixed(2)}</span>
            </div>

            <div className="field">
              <label htmlFor="clr">Clearance</label>
              <input id="clr" type="range" min="0" max="10" step="0.5"
                     value={clearance} onChange={e => setClearance(+e.target.value)} />
              <span className="val">{clearance.toFixed(1)}</span>
            </div>

            <div className="field">
              <label htmlFor="mpp">Metres / pixel</label>
              <input id="mpp" type="number" min="0.01" step="0.1" value={metersPerPixel}
                     onChange={e => { const v = +e.target.value; if (v > 0) setMetersPerPixel(v) }} />
            </div>
          </div>

          <div className="section">
            <button className="btn primary" onClick={run} disabled={!file || running}>
              {running ? 'Running…' : 'Run'}
            </button>
            <button className="btn" disabled={!result}
                    onClick={() => download('final_field_coordinates.xml', result.xml, 'application/xml')}>
              Download XML
            </button>
            <button className="btn" disabled={!result}
                    onClick={() => download('debug.svg', result.svg, 'image/svg+xml')}>
              Download debug SVG
            </button>
          </div>

          {stats && (
            <div className="section">
              <h2>Result</h2>
              <dl className="stats">
                <dt>Fields</dt><dd>{stats.fields}</dd>
                <dt>Islands</dt><dd>{stats.islands}</dd>
                <dt>Bridges to boundary</dt><dd>{stats.bridgesToBoundary}</dd>
                <dt>Island-to-island</dt><dd>{chained}</dd>
                <dt>Bridge length</dt><dd>{stats.bridgeLength.toFixed(0)} wu</dd>
                <dt>Output points</dt><dd>{stats.points.toLocaleString()}</dd>
                <dt>Errors</dt>
                <dd className={stats.errors ? 'bad' : 'good'}>{stats.errors}</dd>
                <dt>Elapsed</dt><dd>{stats.elapsedMs} ms</dd>
              </dl>
            </div>
          )}
        </div>

        {/* ---------------- canvas ---------------- */}
        <div className="col">
          <FieldCanvas fields={result?.fields} selected={selected} onSelect={setSelected} />
        </div>

        {/* ---------------- fields + log ---------------- */}
        <div className="col right">
          <div className="section" style={{ flex: 'none' }}>
            <h2>Fields {result ? `(${result.fields.length})` : ''}</h2>
          </div>
          <div className="list">
            {result?.fields.map(f => {
              const chain = f.bridges.filter(b => b.fromRing !== 0).length
              const err = f.issues.some(i => i.level === 'error')
              return (
                <div key={f.id}
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
          <div className="section" style={{ flex: 'none', borderTop: '1px solid var(--rule)', borderBottom: 0 }}>
            <h2>Log</h2>
          </div>
          <pre className="log" style={{ maxHeight: '34%' }}>
            {logs.map((l, i) => (
              <div key={i} className={/ERROR/.test(l) ? 'e' : /WARNING/.test(l) ? 'w' : ''}>{l}</div>
            ))}
            <div ref={logEnd} />
          </pre>
        </div>
      </div>
    </div>
  )
}
