import { useRef, useState } from 'react'

export default function FileDropZone({ file, onFile }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function handleFile(f) {
    if (f && f.type === 'image/png') onFile(f)
    else if (f) alert('Please select a PNG file.')
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const zoneClass = [
    'rounded-lg p-3 text-center cursor-pointer transition-all select-none',
    dragging
      ? 'border-2 border-primary bg-accent'
      : file
        ? 'border-2 border-primary/40 bg-accent/40 hover:bg-accent/60'
        : 'border-2 border-dashed border-border bg-muted/40 hover:border-primary/50 hover:bg-accent/30',
  ].join(' ')

  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={zoneClass}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".png,image/png"
        className="hidden"
        onChange={e => handleFile(e.target.files[0])}
      />
      <svg
        className={['mx-auto mb-1.5', file ? 'text-primary' : 'text-muted-foreground'].join(' ')}
        width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      {file
        ? <p className="text-[12px] text-primary font-semibold truncate px-1">{file.name}</p>
        : <p className="text-[12px] text-muted-foreground">Drop PNG or click to browse</p>
      }
    </div>
  )
}
