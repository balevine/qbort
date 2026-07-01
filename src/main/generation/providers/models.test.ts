import { describe, expect, it } from 'vitest'
import { costForUsage, getModelId, getPricing, HOSTED_MODELS } from './models'

describe('models', () => {
  it('exposes a cost-balanced model id per hosted provider', () => {
    expect(getModelId('anthropic')).toBe(HOSTED_MODELS.anthropic.model)
  })

  it('treats Ollama as free/local', () => {
    expect(getPricing('ollama')).toEqual({ inputPerM: 0, outputPerM: 0, currency: 'USD' })
    expect(costForUsage('ollama', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0)
  })

  it('computes USD cost from token usage and pricing', () => {
    // anthropic default: $3 / $15 per 1M
    const cost = costForUsage('anthropic', { inputTokens: 2_000_000, outputTokens: 1_000_000 })
    expect(cost).toBeCloseTo(2 * 3 + 1 * 15, 6)
  })
})
