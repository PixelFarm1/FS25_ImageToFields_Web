import { useState, useRef, useEffect, useCallback } from 'react'
import LogPanel from './components/LogPanel.jsx'
import ControlsPanel from './components/ControlsPanel.jsx'
import FieldCanvas from './components/FieldCanvas.jsx'
import { Badge } from './components/ui/badge.jsx'
import { translations } from './i18n.js'

export default function App() {
  const [file,                   setFile]                   = useState(null)
  const [demSize,                setDemSize]                = useState(2048)
  const [simplificationStrength, setSimplificationStrength] = useState(0.2)
  const [distanceThreshold,      setDistanceThreshold]      = useState(10)
  const [borderReduction,        setBorderReduction]        = useState(0)
  const [metersPerPixel,         setMetersPerPixel]         = useState(2)
  const [areaUnit,               setAreaUnit]               = useState('ha')
  const [lang,                   setLang]                   = useState('en')

  const [logs,       setLogs]       = useState([])
  const [isRunning,  setIsRunning]  = useState(false)
  const [fields,     setFields]     = useState(null)
  const [showLabels, setShowLabels] = useState(true)
  const [zipBuffer,  setZipBuffer]  = useState(null)

  const workerRef = useRef(null)
  const t = translations[lang]

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
    window.gtag?.('event', 'pipeline_started')

    const imageBuffer = await file.arrayBuffer()
    workerRef.current.postMessage(
      { type: 'RUN', payload: { imageBuffer, demSize, simplificationStrength, distanceThreshold, borderReduction, metersPerPixel } },
      [imageBuffer]
    )
  }

  function handleToggleLabels() { setShowLabels(prev => !prev) }

  return (
    <div className="flex flex-col w-screen h-screen bg-background overflow-hidden">

      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-[9px] bg-secondary flex-shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.20)]">
        <span className="text-[14px] font-bold text-secondary-foreground tracking-tight">
          {t.appTitle}
        </span>
        <Badge
          variant="outline"
          className="ml-1 border-[#3D8B67] text-[#52B788] bg-transparent text-[14px] px-2"
        >
          v0.2.0 - web
        </Badge>

        {/* Language toggle */}
        <div className="ml-auto flex gap-1">
          {['en', 'de'].map(l => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={[
                'text-[13px] font-medium px-2 py-[2px] rounded border transition-colors uppercase tracking-wide',
                lang === l
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground',
              ].join(' ')}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      {/* Body - three columns */}
      <div className="flex flex-1 min-h-0">

        {/* Log panel */}
        <div className="w-1/4 flex flex-col min-h-0 border-r border-border">
          <LogPanel logs={logs} t={t} />
        </div>

        {/* Controls panel */}
        <div className="w-1/4 flex flex-col min-h-0 border-r border-border">
          <ControlsPanel
            file={file} onFile={setFile}
            demSize={demSize} setDemSize={setDemSize}
            simplificationStrength={simplificationStrength} setSimplificationStrength={setSimplificationStrength}
            distanceThreshold={distanceThreshold} setDistanceThreshold={setDistanceThreshold}
            borderReduction={borderReduction} setBorderReduction={setBorderReduction}
            metersPerPixel={metersPerPixel} setMetersPerPixel={setMetersPerPixel}
            areaUnit={areaUnit} setAreaUnit={setAreaUnit}
            onRun={handleRun}
            onToggleLabels={handleToggleLabels}
            isRunning={isRunning}
            hasResult={!!fields}
            zipBuffer={zipBuffer}
            t={t}
          />
        </div>

        {/* Canvas panel */}
        <div className="w-1/2 flex flex-col min-h-0">
          <FieldCanvas
            fields={fields}
            showLabels={showLabels}
            areaUnit={areaUnit}
            t={t}
          />
        </div>

      </div>
    </div>
  )
}
