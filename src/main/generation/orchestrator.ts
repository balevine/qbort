import type { GenerationProgress, Settings, Ticket } from '@shared/types'
import {
  DEFAULT_BATCH_SIZE,
  MAX_OUTPUT_TOKENS_CEILING,
  MAX_TOPUP_ROUNDS,
  OUTPUT_TOKENS_PER_SCENARIO,
  effectiveBatchSize,
  expectedBatchOutputTokens,
  maxOutputTokensForExpected
} from '@shared/generation'
import { compilePromptParts, compileScenarioPrompt, scenarioTarget } from '@shared/promptCompiler'
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

/** One planned batch: a progress key, how many tickets it owes, and the scenarios dealt to it. */
interface BatchSpec {
  id: number
  count: number
  scenarios: string[]
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

/** Fisher-Yates over a copy, driven by the run's injectable rng. */
function shuffled<T>(list: T[], rng: () => number): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Attempts at the scenario call before the run gives up. */
const SCENARIO_ATTEMPTS = 3

/** Pull a `{ scenarios: [...] }` (or bare array) response apart, keeping only usable strings. */
export function parseScenarios(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : (raw as { scenarios?: unknown } | null)?.scenarios
  if (!Array.isArray(list)) return []
  return list.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
}

interface RetryBatchArgs {
  compiledPrompt: string
  /** Omitted for the one-shot scenario call, which has no cacheable prefix. */
  staticPrefix?: string
  dynamicSuffix?: string
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
 * Generate the run's scenario list in a single call, before any batch runs. Batch prompts are
 * otherwise byte-identical apart from their count, so independent batches converge on the same
 * high-probability topics; one globally-visible list of one-liners, dealt one per ticket, is what
 * keeps them apart.
 *
 * Retried up to `SCENARIO_ATTEMPTS` times on transport failure, unparseable output, or a list too
 * short to cover the run, then the run fails. There is deliberately no fallback to scenario-less
 * batches: shipping duplicate-heavy tickets at full cost gives the user no signal anything broke.
 */
async function generateScenarios(
  provider: LLMProvider,
  editablePrompt: string,
  total: number,
  signal: AbortSignal,
  maxRetries: number,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  rng: () => number,
  onRetry: () => void
): Promise<{ scenarios: string[]; usage: { inputTokens: number; outputTokens: number } }> {
  const target = scenarioTarget(total)
  // No staticPrefix/dynamicSuffix split: this prompt is sent once, so a cache block would cost a
  // cache-write premium that no later call reads back.
  const compiledPrompt = compileScenarioPrompt(editablePrompt, target)
  let lastReason = 'no response'

  for (let attempt = 1; attempt <= SCENARIO_ATTEMPTS; attempt++) {
    try {
      const { raw, usage } = await generateBatchWithRetry(
        provider,
        {
          compiledPrompt,
          count: target,
          maxOutputTokens: maxOutputTokensForExpected(target * OUTPUT_TOKENS_PER_SCENARIO)
        },
        signal,
        maxRetries,
        sleep,
        rng,
        onRetry,
        () => {}
      )
      const scenarios = parseScenarios(raw)
      // The buffer absorbs mild under-delivery; only a list too short to cover the run is fatal.
      if (scenarios.length >= total) return { scenarios, usage }
      lastReason =
        scenarios.length === 0
          ? 'the response was not a JSON object of shape { "scenarios": [...] }'
          : `only ${scenarios.length} of the ${target} requested scenarios came back (need at least ${total})`
    } catch (err) {
      if (signal.aborted) return { scenarios: [], usage: { inputTokens: 0, outputTokens: 0 } }
      lastReason = err instanceof Error ? err.message : String(err)
    }
    if (signal.aborted) return { scenarios: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  throw new Error(
    `Could not generate ticket scenarios after ${SCENARIO_ATTEMPTS} attempts: ${lastReason}. ` +
      'Generation stopped — running without scenarios would produce many near-duplicate tickets.'
  )
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

  // Split a count of tickets into batch specs of at most `effBatchSize`. Spec ids are unique
  // across the whole run (including top-up rounds) since they key the in-flight progress map.
  let specSeq = 0
  const buildSpecs = (count: number): BatchSpec[] => {
    const out: BatchSpec[] = []
    for (let start = 0; start < count; start += effBatchSize) {
      out.push({ id: specSeq++, count: Math.min(effBatchSize, count - start), scenarios: [] })
    }
    return out
  }

  // Scenarios are dealt in spec order off one shuffled pool, so no two batches (in any round) can
  // be handed the same topic. Shuffling matters because the model emits the list grouped by
  // whatever categories the prompt implies: dealing it in order would cluster categories per batch
  // and leave the reserve as a single category.
  let scenarioPool: string[] = []
  let scenarioCursor = 0
  const dealScenarios = (specs: BatchSpec[]): void => {
    for (const spec of specs) {
      spec.scenarios = scenarioPool.slice(scenarioCursor, scenarioCursor + spec.count)
      scenarioCursor += spec.scenarios.length
    }
  }

  const initialSpecs = buildSpecs(total)

  const tickets: Ticket[] = []
  let nextId = 1
  let inputTokens = 0
  let outputTokens = 0
  let processedBatches = 0
  // Total planned batches; grows as top-up rounds are scheduled after validation shortfalls.
  let batchesTotal = initialSpecs.length
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
      batchesTotal,
      retries,
      dropped,
      errors: errors.slice(),
      streamingTokens,
      fraction
    })
  }

