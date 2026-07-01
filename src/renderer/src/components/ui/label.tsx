import * as React from 'react'
import { cn } from '@/lib/utils'

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('font-mono text-xs font-bold uppercase tracking-widest text-ink', className)}
    {...props}
  />
))
Label.displayName = 'Label'

export { Label }
