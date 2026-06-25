import { useEffect, useRef } from 'react'
import { Badge } from './ui/badge.jsx'

export default function LogPanel({ logs }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="flex flex-col h-full bg-background">

      {/* Section header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <Badge variant="default" className="text-[14px] tracking-widest uppercase rounded-sm">
          Activity
        </Badge>
        {logs.length > 0 && (
          <span className="text-[14px] text-muted-foreground">{logs.length}</span>
        )}
      </div>

      {/* Log area */}
      <div className="flex-1 mx-2 mb-2 rounded-lg border border-border bg-card overflow-y-auto">
        {logs.length === 0 ? (
          <p className="text-[14px] text-muted-foreground text-center mt-6 px-2 leading-relaxed">
            Run the pipeline to see activity here.
          </p>
        ) : (
          <div className="p-2 font-mono text-[14px] leading-[1.85] space-y-px">
            {logs.map((line, i) => {
              const isError = line.startsWith('ERROR') || line.startsWith('Worker')
              return (
                <div
                  key={i}
                  className={isError ? 'text-destructive' : 'text-foreground/80'}
                >
                  {line}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

    </div>
  )
}
