import { cn } from '@/lib/utils'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
  disabled?: boolean
  'aria-label'?: string
}

/** Neo-brutalist toggle: a hard-bordered track with a square knob. */
export function Switch({ checked, onCheckedChange, id, disabled, ...rest }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-none border-2 border-ink transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'bg-ink' : 'bg-paper'
      )}
      {...rest}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[18px] w-[18px] border-2 border-ink bg-paper transition-all',
          checked ? 'left-[24px]' : 'left-[2px]'
        )}
      />
    </button>
  )
}
