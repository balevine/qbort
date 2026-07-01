import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Square, shadow-less icon button in the neo-brutalist language (hard border, invert on hover,
 * nudge on press). Defaults to 9×9; pass `className` to resize. Used for pager/roster controls.
 */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-9 items-center justify-center border-2 border-ink bg-paper text-ink transition-transform',
        'hover:bg-ink hover:text-paper active:translate-x-[1px] active:translate-y-[1px]',
        'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-paper disabled:hover:text-ink',
        className
      )}
      {...props}
    />
  )
)
IconButton.displayName = 'IconButton'
