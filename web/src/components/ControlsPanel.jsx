import FileDropZone from './FileDropZone.jsx'
import SliderWithInput from './SliderWithInput.jsx'
import { Button } from './ui/button.jsx'
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from './ui/select.jsx'

export default function ControlsPanel({
  file, onFile,
  demSize, setDemSize,
  simplificationStrength, setSimplificationStrength,
  distanceThreshold, setDistanceThreshold,
  borderReduction, setBorderReduction,
  onRun, onToggleLabels,
  isRunning, hasResult, zipBuffer,
}) {
  function downloadZip() {
    if (!zipBuffer) return
    const url = URL.createObjectURL(new Blob([zipBuffer], { type: 'application/zip' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'fs25_fields_output.zip'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex flex-col h-full bg-background px-3 py-3 gap-3 overflow-y-auto">

      {/* Field mask PNG */}
      <section>
        <SectionLabel>Field mask PNG</SectionLabel>
        <FileDropZone file={file} onFile={onFile} />
      </section>

      {/* DEM size */}
      <section>
        <SectionLabel tooltip="Resolution of your DEM.png minus 1 pixel (e.g. 2049x2049 -> choose 2048)">
          DEM size
        </SectionLabel>
        <Select value={String(demSize)} onValueChange={v => setDemSize(parseInt(v))}>
          <SelectTrigger className="w-full text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1024, 2048, 4096, 8192].map(v => (
              <SelectItem key={v} value={String(v)} className="text-[13px]">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* Processing settings */}
      <section className="rounded-lg border border-border bg-card px-3 pt-3 pb-1">
        <SectionLabel>Processing settings</SectionLabel>
        <SliderWithInput
          label="Simplification strength"
          tooltip="Controls the Ramer-Douglas-Peucker tolerance. Higher = fewer polygon points."
          min={0} max={1} step={0.1}
          value={simplificationStrength}
          onChange={setSimplificationStrength}
          decimals={1}
        />
        <SliderWithInput
          label="Distance threshold"
          tooltip="Maximum gap between consecutive points before they are split into separate loops."
          min={0} max={20} step={1}
          value={distanceThreshold}
          onChange={setDistanceThreshold}
        />
      </section>

      {/* Action buttons */}
      <div className="mt-auto flex flex-col gap-1.5">
        <Button onClick={onRun} disabled={!file || isRunning} className="w-full">
          {isRunning ? <><SpinIcon /> Running...</> : <><PlayIcon /> Run</>}
        </Button>
        <Button onClick={onToggleLabels} disabled={!hasResult}
          variant="outline" size="sm" className="w-full text-[13px]">
          <TagIcon /> Toggle field IDs
        </Button>
        <Button onClick={downloadZip} disabled={!zipBuffer}
          variant="secondary" size="sm" className="w-full text-[13px]">
          <DownloadIcon /> Download .zip
        </Button>
      </div>

    </div>
  )
}

function SectionLabel({ children, tooltip }) {
  return (
    <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-[6px] font-medium"
       title={tooltip}>
      {children}
    </p>
  )
}

function PlayIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
}
function SpinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/>
    </svg>
  )
}
function TagIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
}
function DownloadIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}