  emit()

  // One scenario call up front, before any batch. Throws (stopping the run) if it can't produce a
  // list long enough to cover the run — see generateScenarios.
  if (total > 0 && !signal.aborted) {
    const scenarioRun = await generateScenarios(
      provider,
      settings.prompt,
      total,
      signal,
      maxRetries,
      sleep,
      rng,
      () => {
        retries++
      }
    )
    inputTokens += scenarioRun.usage.inputTokens
    outputTokens += scenarioRun.usage.outputTokens
    scenarioPool = shuffled(scenarioRun.scenarios, rng)
    dealScenarios(initialSpecs)
    emit()
  }

  // Produce one batch of `count` tickets under the given progress key, appending them to the run.
  // If the model truncates even at the max token budget, the batch is split in half and each
  // smaller batch retried — smaller batches produce less output and fit the budget.
  const collectBatch = async (specId: number, count: number, scenarios: string[]): Promise<void> => {
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
      scenarios,
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
        // Split this batch's scenarios along with its tickets so each half keeps its own topics.
        await collectBatch(specId, half, scenarios.slice(0, half))
        await collectBatch(specId, count - half, scenarios.slice(half))
        return
      }
      throw err
    } finally {
      active.delete(specId)
    }
  }

  const worker = async (spec: BatchSpec): Promise<void> => {
    if (signal.aborted) return
    try {
      await collectBatch(spec.id, spec.count, spec.scenarios)
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

  // Concurrency pool: workers pull the next spec of a round until it's exhausted or aborted.
  const runSpecs = async (roundSpecs: BatchSpec[]): Promise<void> => {
    let idx = 0
    const runner = async (): Promise<void> => {
      while (idx < roundSpecs.length) {
        if (signal.aborted) return
        await worker(roundSpecs[idx++])
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, roundSpecs.length) }, runner))
  }

  await runSpecs(initialSpecs)

  // Validation drops malformed tickets, so a pass can keep fewer than requested. Re-count and
  // generate just the shortfall — re-validating only those new tickets — for up to
  // MAX_TOPUP_ROUNDS rounds, or until we hit the requested count (or the run is cancelled). Each
  // round requests exactly the shortfall and every batch is capped to its own count, so the kept
  // total never exceeds `total` and ids stay within the pre-computed opening-time window.
  for (let round = 0; round < MAX_TOPUP_ROUNDS && !signal.aborted; round++) {
    const shortfall = total - tickets.length
    if (shortfall <= 0) break
    const topUpSpecs = buildSpecs(shortfall)
    // Top-ups draw from the scenario reserve. If it runs dry those tickets are generated without a
    // scenario rather than failing: most of the run's output already exists, so the fail-fast rule
    // that governs the initial call is the wrong trade here.
    dealScenarios(topUpSpecs)
    batchesTotal += topUpSpecs.length
    emit()
    await runSpecs(topUpSpecs)
  }

  return {
    tickets,
    usage: { inputTokens, outputTokens, batches: processedBatches },
    dropped,
    retries,
    errors,
    cancelled: signal.aborted
  }
}
