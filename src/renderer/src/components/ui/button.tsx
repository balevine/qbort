import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Neo-brutalist button: hard black border, square corners, solid offset shadow that
 * collapses on press. Monochrome only.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap border-2 border-ink rounded-none font-mono text-sm font-bold uppercase tracking-wide transition-[transform,box-shadow] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        solid: 'bg-ink text-paper shadow-brutal hover:bg-paper hover:text-ink',
        outline: 'bg-paper text-ink shadow-brutal hover:bg-ink hover:text-paper',
        ghost: 'border-transparent shadow-none bg-transparent hover:border-ink'
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10 p-0'
      }
    },
    defaultVariants: {
      variant: 'outline',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
)
Button.displayName = 'Button'

export { Button, buttonVariants }
