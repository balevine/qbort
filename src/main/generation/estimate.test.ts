import { describe, expect, it } from 'vitest'
import { estimateRun } from './estimate'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { Settings } from '@shared/types'

function settings(providerId: Settings['providerId'], gen: Partial<Settings['generation']> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    providerId,
    generation: { ...DEFAULT_SETTINGS.generation, ...gen }
  }
}

describe('estimateRun', () => {
  it('treats Ollama as local and free, with correct batch count', () => {
    const est = estimateRun(settings('ollama', { numTickets: 100 }), 20)
    expect(est.isLocal).toBe(true)
    expect(est.estimatedCostUsd).toBe(0)
    expect(est.batches).toBe(5)
  })

  it('produces a positive cost and the curated model for a hosted provider', () => {
    const est = estimateRun(settings('anthropic', { numTickets: 100 }))
    expect(est.estimatedCostUsd).toBeGreaterThan(0)
    expect(est.model).toBe('claude-sonnet-4-6')
    expect(est.estimatedTotalTokens).toBe(est.estimatedInputTokens + est.estimatedOutputTokens)
  })

  it('estimates more output tokens when staff responses are enabled', () => {
    const base = estimateRun(settings('anthropic', { numTickets: 100, includeStaffResponses: false }))
    const withStaff = estimateRun(
      settings('anthropic', { numTickets: 100, includeStaffResponses: true, avgStaffResponses: 3 })
    )
    expect(withStaff.estimatedOutputTokens).toBeGreaterThan(base.estimatedOutputTokens)
  })
})
