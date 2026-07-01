import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BATCH_SIZE,
  MAX_OUTPUT_TOKENS_CEILING,
  effectiveBatchSize,
  estimatedTokensPerTicket,
  maxOutputTokensForBatch
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
