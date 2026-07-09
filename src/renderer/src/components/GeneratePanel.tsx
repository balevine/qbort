import { useEffect } from 'react'
import { AlertTriangle, Loader2, Play, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PulseDot } from '@/components/ui/pulse-dot'
import { SectionHeader } from '@/components/ui/section-header'
import { Stat } from '@/components/ui/stat'
import { useSettings } from '@/state/SettingsContext'
import { useGeneration } from '@/state/GenerationContext'
import { useSecretStatus } from '@/lib/useSecretStatus'
import { formatCost, formatDuration, formatInt } from '@/lib/format'
import { providerReadiness } from '@shared/readiness'
import { PROVIDER_LABELS } from '@shared/types'

interface GeneratePanelProps {
  onViewResults: () => void
  onClose: () => void
}

export function GeneratePanel({ onViewResults, onClose }: GeneratePanelProps) {
  const { settings } = useSettings()
  const { phase, estimate, progress, summary, error, elapsed, beginEstimate, confirmRun, cancel, reset } =
    useGeneration()
  const { secretStatus } = useSecretStatus()

  const readiness = settings ? providerReadiness(settings, secretStatus) : null

  // Fresh start whenever the modal opens (this panel mounts on open) — unless a run is still
  // streaming, in which case we keep showing its live progress.
  useEffect(() => {
    if (phase !== 'running') reset()
    // Only on open; reacting to `phase` would wipe a completed run's result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // No separate "generate" click: as soon as we're idle and the provider is ready, jump straight
  // to the cost estimate. A not-ready provider stays idle so we can show the reason below.
  useEffect(() => {
    if (phase === 'idle' && readiness?.ready) void beginEstimate()
  }, [phase, readiness?.ready, beginEstimate])

  if (!settings || !readiness) return null

  // Prefer the estimated fraction (includes in-flight streaming) so the bar moves during a
  // single batch; fall back to the committed ticket ratio.
  const pct = Math.min(
    100,
    Math.round(
      (progress.fraction > 0
        ? progress.fraction
        : progress.ticketsTotal > 0
          ? progress.ticketsDone / progress.ticketsTotal
          : 0) * 100
    )
  )

  // --- Confirm gate ---
  if (phase === 'confirm' && estimate) {
    return (
      <div className="space-y-3">
        <div className="border-2 border-ink">
          <SectionHeader title="Confirm run" />
          <dl className="divide-y-2 divide-ink/10 px-3 py-1 font-mono text-xs">
            <Row label="Provider / model" value={`${PROVIDER_LABELS[estimate.provider]} · ${estimate.model}`} />
            <Row label="Tickets" value={formatInt(settings.generation.numTickets)} />
            <Row label="Batches" value={formatInt(estimate.batches)} />
            <Row label="Est. tokens (in / out)" value={`${formatInt(estimate.estimatedInputTokens)} / ${formatInt(estimate.estimatedOutputTokens)}`} />
            <Row
              label="Est. cost"
              value={formatCost(estimate.estimatedCostUsd, { isLocal: estimate.isLocal, approx: true })}
              strong
            />
          </dl>
        </div>
        {!estimate.isLocal ? (
          <p className="flex items-start gap-1.5 text-[11px] text-ink/60">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Estimate only — actual cost depends on the model's real token usage.
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button variant="solid" onClick={confirmRun}>
            <Play className="h-4 w-4" />
            Start generation
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // --- Running ---
  if (phase === 'running') {
    // "Waiting" only until the model emits its first token; after that the bar moves.
    const streaming = progress.streamingTokens > 0 || progress.ticketsDone > 0
    const waiting = !streaming
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PulseDot />
            <span className="font-mono text-xs">
              {waiting ? 'Contacting the model…' : 'Generating tickets…'}
            </span>
          </div>
          <span className="font-mono text-[11px] text-ink/50">
            {progress.streamingTokens > 0 ? `${formatInt(progress.streamingTokens)} tok · ` : ''}
            {formatDuration(elapsed * 1000)}
          </span>
        </div>

        <div className="h-4 w-full overflow-hidden border-2 border-ink bg-paper">
          {waiting ? (
            <div className="tg-indeterminate h-full w-1/5 bg-ink" />
          ) : (
            <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
          )}
        </div>

        {waiting ? (
          <p className="text-[11px] text-ink/60">
            Waiting on the model's first token — this can take a minute on local models. No need
            to cancel.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <Stat label="Tickets" value={`${formatInt(progress.ticketsDone)} / ${formatInt(progress.ticketsTotal)}`} />
          <Stat label="Batches" value={`${formatInt(progress.batchesDone)} / ${formatInt(progress.batchesTotal)}`} />
          <Stat label="Retries" value={formatInt(progress.retries)} />
          <Stat label="Dropped" value={formatInt(progress.dropped)} />
        </div>
        {progress.errors.length > 0 ? (
          <p className="text-[11px] text-ink/60">{progress.errors.length} batch error(s) — partial results kept.</p>
        ) : null}
        <Button variant="outline" onClick={cancel}>
          <Square className="h-4 w-4" />
          Cancel
        </Button>
      </div>
    )
  }

  // --- Done ---
  if (phase === 'done') {
    return (
      <div className="space-y-3">
        <div className="border-2 border-ink bg-paper px-3 py-2 font-mono text-xs">{summary}</div>
        <div className="flex gap-2">
          <Button variant="solid" onClick={onViewResults}>
            View tickets
          </Button>
          <Button variant="ghost" onClick={reset}>
            Generate again
          </Button>
        </div>
      </div>
    )
  }

  // --- Error ---
  if (phase === 'error') {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 border-2 border-ink bg-paper px-3 py-2 text-xs text-ink">
          <X className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
        <Button variant="outline" onClick={reset}>
          Back
        </Button>
      </div>
    )
  }

  // --- Idle (transient) / estimating ---
  // Opening the modal lands here and auto-advances to the confirm gate. If the provider isn't
  // ready, we can't estimate — show why instead.
  if (!readiness.ready) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-ink/70">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {readiness.reason}
      </p>
    )
  }
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-ink/60">
      <Loader2 className="h-4 w-4 animate-spin" />
      Estimating cost…
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <dt className="text-ink/50">{label}</dt>
      <dd className={strong ? 'font-bold' : ''}>{value}</dd>
    </div>
  )
}
