import { Label } from '@/components/ui/label'
import { clamp, cn } from '@/lib/utils'

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
  hint?: string
}

/** A labeled range slider paired with a numeric box, both bound to the same value. */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
  hint
}: SliderFieldProps) {
  const bound = (n: number) => clamp(Math.round(n), min, max)

  return (
    <div className={cn('space-y-2', disabled && 'opacity-60')}>
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(bound(Number(e.target.value)))}
          className="h-8 w-24 rounded-none border-2 border-ink bg-paper px-2 text-right font-mono text-sm text-ink disabled:cursor-not-allowed"
        />
      </div>
      <input
        type="range"
        className="brutal-range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(bound(Number(e.target.value)))}
      />
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-ink/40">
        <span>{min}</span>
        {hint ? <span className="normal-case tracking-normal text-ink/50">{hint}</span> : null}
        <span>{max}</span>
      </div>
    </div>
  )
}
