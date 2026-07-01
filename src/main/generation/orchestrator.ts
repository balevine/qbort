import type { GenerationProgress, Settings, Ticket } from '@shared/types'
import {
  DEFAULT_BATCH_SIZE,
  MAX_OUTPUT_TOKENS_CEILING,
  effectiveBatchSize,
  expectedBatchOutputTokens,
  maxOutputTokensForExpected
} from '@shared/generation'
import { compilePromptParts } from '@shared/promptCompiler'
import { ensureRoster, sampleResponseCounts } from '@shared/staff'
import { openingTimesForRun } from '@shared/time'
import { assembleTickets, validateTickets, type TimeContext } from './validate'
import { ProviderError, TruncationError, type GenerateBatchResult, type LLMProvider } from './providers'

/** Snapshot passed to `onBatchComplete` so the caller can persist incrementally. */
export interface BatchSnapshot {
  tickets: Ticket[]
  usage: { inputTokens: number; outputTokens: number; batches: number }
  dropped: number
  retries: number
}

export interface RunGenerationDeps {
  provider: LLMProvider
  settings: Settings
  signal: AbortSignal
  onProgress?: (p: GenerationProgress) => void
  onBatchComplete?: (snapshot: BatchSnapshot) => Promise<void> | void
  batchSize?: number
  concurrency?: number
  maxRetries?: number
  rng?: () => number
  /** Reference "now" (ms) for synthesized message timestamps; defaults to Date.now(). */
  now?: number
  /** Injectable (and abortable) sleep so backoff is testable. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export interface RunGenerationResult {
  tickets: Ticket[]
  usage: { inputTokens: number; outputTokens: number; batches: number }
  dropped: number
  retries: number
  errors: string[]
  cancelled: boolean
}

/** Exponential backoff (capped). Pure/deterministic; jitter is applied separately. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** (attempt - 1))
}

/**
 * Backoff with up to +25% random jitter (via the injectable rng) so concurrent batches that
 * hit a rate limit don't retry in lockstep and re-trigger it.
 */
export function backoffWithJitter(attempt: number, rng: () => number): number {
  return Math.round(backoffMs(attempt) * (1 + rng() * 0.25))
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface RetryBatchArgs {
  compiledPrompt: string
  staticPrefix: string
  dynamicSuffix: string
  count: number
  maxOutputTokens: number
}

async function generateBatchWithRetry(
  provider: LLMProvider,
  batchArgs: RetryBatchArgs,
  signal: AbortSignal,
  maxRetries: number,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  rng: () => number,
  onRetry: () => void,
  onToken: (info: { outputTokens: number }) => void
): Promise<GenerateBatchResult> {
  let attempt = 0
  let maxOutputTokens = batchArgs.maxOutputTokens
  for (;;) {
    try {
      return await provider.generateBatch({ ...batchArgs, maxOutputTokens, signal, onToken })
    } catch (err) {
      if (signal.aborted) throw err
      // Truncation: retrying with the same budget just truncates again. Grow `max_tokens` first;
      // once we're at the ceiling, give up here so the caller can split the batch into smaller
      // ones that fit. (An undefined budget can't be grown — split immediately.)
      if (err instanceof TruncationError) {
        if (maxOutputTokens !== undefined && maxOutputTokens < MAX_OUTPUT_TOKENS_CEILING && attempt < maxRetries) {
          maxOutputTokens = Math.min(MAX_OUTPUT_TOKENS_CEILING, Math.ceil(maxOutputTokens * 1.5))
          attempt++
          onRetry()
          await sleep(backoffWithJitter(attempt, rng), signal)
          if (signal.aborted) throw err
          continue
        }
        throw err
      }
      // ProviderError carries an explicit retryable flag (429/5xx). Anything else
      // (e.g. malformed JSON) is worth re-rolling a few times.
      const canRetry = err instanceof ProviderError ? err.retryable : true
      if (!canRetry || attempt >= maxRetries) throw err
      attempt++
      onRetry()
      await sleep(backoffWithJitter(attempt, rng), signal)
      // Cancellation can land while we were backing off — don't fire another request.
      if (signal.aborted) throw err
    }
  }
}

/**
 * Generate `numTickets` tickets in concurrent, retrying batches. Validates and assigns
 * sequential ids as each batch completes, streams progress, persists incrementally via
 * `onBatchComplete`, and stops cleanly on abort (keeping whatever was produced).
 */
export async function runGeneration(deps: RunGenerationDeps): Promise<RunGenerationResult> {
  const { provider, settings, signal } = deps
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const concurrency = deps.concurrency ?? 4
  const maxRetries = deps.maxRetries ?? 6
  const rng = deps.rng ?? Math.random
  const sleep = deps.sleep ?? abortableSleep
  const nowMs = deps.now ?? Date.now()

  const gen = settings.generation
  const total = Math.max(0, gen.numTickets)
  const roster = ensureRoster(settings.staffRoster, gen.numStaffMembers)

  // Pre-pick sorted opening times for the whole run and hand them out by id, so a ticket's
  // creation time rises with its id (ids beyond the requested count fall back to "now").
  const openingTimes = openingTimesForRun(total, gen.maxTicketAgeDays, nowMs, rng)
  const timeCtx: TimeContext = {
    nowMs,
    rng,
    openingMsForId: (id) => openingTimes[id - 1] ?? nowMs
  }

  // Shrink batches when staff responses make each ticket large, so a batch's expected output
  // fits the model's budget and doesn't get truncated (which would drop the whole batch).
  const effBatchSize = effectiveBatchSize(batchSize, gen.includeStaffResponses, gen.avgStaffResponses)

  // Split into batch specs.
  const specs: Array<{ id: number; count: number }> = []
  for (let start = 0; start < total; start += effBatchSize) {
    specs.push({ id: specs.length, count: Math.min(effBatchSize, total - start) })
  }

  const tickets: Ticket[] = []
  let nextId = 1
  let inputTokens = 0
  let outputTokens = 0
  let processedBatches = 0
  let dropped = 0
  let retries = 0
  const errors: string[] = []
  // In-flight batches: id → { streamed output tokens, target tokens, ticket count }.
  const active = new Map<number, { streamed: number; target: number; count: number }>()

  const emit = () => {
    let streamingTokens = 0
    let inflightTickets = 0
    for (const a of active.values()) {
      streamingTokens += a.streamed
      const frac = a.target > 0 ? Math.min(0.99, a.streamed / a.target) : 0
      inflightTickets += frac * a.count
    }
    const fraction = total > 0 ? Math.min(1, (tickets.length + inflightTickets) / total) : 0
    deps.onProgress?.({
      ticketsDone: tickets.length,
      ticketsTotal: total,
      batchesDone: processedBatches,
      batchesTotal: specs.length,
      retries,
      dropped,
      errors: errors.slice(),
      streamingTokens,
      fraction
    })
  }

  emit()

  // Produce one batch of `count` tickets under the given progress key, appending them to the run.
  // If the model truncates even at the max token budget, the batch is split in half and each
  // smaller batch retried — smaller batches produce less output and fit the budget.
  const collectBatch = async (specId: number, count: number): Promise<void> => {
    const responseCounts = gen.includeStaffResponses
      ? sampleResponseCounts(count, gen.avgStaffResponses, rng)
      : undefined

    // Size the token budget from the *actual* sampled response counts (their sum captures the
    // Poisson tail a flat average misses), so a batch that drew many chatty tickets isn't
    // under-budgeted and truncated.
    const expectedOutput = expectedBatchOutputTokens(
      count,
      gen.includeStaffResponses,
      gen.avgStaffResponses,
      responseCounts
    )

    const { static: staticPrefix, dynamic: dynamicSuffix } = compilePromptParts({
      editablePrompt: settings.prompt,
      batchCount: count,
      staff: {
        include: gen.includeStaffResponses,
        avgResponses: gen.avgStaffResponses,
        roster,
        responseCounts
      }
    })

    active.set(specId, { streamed: 0, target: expectedOutput, count })
    try {
      const { raw, usage } = await generateBatchWithRetry(
        provider,
        {
          compiledPrompt: `${staticPrefix}\n\n${dynamicSuffix}`,
          staticPrefix,
          dynamicSuffix,
          count,
          maxOutputTokens: maxOutputTokensForExpected(expectedOutput)
        },
        signal,
        maxRetries,
        sleep,
        rng,
        () => {
          retries++
        },
        ({ outputTokens: streamed }) => {
          const a = active.get(specId)
          if (a) a.streamed = streamed
          emit()
        }
      )
      inputTokens += usage.inputTokens
      outputTokens += usage.outputTokens

      const validated = validateTickets(raw, { includeStaffResponses: gen.includeStaffResponses })
      dropped += validated.dropped
      // Never emit more tickets than the batch asked for: extra ids would run past the run's
      // pre-computed opening-time window and pile up at "now".
      const capped = validated.tickets.slice(0, count)
      const assigned = assembleTickets(capped, nextId, timeCtx)
      nextId += assigned.length
      tickets.push(...assigned)
    } catch (err) {
      if (err instanceof TruncationError && count > 1 && !signal.aborted) {
        const half = Math.floor(count / 2)
        await collectBatch(specId, half)
        await collectBatch(specId, count - half)
        return
      }
      throw err
    } finally {
      active.delete(specId)
    }
  }

  const worker = async (spec: { id: number; count: number }): Promise<void> => {
    if (signal.aborted) return
    try {
      await collectBatch(spec.id, spec.count)
    } catch (err) {
      if (!signal.aborted) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    } finally {
      processedBatches++
      if (deps.onBatchComplete) {
        // A persistence failure must never abort the run — record it and keep going. The
        // final write in the service is the safety net for whatever was produced.
        try {
          await deps.onBatchComplete({
            tickets: tickets.slice(),
            usage: { inputTokens, outputTokens, batches: processedBatches },
            dropped,
            retries
          })
        } catch (err) {
          errors.push(
            `Failed to persist after a batch: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
      emit()
    }
  }

  // Concurrency pool: workers pull the next spec until exhausted or aborted.
  let idx = 0
  const runner = async (): Promise<void> => {
    while (idx < specs.length) {
      if (signal.aborted) return
      const spec = specs[idx++]
      await worker(spec)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, specs.length) }, runner))

  return {
    tickets,
    usage: { inputTokens, outputTokens, batches: processedBatches },
    dropped,
    retries,
    errors,
    cancelled: signal.aborted
  }
}
