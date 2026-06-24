export default function SliderWithInput({ label, tooltip, min, max, step, value, onChange, decimals = 0 }) {
  const display = decimals > 0 ? parseFloat(value).toFixed(decimals) : parseInt(value)

  return (
    <div className="mb-4" title={tooltip}>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
        <span className="text-[11px] text-primary font-bold tabular-nums min-w-[28px] text-right">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(decimals > 0 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        className="w-full"
      />
    </div>
  )
}
