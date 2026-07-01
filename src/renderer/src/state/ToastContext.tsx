import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createSafeContext } from '@/lib/createSafeContext'

type Tone = 'default' | 'error'
interface Toast {
  id: number
  message: string
  tone: Tone
}

interface ToastContextValue {
  toast: (message: string, tone?: Tone) => void
}

const [ToastContext, useToast] = createSafeContext<ToastContextValue>('Toast')
export { useToast }
const DURATION_MS = 3500

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const toast = useCallback((message: string, tone: Tone = 'default') => {
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, message, tone }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), DURATION_MS)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex max-w-sm items-start gap-2 border-2 border-ink bg-paper px-3 py-2 shadow-brutal',
              t.tone === 'error' && 'border-l-[6px]'
            )}
          >
            {t.tone === 'error' ? (
              <X className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="font-mono text-xs text-ink">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
