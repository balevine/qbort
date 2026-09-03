import { describe, expect, it } from 'vitest'
import { backoffMs, backoffWithJitter, runGeneration, type BatchSnapshot } from './orchestrator'
import {
  ProviderError,
  TruncationError,
  type GenerateBatchArgs,
  type GenerateBatchResult,
  type LLMProvider
} from './providers'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { GenerationProgress, Settings } from '@shared/types'

/** Canned raw tickets a fake provider can return. */
function rawTickets(n: number): unknown {
  return {
    tickets: Array.from({ length: n }, (_, i) => ({
      subject: `Subject ${i}`,
      body: `Body ${i}`,
      status: 'open',
      from: { name: `Cust ${i}`, email: `cust${i}@example.com` }
    }))
  }
}

/**
 * Every run now opens with one scenario call, identifiable by having no `staticPrefix` (it has no
 * cacheable half). The stubs below answer it and return early, so their `calls` counters and
 * `callIndex` arguments keep counting only ticket batches and the existing assertions still read
 * as statements about batching. Zero usage keeps the token-accounting assertions batch-only;
 * scenario-call accounting has its own test.
 */
function scenarioReply(count: number): GenerateBatchResult {
  return {
    raw: { scenarios: Array.from({ length: count }, (_, i) => `Scenario ${i + 1}`) },
    usage: { inputTokens: 0, outputTokens: 0 }
  }
}

function settingsWith(numTickets: number, overrides: Partial<Settings['generation']> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    generation: { ...DEFAULT_SETTINGS.generation, numTickets, ...overrides }
  }
}

/** A provider that returns `count` valid tickets per call, with optional fault injection. */
function fakeProvider(
  onCall?: (callIndex: number) => void
): LLMProvider & { calls: number } {
  let calls = 0
  const provider = {
    id: 'ollama' as const,
    model: 'test-model',
    calls: 0,
    async generateBatch({ count, staticPrefix }: { count: number; staticPrefix?: string }): Promise<GenerateBatchResult> {
      if (staticPrefix === undefined) return scenarioReply(count)
      const idx = calls++
      provider.calls = calls
      onCall?.(idx)
      const tickets = Array.from({ length: count }, (_, i) => ({
        subject: `Subject ${i}`,
        body: `Body ${i}`,
        status: 'open',
        from: { name: `Cust ${i}`, email: `cust${i}@example.com` }
      }))
      return { raw: { tickets }, usage: { inputTokens: 10, outputTokens: 20 } }
    }
  }
  return provider
}

/**
 * A provider that returns `count` tickets per call but marks some invalid (no email → dropped in
 * validation). `dropPerCall(callIndex, count)` says how many of that call's tickets to spoil.
 */
function droppingProvider(
  dropPerCall: (callIndex: number, count: number) => number
): LLMProvider & { calls: number } {
  let calls = 0
  const provider = {
    id: 'ollama' as const,
    model: 'test-model',
    calls: 0,
    async generateBatch({ count, staticPrefix }: { count: number; staticPrefix?: string }): Promise<GenerateBatchResult> {
      if (staticPrefix === undefined) return scenarioReply(count)
      const idx = calls++
      provider.calls = calls
      const drop = dropPerCall(idx, count)
      const tickets = Array.from({ length: count }, (_, i) => ({
        subject: `Subject ${idx}-${i}`,
        body: `Body ${idx}-${i}`,
        status: 'open',
        // The first `drop` tickets of this call omit the email, so validation drops them.
        from: i < drop ? { name: `Cust ${idx}-${i}` } : { name: `Cust ${idx}-${i}`, email: `c${idx}-${i}@example.com` }
      }))
      return { raw: { tickets }, usage: { inputTokens: 1, outputTokens: 1 } }
    }
  }
  return provider
}

const noSleep = async () => {}

describe('backoffMs', () => {
  it('grows exponentially and caps at 30s', () => {
    expect(backoffMs(1)).toBe(1000)
    expect(backoffMs(2)).toBe(2000)
    expect(backoffMs(100)).toBe(30_000)
  })

  it('adds up to +25% jitter on top of the base backoff', () => {
    expect(backoffWithJitter(1, () => 0)).toBe(1000) // no jitter
    expect(backoffWithJitter(1, () => 1)).toBe(1250) // max jitter
    expect(backoffWithJitter(2, () => 0.5)).toBe(2250)
  })
})

