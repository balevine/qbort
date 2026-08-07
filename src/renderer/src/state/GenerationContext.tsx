import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTickets } from './TicketsContext'
import { errorMessage, formatDuration, formatInt, formatUsd } from '@/lib/format'
import { createSafeContext } from '@/lib/createSafeContext'
import type { CostEstimate, GenerationProgress } from '@shared/types'

export type GenerationPhase = 'idle' | 'estimating' | 'confirm' | 'running' | 'done' | 'error'

const EMPTY_PROGRESS: GenerationProgress = {
  ticketsDone: 0,
  ticketsTotal: 0,
  batchesDone: 0,
  batchesTotal: 0,
  retries: 0,
  dropped: 0,
  errors: [],
  streamingTokens: 0,
  fraction: 0
}

interface GenerationContextValue {
  phase: GenerationPhase
  estimate: CostEstimate | null
  progress: GenerationProgress
  summary: string | null
  error: string
  elapsed: number
  beginEstimate: () => Promise<void>
  confirmRun: () => Promise<void>
  cancel: () => void
  reset: () => void
}

const [GenerationContext, useGeneration] = createSafeContext<GenerationContextValue>('Generation')
export { useGeneration }

/**
 * Holds the entire generation run lifecycle so it survives the Generate modal being
 * opened/closed mid-run (progress keeps streaming; reopening shows the live state).
 */
export function GenerationProvider({ children }: { children: ReactNode }) {
  const { setFile } = useTickets()
  const [phase, setPhase] = useState<GenerationPhase>('idle')
  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [progress, setProgress] = useState<GenerationProgress>(EMPTY_PROGRESS)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const unsub = useRef<() => void>()

  useEffect(() => () => unsub.current?.(), [])

  // Elapsed-time ticker so the UI looks alive before the first batch returns.
  useEffect(() => {
    if (phase !== 'running') return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  const beginEstimate = useCallback(async () => {
    setError('')
    setPhase('estimating')
    try {
      setEstimate(await window.api.generation.estimate())
      setPhase('confirm')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('error')
    }
  }, [])

  const confirmRun = useCallback(async () => {
    setProgress(EMPTY_PROGRESS)
    setPhase('running')
    unsub.current = window.api.generation.onProgress(setProgress)
    try {
      const result = await window.api.generation.start()
      setFile(result.file, result.filePath)
      const { usage, generatedCount } = result.file.meta
      // In-app runs always record usage; guard anyway since the field is optional on the type.
      const usagePart = usage
        ? ` · ${formatInt(usage.totalTokens)} tokens · ${formatUsd(usage.actualCostUsd)} · ${formatDuration(usage.durationMs)}`
        : ''
      setSummary(
        `${formatInt(generatedCount)} tickets${usagePart}` + (result.cancelled ? ' · cancelled' : '')
      )
      setPhase('done')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('error')
    } finally {
      unsub.current?.()
    }
  }, [setFile])

  const cancel = useCallback(() => window.api.generation.cancel(), [])

  const reset = useCallback(() => {
    setPhase('idle')
    setEstimate(null)
    setProgress(EMPTY_PROGRESS)
    setSummary(null)
    setError('')
  }, [])

  return (
    <GenerationContext.Provider
      value={{ phase, estimate, progress, summary, error, elapsed, beginEstimate, confirmRun, cancel, reset }}
    >
      {children}
    </GenerationContext.Provider>
  )
}
