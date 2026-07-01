import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The neo-brutalist black title strip used atop bordered boxes (confirm panel, prompt preview).
 * Optional `action` is right-aligned within the strip.
 */
export function SectionHeader({
  title,
  action,
  className
}: {
  title: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b-2 border-ink bg-ink px-3 py-1.5',
        className
      )}
    >
      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-paper">
        {title}
      </span>
      {action}
    </div>
  )
}
