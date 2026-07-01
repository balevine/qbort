import { describe, expect, it } from 'vitest'
import { backoffMs, backoffWithJitter, runGeneration, type BatchSnapshot } from './orchestrator'
import { ProviderError, TruncationError, type GenerateBatchResult, type LLMProvider } from './providers'
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
    async generateBatch({ count }: { count: number }): Promise<GenerateBatchResult> {
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

  it('gives up on a non-retryable error and keeps partial results', async () => {
    // Two batches; the first always fails (400), the second succeeds.
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
    expect(result.errors).toHaveLength(1)
    expect(result.tickets).toHaveLength(4) // only the second batch
  })

  it('retries non-ProviderError (e.g. bad JSON) up to maxRetries then records an error', async () => {
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
    expect(result.retries).toBe(2)
    expect(result.errors).toHaveLength(1)
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
      async generateBatch({ count, onToken }) {
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
      async generateBatch({ count, maxOutputTokens }) {
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
      async generateBatch({ count }) {
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
      async generateBatch({ count }) {
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
