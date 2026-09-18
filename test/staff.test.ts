import { describe, expect, it } from 'vitest'
import {
  generateRoster,
  generateStaffMember,
  isStaffEmail,
  normalizeAlias,
  poissonSample,
  sampleResponseCounts,
  staffEmail
} from '@lib/staff.mjs'
import { MAX_RESPONSES_PER_TICKET, STAFF_EMAIL_DOMAIN } from '@lib/constants.mjs'

// A roster is only ever generated from a count, never edited, so generation and the response-count
// sampler are the whole surface here.

describe('normalizeAlias', () => {
  it('lowercases, replaces spaces with dots, strips junk', () => {
    expect(normalizeAlias('Sarah Chen')).toBe('sarah.chen')
    expect(normalizeAlias('  Mike   Rodriguez ')).toBe('mike.rodriguez')
    expect(normalizeAlias('A+B@C!')).toBe('abc')
  })

  it('collapses repeated dots and trims edge dots', () => {
    expect(normalizeAlias('..a..b..')).toBe('a.b')
  })

  it('keeps allowed separators', () => {
    expect(normalizeAlias('jo-anne_smith')).toBe('jo-anne_smith')
  })
})

describe('staffEmail', () => {
  it('derives email from alias on the fixed domain', () => {
    expect(staffEmail({ name: 'X', alias: 'sarah.chen' })).toBe(`sarah.chen@${STAFF_EMAIL_DOMAIN}`)
  })
})

describe('isStaffEmail', () => {
  it('matches the company.biz domain (case-insensitive), not customer domains', () => {
    expect(isStaffEmail('sarah.chen@company.biz')).toBe(true)
    expect(isStaffEmail('Sarah.Chen@COMPANY.BIZ')).toBe(true)
    expect(isStaffEmail('dana@acme.example')).toBe(false)
    expect(isStaffEmail('x@notcompany.biz.evil.com')).toBe(false)
  })
})

describe('generateStaffMember / generateRoster', () => {
  it('is deterministic for a given index', () => {
    expect(generateStaffMember(0)).toEqual(generateStaffMember(0))
  })

  it('produces unique aliases across a large roster', () => {
    const roster = generateRoster(60)
    const aliases = new Set(roster.map((m) => m.alias))
    expect(roster).toHaveLength(60)
    expect(aliases.size).toBe(60)
  })

  it('always yields at least one member, so replies are always attributable', () => {
    expect(generateRoster(0)).toHaveLength(1)
    expect(generateRoster(-5)).toHaveLength(1)
  })
})

describe('poissonSample', () => {
  it('returns 0 for non-positive lambda', () => {
    expect(poissonSample(0)).toBe(0)
    expect(poissonSample(-3)).toBe(0)
  })

  it('is deterministic with a fixed rng and non-negative', () => {
    const rng = () => 0.5
    const a = poissonSample(2, rng)
    const b = poissonSample(2, rng)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
  })

  it('has a mean near lambda over many samples', () => {
    let seed = 12345
    const rng = () => {
      // deterministic LCG so the test is stable
      seed = (1103515245 * seed + 12345) % 2147483648
      return seed / 2147483648
    }
    const n = 5000
    let total = 0
    for (let i = 0; i < n; i++) total += poissonSample(3, rng)
    expect(total / n).toBeGreaterThan(2.5)
    expect(total / n).toBeLessThan(3.5)
  })
})

describe('sampleResponseCounts', () => {
  it('produces one count per ticket, clamped to the max', () => {
    const counts = sampleResponseCounts(10, 2, () => 0.5)
    expect(counts).toHaveLength(10)
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(MAX_RESPONSES_PER_TICKET)
    }
  })

  it('is all zeros when the average is zero', () => {
    expect(sampleResponseCounts(5, 0)).toEqual([0, 0, 0, 0, 0])
  })

  it('clamps a runaway draw to the per-ticket ceiling', () => {
    // An rng pinned near 1 shrinks Knuth's product so slowly that the raw draw lands in the
    // hundreds; the clamp is what keeps that out of a prompt.
    const counts = sampleResponseCounts(3, 5, () => 0.99)
    expect(counts).toEqual([MAX_RESPONSES_PER_TICKET, MAX_RESPONSES_PER_TICKET, MAX_RESPONSES_PER_TICKET])
  })
})