describe('runGeneration', () => {
  it('produces the requested count with sequential ids across batches', async () => {
    const result = await runGeneration({
      provider: fakeProvider(),
      settings: settingsWith(10),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 2,
      sleep: noSleep
    })
    expect(result.tickets).toHaveLength(10)
    expect(result.tickets.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result.usage.batches).toBe(3) // 4 + 4 + 2
    expect(result.usage.inputTokens).toBe(30)
    expect(result.cancelled).toBe(false)
  })

  it('retries a retryable error then succeeds, counting retries', async () => {
    const provider = fakeProvider((idx) => {
      if (idx === 0) throw new ProviderError('rate limited', 'ollama', 429, true)
    })
    const result = await runGeneration({
      provider,
      settings: settingsWith(4),
      signal: new AbortController().signal,
      batchSize: 4,
      sleep: noSleep
    })
    expect(result.tickets).toHaveLength(4)
    expect(result.retries).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('surfaces a non-retryable batch error but tops up the resulting shortfall', async () => {
    // First batch always fails (400, non-retryable); its 4 missing tickets return via top-up.
    const provider = fakeProvider((idx) => {
      if (idx === 0) throw new ProviderError('bad request', 'ollama', 400, false)
    })
    const result = await runGeneration({
      provider,
      settings: settingsWith(8),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 1,
      sleep: noSleep
    })
    expect(result.errors).toHaveLength(1) // the 400 is still recorded
    expect(result.tickets).toHaveLength(8) // the failed batch's shortfall is refilled
  })

  it('retries non-ProviderError (e.g. bad JSON) up to maxRetries, then tops up and retries again', async () => {
    const provider = fakeProvider(() => {
      throw new Error('Model did not return valid JSON')
    })
    const result = await runGeneration({
      provider,
      settings: settingsWith(4),
      signal: new AbortController().signal,
      batchSize: 4,
      maxRetries: 2,
      sleep: noSleep
    })
    // The batch never succeeds, so each pass exhausts its retries and records an error: the
    // initial pass plus 3 top-up rounds (MAX_TOPUP_ROUNDS) = 4 passes × 2 retries.
    expect(result.retries).toBe(8)
    expect(result.errors).toHaveLength(4)
    expect(result.tickets).toHaveLength(0)
  })

  it('stops scheduling new batches after abort and reports cancelled', async () => {
    const controller = new AbortController()
    const provider = fakeProvider((idx) => {
      if (idx === 0) controller.abort()
    })
    const result = await runGeneration({
      provider,
      settings: settingsWith(12),
      signal: controller.signal,
      batchSize: 4,
      concurrency: 1,
      sleep: noSleep
    })
    expect(result.cancelled).toBe(true)
    expect(result.tickets).toHaveLength(4) // only the first batch completed
  })

  it('surfaces live streaming tokens and a moving fraction via onProgress', async () => {
    const provider: LLMProvider = {
      id: 'ollama',
      model: 'm',
      async generateBatch({ count, onToken, staticPrefix }) {
        if (staticPrefix === undefined) return scenarioReply(count)
        onToken?.({ outputTokens: 50 })
        onToken?.({ outputTokens: 100 })
        const tickets = Array.from({ length: count }, (_, i) => ({
          subject: `S${i}`,
          body: `B${i}`,
          status: 'open',
          from: { name: 'C', email: `c${i}@example.com` }
        }))
        return { raw: { tickets }, usage: { inputTokens: 5, outputTokens: 120 } }
      }
    }
    const seen: GenerationProgress[] = []
    const result = await runGeneration({
      provider,
      settings: settingsWith(5),
      signal: new AbortController().signal,
      batchSize: 5,
      concurrency: 1,
      sleep: noSleep,
      onProgress: (p) => seen.push({ ...p })
    })

    expect(seen.some((p) => p.streamingTokens > 0)).toBe(true)
    expect(seen.some((p) => p.fraction > 0 && p.fraction < 1)).toBe(true)
    expect(result.tickets).toHaveLength(5)
    expect(seen[seen.length - 1].fraction).toBe(1)
  })

  it('does not abort the run when onBatchComplete (persistence) fails', async () => {
    const result = await runGeneration({
      provider: fakeProvider(),
      settings: settingsWith(8),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 2,
      sleep: noSleep,
      onBatchComplete: () => {
        throw new Error('disk full')
      }
    })
    // All tickets are still produced and returned; the failure is recorded, not fatal.
    expect(result.tickets).toHaveLength(8)
    expect(result.errors.some((e) => e.includes('disk full'))).toBe(true)
  })

  it('accumulates usage (tokens, batches) across batches', async () => {
    const result = await runGeneration({
      provider: fakeProvider(), // 10 in + 20 out per batch
      settings: settingsWith(10),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 2,
      sleep: noSleep
    })
    expect(result.usage.batches).toBe(3) // 4 + 4 + 2
    expect(result.usage.inputTokens).toBe(30) // 3 batches × 10
    expect(result.usage.outputTokens).toBe(60) // 3 batches × 20
  })

  it('grows the token budget and retries when a batch truncates', async () => {
    let firstBudget: number | undefined
    const provider: LLMProvider = {
      id: 'anthropic',
      model: 'm',
      async generateBatch({ count, maxOutputTokens, staticPrefix }) {
        if (staticPrefix === undefined) return scenarioReply(count)
        if (firstBudget === undefined) {
          firstBudget = maxOutputTokens
          throw new TruncationError('anthropic')
        }
        // The retry must ask for a bigger budget than the attempt that truncated.
        expect(maxOutputTokens).toBeGreaterThan(firstBudget!)
        return { raw: rawTickets(count), usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }
    const result = await runGeneration({
      provider,
      settings: settingsWith(4),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 1,
      sleep: noSleep
    })
    expect(result.tickets).toHaveLength(4)
    expect(result.retries).toBeGreaterThanOrEqual(1)
  })

  it('splits a batch that truncates even at the max budget until the pieces fit', async () => {
    // Truncates for any multi-ticket batch; only single-ticket batches succeed. The orchestrator
    // must recursively split 4 → 2+2 → 1+1+1+1 and still produce all four tickets.
    const provider: LLMProvider = {
      id: 'anthropic',
      model: 'm',
      async generateBatch({ count, staticPrefix }) {
        if (staticPrefix === undefined) return scenarioReply(count)
        if (count > 1) throw new TruncationError('anthropic')
        return { raw: rawTickets(count), usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }
    const result = await runGeneration({
      provider,
      settings: settingsWith(4),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 1,
      maxRetries: 2,
      sleep: noSleep
    })
    expect(result.tickets).toHaveLength(4)
    expect(result.tickets.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('caps a batch to the requested count when the model over-delivers', async () => {
    const provider: LLMProvider = {
      id: 'ollama',
      model: 'm',
      async generateBatch({ count, staticPrefix }) {
        if (staticPrefix === undefined) return scenarioReply(count)
        return { raw: rawTickets(count + 3), usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }
    const result = await runGeneration({
      provider,
      settings: settingsWith(4),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 1,
      sleep: noSleep
    })
    expect(result.tickets).toHaveLength(4) // extras dropped, not 7
    expect(result.tickets.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('tops up with more batches when validation drops tickets below the requested count', async () => {
    // First call: 10 requested, 4 spoiled → 6 kept. Later calls: nothing spoiled.
    const provider = droppingProvider((idx) => (idx === 0 ? 4 : 0))
    const result = await runGeneration({
      provider,
      settings: settingsWith(10),
      signal: new AbortController().signal,
      batchSize: 10,
      concurrency: 1,
      sleep: noSleep
    })
    // Initial batch kept 6; one top-up round of the 4-ticket shortfall filled the rest.
    expect(result.tickets).toHaveLength(10)
    expect(result.tickets.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result.dropped).toBe(4)
    expect(provider.calls).toBe(2)
  })

  it('stops topping up after MAX_TOPUP_ROUNDS even if still short', async () => {
    // Every ticket is spoiled, so no round ever makes progress.
    const provider = droppingProvider((_idx, count) => count)
    const result = await runGeneration({
      provider,
      settings: settingsWith(10),
      signal: new AbortController().signal,
      batchSize: 10,
      concurrency: 1,
      sleep: noSleep
    })
    expect(result.tickets).toHaveLength(0)
    // 1 initial pass + 3 top-up rounds (MAX_TOPUP_ROUNDS), each a single 10-ticket batch.
    expect(provider.calls).toBe(4)
  })

  it('does not run any top-up rounds when the first pass already meets the count', async () => {
    const provider = droppingProvider(() => 0)
    const result = await runGeneration({
      provider,
      settings: settingsWith(10),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 2,
      sleep: noSleep
    })
    expect(result.tickets).toHaveLength(10)
    expect(provider.calls).toBe(3) // 4 + 4 + 2, no top-up
  })

  it('invokes onBatchComplete with growing snapshots', async () => {
    const snapshots: BatchSnapshot[] = []
    await runGeneration({
      provider: fakeProvider(),
      settings: settingsWith(10),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 1,
      sleep: noSleep,
      onBatchComplete: (s) => {
        snapshots.push(s)
      }
    })
    expect(snapshots).toHaveLength(3)
    expect(snapshots.map((s) => s.tickets.length)).toEqual([4, 8, 10])
  })
})

describe('runGeneration scenario pass', () => {
  /**
   * A provider that answers the scenario call with `scenarios` distinct one-liners (or a caller-
   * supplied `raw`), records every batch's dynamic suffix, and returns valid tickets.
   */
  function scenarioProvider(opts: {
    scenarioRaw?: (attempt: number) => unknown
    scenarioUsage?: { inputTokens: number; outputTokens: number }
  } = {}): LLMProvider & { suffixes: string[]; scenarioCalls: number; batchCalls: number } {
    const provider = {
      id: 'ollama' as const,
      model: 'm',
      suffixes: [] as string[],
      scenarioCalls: 0,
      batchCalls: 0,
      async generateBatch({ count, staticPrefix, dynamicSuffix }: GenerateBatchArgs): Promise<GenerateBatchResult> {
        if (staticPrefix === undefined) {
          const attempt = provider.scenarioCalls++
          const raw = opts.scenarioRaw
            ? opts.scenarioRaw(attempt)
            : { scenarios: Array.from({ length: count }, (_, i) => `Scenario ${i + 1}`) }
          return { raw, usage: opts.scenarioUsage ?? { inputTokens: 0, outputTokens: 0 } }
        }
        provider.batchCalls++
        provider.suffixes.push(dynamicSuffix ?? '')
        return { raw: rawTickets(count), usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }
    return provider
  }

  /** Every `N. <scenario>` line across all recorded batch prompts. */
  const dealtScenarios = (suffixes: string[]): string[] =>
    suffixes.flatMap((s) => [...s.matchAll(/^ {2}\d+\. (Scenario \d+)$/gm)].map((m) => m[1]))

  it('deals one distinct scenario per ticket across every batch', async () => {
    const provider = scenarioProvider()
    const result = await runGeneration({
      provider,
      settings: settingsWith(10),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 1,
      sleep: noSleep
    })

    expect(result.tickets).toHaveLength(10)
    expect(provider.scenarioCalls).toBe(1) // one call for the whole run, not one per batch
    const dealt = dealtScenarios(provider.suffixes)
    expect(dealt).toHaveLength(10) // 4 + 4 + 2, one per ticket
    expect(new Set(dealt).size).toBe(10) // and no scenario handed to two batches
  })

  it('asks for a buffer beyond the ticket count and holds the surplus back', async () => {
    const provider = scenarioProvider()
    await runGeneration({
      provider,
      settings: settingsWith(10),
      signal: new AbortController().signal,
      batchSize: 10,
      concurrency: 1,
      sleep: noSleep
    })
    // scenarioTarget(10) = 13 requested, 10 dealt, 3 kept in reserve for top-ups.
    expect(provider.suffixes).toHaveLength(1)
    expect(dealtScenarios(provider.suffixes)).toHaveLength(10)
  })

  it('draws top-up scenarios from the reserve instead of repeating dealt ones', async () => {
    // Every ticket of the first batch is invalid, so a top-up round runs for the shortfall.
    let call = 0
    const provider = {
      id: 'ollama' as const,
      model: 'm',
      suffixes: [] as string[],
      async generateBatch({ count, staticPrefix, dynamicSuffix }: GenerateBatchArgs): Promise<GenerateBatchResult> {
        if (staticPrefix === undefined) {
          return {
            raw: { scenarios: Array.from({ length: count }, (_, i) => `Scenario ${i + 1}`) },
            usage: { inputTokens: 0, outputTokens: 0 }
          }
        }
        provider.suffixes.push(dynamicSuffix ?? '')
        const spoil = call++ === 0
        const tickets = Array.from({ length: count }, (_, i) => ({
          subject: `S${i}`,
          body: `B${i}`,
          status: 'open',
          from: spoil ? { name: `C${i}` } : { name: `C${i}`, email: `c${i}@example.com` }
        }))
        return { raw: { tickets }, usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }

    const result = await runGeneration({
      provider,
      settings: settingsWith(3),
      signal: new AbortController().signal,
      batchSize: 3,
      concurrency: 1,
      sleep: noSleep
    })

    expect(result.tickets).toHaveLength(3)
    const dealt = dealtScenarios(provider.suffixes)
    // scenarioTarget(3) = 6: three dealt to the failed first batch, three fresh from the reserve.
    expect(dealt).toHaveLength(6)
    expect(new Set(dealt).size).toBe(6)
  })

  it('generates tickets without scenarios once the reserve runs dry', async () => {
    // Only 4 scenarios come back for a 3-ticket run: enough to start (>= 3), but the reserve is 1,
    // so the second top-up batch outruns it and must proceed unscripted rather than fail.
    let call = 0
    const provider = {
      id: 'ollama' as const,
      model: 'm',
      suffixes: [] as string[],
      async generateBatch({ count, staticPrefix, dynamicSuffix }: GenerateBatchArgs): Promise<GenerateBatchResult> {
        if (staticPrefix === undefined) {
          return {
            raw: { scenarios: ['one', 'two', 'three', 'four'] },
            usage: { inputTokens: 0, outputTokens: 0 }
          }
        }
        provider.suffixes.push(dynamicSuffix ?? '')
        // Batches 0 and 1 produce nothing usable; the last one succeeds.
        const spoil = call++ < 2
        const tickets = Array.from({ length: count }, (_, i) => ({
          subject: `S${i}`,
          body: `B${i}`,
          status: 'open',
          from: spoil ? { name: `C${i}` } : { name: `C${i}`, email: `c${i}@example.com` }
        }))
        return { raw: { tickets }, usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }

    const result = await runGeneration({
      provider,
      settings: settingsWith(3),
      signal: new AbortController().signal,
      batchSize: 3,
      concurrency: 1,
      sleep: noSleep
    })

    const scenarioLines = (s: string): number => [...s.matchAll(/^ {2}\d+\. /gm)].length

    expect(result.tickets).toHaveLength(3)
    expect(scenarioLines(provider.suffixes[0])).toBe(3) // first batch fully scripted
    // First top-up: only one left in the reserve, so the other two tickets are declared free.
    expect(scenarioLines(provider.suffixes[1])).toBe(1)
    expect(provider.suffixes[1]).toContain('The remaining 2 ticket(s) have no scenario')
    // Second top-up: reserve exhausted, so no scenario block at all — but the run still finished.
    expect(scenarioLines(provider.suffixes[2])).toBe(0)
    expect(provider.suffixes[2]).toContain('EXACTLY 3 unique ticket(s)')
  })

  it('retries the scenario call when the list comes back unusable, then proceeds', async () => {
    const provider = scenarioProvider({
      scenarioRaw: (attempt) =>
        attempt === 0
          ? { nonsense: true } // wrong shape
          : { scenarios: Array.from({ length: 8 }, (_, i) => `Scenario ${i + 1}`) }
    })
    const result = await runGeneration({
      provider,
      settings: settingsWith(5),
      signal: new AbortController().signal,
      batchSize: 5,
      concurrency: 1,
      sleep: noSleep
    })
    expect(provider.scenarioCalls).toBe(2)
    expect(result.tickets).toHaveLength(5)
    expect(dealtScenarios(provider.suffixes)).toHaveLength(5)
  })

  it('fails the whole run rather than generating without scenarios', async () => {
    const provider = scenarioProvider({ scenarioRaw: () => ({ scenarios: ['just one'] }) })
    await expect(
      runGeneration({
        provider,
        settings: settingsWith(5),
        signal: new AbortController().signal,
        batchSize: 5,
        concurrency: 1,
        sleep: noSleep
      })
    ).rejects.toThrow(/Could not generate ticket scenarios after 3 attempts/)
    expect(provider.scenarioCalls).toBe(3)
    expect(provider.batchCalls).toBe(0) // no tickets billed for after a failed scenario pass
  })

  it('counts the scenario call towards the run usage', async () => {
    const provider = scenarioProvider({ scenarioUsage: { inputTokens: 40, outputTokens: 400 } })
    const result = await runGeneration({
      provider,
      settings: settingsWith(4),
      signal: new AbortController().signal,
      batchSize: 4,
      concurrency: 1,
      sleep: noSleep
    })
    expect(result.usage.inputTokens).toBe(41) // 40 scenario + 1 batch
    expect(result.usage.outputTokens).toBe(401)
    expect(result.usage.batches).toBe(1) // the scenario call is not a ticket batch
  })
})
