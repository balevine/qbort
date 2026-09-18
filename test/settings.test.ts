import { describe, expect, it } from 'vitest'
import { LIMITS, clampGeneration } from '@lib/settings.mjs'

// Settings are never persisted. The skill collects answers in a Q&A and hands them straight to
// `plan`, so `clampGeneration` is the only thing between a raw answer and the engine.

const DEFAULTS = {
  numTickets: LIMITS.numTickets.default,
  includeStaffResponses: false,
  avgStaffResponses: LIMITS.avgStaffResponses.default,
  numStaffMembers: LIMITS.numStaffMembers.default,
  maxTicketAgeDays: LIMITS.maxTicketAgeDays.default
}

describe('LIMITS', () => {
  it('has a default inside its own bounds for every setting', () => {
    for (const [name, l] of Object.entries(LIMITS)) {
      expect(l.min, name).toBeLessThanOrEqual(l.default)
      expect(l.default, name).toBeLessThanOrEqual(l.max)
    }
  })
})

describe('clampGeneration', () => {
  it('returns full defaults for empty/garbage input', () => {
    expect(clampGeneration(undefined)).toEqual(DEFAULTS)
    expect(clampGeneration(null)).toEqual(DEFAULTS)
    expect(clampGeneration(42)).toEqual(DEFAULTS)
    expect(clampGeneration({})).toEqual(DEFAULTS)
  })

  it('clamps every numeric field to its bounds', () => {
    const high = clampGeneration({
      numTickets: 99999,
      avgStaffResponses: 1000,
      numStaffMembers: 1000,
      maxTicketAgeDays: 99999
    })
    expect(high.numTickets).toBe(LIMITS.numTickets.max)
    expect(high.avgStaffResponses).toBe(LIMITS.avgStaffResponses.max)
    expect(high.numStaffMembers).toBe(LIMITS.numStaffMembers.max)
    expect(high.maxTicketAgeDays).toBe(LIMITS.maxTicketAgeDays.max)

    const low = clampGeneration({
      numTickets: 0,
      avgStaffResponses: -5,
      numStaffMembers: 0,
      maxTicketAgeDays: -1
    })
    expect(low.numTickets).toBe(LIMITS.numTickets.min)
    expect(low.avgStaffResponses).toBe(LIMITS.avgStaffResponses.min)
    expect(low.numStaffMembers).toBe(LIMITS.numStaffMembers.min)
    expect(low.maxTicketAgeDays).toBe(LIMITS.maxTicketAgeDays.min)
  })

  it('rounds fractional values to integers', () => {
    expect(clampGeneration({ numTickets: 10.4 }).numTickets).toBe(10)
    expect(clampGeneration({ numTickets: 10.6 }).numTickets).toBe(11)
  })

  it('falls back to the default for anything that is not a finite number', () => {
    // `plan` coerces its flags with Number(...), so a missing or unparseable flag arrives as NaN.
    expect(clampGeneration({ numTickets: NaN }).numTickets).toBe(LIMITS.numTickets.default)
    expect(clampGeneration({ numTickets: Infinity }).numTickets).toBe(LIMITS.numTickets.default)
    expect(clampGeneration({ numTickets: '250' }).numTickets).toBe(LIMITS.numTickets.default)
  })

  it('accepts includeStaffResponses only as a real boolean', () => {
    expect(clampGeneration({ includeStaffResponses: true }).includeStaffResponses).toBe(true)
    expect(clampGeneration({ includeStaffResponses: 'true' }).includeStaffResponses).toBe(false)
    expect(clampGeneration({ includeStaffResponses: 1 }).includeStaffResponses).toBe(false)
  })

  it('preserves valid values', () => {
    expect(
      clampGeneration({
        numTickets: 250,
        includeStaffResponses: true,
        avgStaffResponses: 3,
        numStaffMembers: 12,
        maxTicketAgeDays: 30
      })
    ).toEqual({
      numTickets: 250,
      includeStaffResponses: true,
      avgStaffResponses: 3,
      numStaffMembers: 12,
      maxTicketAgeDays: 30
    })
  })
})
