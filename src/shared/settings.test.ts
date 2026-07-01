import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, LIMITS, mergeSettings, withDefaults } from './settings'

describe('withDefaults', () => {
  it('returns full defaults for empty/garbage input', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS)
    expect(withDefaults(42)).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps numTickets to its bounds', () => {
    expect(withDefaults({ generation: { numTickets: 99999 } }).generation.numTickets).toBe(
      LIMITS.numTickets.max
    )
    expect(withDefaults({ generation: { numTickets: 0 } }).generation.numTickets).toBe(
      LIMITS.numTickets.min
    )
  })

  it('falls back to default for an unknown provider', () => {
    expect(withDefaults({ providerId: 'bogus' as never }).providerId).toBe('ollama')
  })

  it('preserves valid values', () => {
    const s = withDefaults({
      providerId: 'anthropic',
      generation: {
        numTickets: 250,
        includeStaffResponses: true,
        avgStaffResponses: 3,
        numStaffMembers: 12,
        maxTicketAgeDays: 30
      }
    })
    expect(s.providerId).toBe('anthropic')
    expect(s.generation).toEqual({
      numTickets: 250,
      includeStaffResponses: true,
      avgStaffResponses: 3,
      numStaffMembers: 12,
      maxTicketAgeDays: 30
    })
  })

  it('uses the default roster when none is provided, and keeps a provided one', () => {
    expect(withDefaults({}).staffRoster).toEqual(DEFAULT_SETTINGS.staffRoster)
    const custom = [{ name: 'A B', alias: 'a.b' }]
    expect(withDefaults({ staffRoster: custom }).staffRoster).toEqual(custom)
  })
})

describe('mergeSettings', () => {
  it('overlays a partial update and re-applies defaults/clamping', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { providerId: 'anthropic' })
    expect(merged.providerId).toBe('anthropic')
    expect(merged.generation).toEqual(DEFAULT_SETTINGS.generation)
  })
})
