import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BATCH_SIZE,
  MAX_OUTPUT_TOKENS_CEILING,
  OUTPUT_TOKENS_PER_TICKET,
  effectiveBatchSize,
  estimatedTokensPerTicket,
  expectedBatchOutputTokens,
  maxOutputTokensForBatch,
  maxOutputTokensForExpected
} from './generation'

describe('effectiveBatchSize', () => {
  it('leaves the batch size unchanged when tickets are small (no staff responses)', () => {
    expect(effectiveBatchSize(DEFAULT_BATCH_SIZE, false, 0)).toBe(DEFAULT_BATCH_SIZE)
  })

  it('shrinks the batch when heavy staff responses make each ticket large', () => {
    const heavy = effectiveBatchSize(DEFAULT_BATCH_SIZE, true, 20)
    expect(heavy).toBeLessThan(DEFAULT_BATCH_SIZE)
    expect(heavy).toBeGreaterThanOrEqual(1)
  })

  it('never returns less than 1', () => {
    expect(effectiveBatchSize(0, true, 20)).toBe(1)
  })
})

describe('maxOutputTokensForBatch', () => {
  it('scales with count and per-ticket tokens, above a floor', () => {
    const small = maxOutputTokensForBatch(1, estimatedTokensPerTicket(false, 0))
    const large = maxOutputTokensForBatch(20, estimatedTokensPerTicket(false, 0))
    expect(small).toBeGreaterThanOrEqual(1024)
    expect(large).toBeGreaterThan(small)
  })

  it('clamps to the ceiling for very large batches', () => {
    expect(maxOutputTokensForBatch(500, estimatedTokensPerTicket(true, 20))).toBe(MAX_OUTPUT_TOKENS_CEILING)
  })
})

describe('expectedBatchOutputTokens', () => {
  it('uses only the per-ticket base when staff responses are off', () => {
    expect(expectedBatchOutputTokens(5, false, 20)).toBe(5 * OUTPUT_TOKENS_PER_TICKET)
  })

  it('prefers the sum of the actual sampled counts over the flat average', () => {
    // Same average (2/ticket) but a chattier actual draw must budget for more output.
    const avgBased = expectedBatchOutputTokens(4, true, 2)
    const drawBased = expectedBatchOutputTokens(4, true, 2, [5, 4, 6, 3]) // sum 18 ≫ 8
    expect(drawBased).toBeGreaterThan(avgBased)
  })
})

describe('maxOutputTokensForExpected', () => {
  it('applies a margin above a floor and clamps to the ceiling', () => {
    expect(maxOutputTokensForExpected(10)).toBeGreaterThanOrEqual(1024)
    expect(maxOutputTokensForExpected(10_000_000)).toBe(MAX_OUTPUT_TOKENS_CEILING)
  })
})
