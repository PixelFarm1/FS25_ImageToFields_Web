import { useState, useRef, useEffect, useCallback } from 'react'
import LogPanel from './components/LogPanel.jsx'
import ControlsPanel from './components/ControlsPanel.jsx'
import FieldCanvas from './components/FieldCanvas.jsx'
import { Badge } from './components/ui/badge.jsx'

export default function App() {
  const [file,                   setFile]                   = useState(null)
  const [demSize,                setDemSize]                = useState(2048)
  const [simplificationStrength, setSimplificationStrength] = useState(0.2)
  const [distanceThreshold,      setDistanceThreshold]      = useState(10)
  const [borderReduction,        setBorderReduction]        = useState(0)

  const [logs,       setLogs]       = useState([])
  const [isRunning,  setIsRunning]  = useState(false)
  const [fields,     setFields]     = useState(null)
  const [showLabels, setShowLabels] = useState(true)
  const [zipBuffer,  setZipBuffer]  = useState(null)

  const workerRef = useRef(null)

  const appendLog = useCallback((msg) => setLogs(prev => [...prev, msg]), [])

  useEffect(() => {
    workerRef.current = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })

    workerRef.current.onmessage = (e) => {
      const { type, message, fields: resultFields, zipBuffer: zb } = e.data
      if (type === 'LOG') {
        appendLog(message)
      } else if (type === 'DONE') {
        setFields(resultFields)
        setZipBuffer(zb)
        setIsRunning(false)
      } else if (type === 'ERROR') {
        appendLog(`ERROR: ${message}`)
        setIsRunning(false)
      }
    }

    workerRef.current.onerror = (e) => {
      appendLog(`Worker error: ${e.message}`)
      setIsRunning(false)
    }

    return () => workerRef.current?.terminate()
  }, [appendLog])

  async function handleRun() {
    if (!file || isRunning) return
    setIsRunning(true)
    setFields(null)
    setZipBuffer(null)
    setLogs([])
    appendLog('Starting the tool...')

    const imageBuffer = await file.arrayBuffer()
    workerRef.current.postMessage(
      { type: 'RUN', payload: { imageBuffer, demSize, simplificationStrength, distanceThreshold, borderReduction } },
      [imageBuffer]
    )
  }

  function handleToggleLabels() { setShowLabels(prev => !prev) }

  return (
    <div className="flex flex-col w-screen h-screen bg-background overflow-hidden">

      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-[9px] bg-secondary flex-shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.20)]">
        <TractorIcon />
        <span className="text-[13.5px] font-bold text-secondary-foreground tracking-tight">
          FS25 Image to Fields
        </span>
        <Badge
          variant="outline"
          className="ml-1 border-[#3D8B67] text-[#52B788] bg-transparent text-[11px] px-2"
        >
          v0.2.0 - web
        </Badge>
      </header>

      {/* Body - three columns */}
      <div className="flex flex-1 min-h-0">

        {/* Log panel */}
        <div className="w-[175px] flex-shrink-0 flex flex-col min-h-0 border-r border-border">
          <LogPanel logs={logs} />
        </div>

        {/* Controls panel */}
        <div className="w-[242px] flex-shrink-0 flex flex-col min-h-0 border-r border-border">
          <ControlsPanel
            file={file} onFile={setFile}
            demSize={demSize} setDemSize={setDemSize}
            simplificationStrength={simplificationStrength} setSimplificationStrength={setSimplificationStrength}
            distanceThreshold={distanceThreshold} setDistanceThreshold={setDistanceThreshold}
            borderReduction={borderReduction} setBorderReduction={setBorderReduction}
            onRun={handleRun}
            onToggleLabels={handleToggleLabels}
            isRunning={isRunning}
            hasResult={!!fields}
            zipBuffer={zipBuffer}
          />
        </div>

        {/* Canvas panel */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <FieldCanvas
            fields={fields}
            showLabels={showLabels}
          />
        </div>

      </div>
    </div>
  )
}

function TractorIcon() {
  return (
    <svg width="28" height="22" viewBox="0 0 28 22" fill="none" aria-hidden="true">
      {/* rear large wheel */}
      <circle cx="9" cy="16" r="6" fill="#2D6A4F" />
      <circle cx="9" cy="16" r="3" fill="#1B4332" />
      <circle cx="9" cy="16" r="1.2" fill="#F9F4EF" />
      {/* body */}
      <rect x="7" y="6" width="13" height="9" rx="1.5" fill="#F9F4EF" />
      {/* cab */}
      <rect x="14" y="2" width="7" height="7" rx="1" fill="#F9F4EF" />
      {/* exhaust pipe */}
      <rect x="20" y="0" width="2" height="4" rx="1" fill="#A08E85" />
      {/* front small wheel */}
      <circle cx="22" cy="17" r="4" fill="#2D6A4F" />
      <circle cx="22" cy="17" r="2" fill="#1B4332" />
      <circle cx="22" cy="17" r="0.9" fill="#F9F4EF" />
      {/* hitch arm */}
      <rect x="1" y="14" width="8" height="2" rx="1" fill="#A08E85" />
    </svg>
  )
}
