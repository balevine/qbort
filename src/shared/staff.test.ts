import { describe, expect, it } from 'vitest'
import {
  STAFF_EMAIL_DOMAIN,
  aliasFromName,
  ensureRoster,
  generateRoster,
  generateStaffMember,
  hasUsableMembers,
  isStaffEmail,
  normalizeAlias,
  normalizeAliasAt,
  normalizeRoster,
  poissonSample,
  resizeRoster,
  sampleResponseCounts,
  staffEmail
} from './staff'
import { MAX_RESPONSES_PER_TICKET } from './generation'

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

describe('staffEmail / aliasFromName', () => {
  it('derives email from alias on the fixed domain', () => {
    expect(staffEmail({ name: 'X', alias: 'sarah.chen' })).toBe(`sarah.chen@${STAFF_EMAIL_DOMAIN}`)
  })

  it('derives an alias from a full name', () => {
    expect(aliasFromName('David Kim')).toBe('david.kim')
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
})

describe('resizeRoster', () => {
  const base = [
    { name: 'Sarah Chen', alias: 'sarah.chen' },
    { name: 'Mike Rodriguez', alias: 'mike.rodriguez' }
  ]

  it('returns the same roster when the size matches', () => {
    expect(resizeRoster(base, 2)).toBe(base)
  })

  it('trims from the end when shrinking', () => {
    expect(resizeRoster(base, 1)).toEqual([base[0]])
  })

  it('appends generated members when growing, preserving existing edits', () => {
    const grown = resizeRoster(base, 4)
    expect(grown).toHaveLength(4)
    expect(grown.slice(0, 2)).toEqual(base)
    expect(new Set(grown.map((m) => m.alias)).size).toBe(4)
  })
})

describe('normalizeRoster', () => {
  it('normalizes aliases and de-duplicates collisions with numeric suffixes', () => {
    const out = normalizeRoster([
      { name: 'Sarah Chen', alias: 'Sarah Chen' },
      { name: 'Sara Chen', alias: 'sarah.chen' },
      { name: 'Another', alias: 'sarah.chen' }
    ])
    expect(out.map((m) => m.alias)).toEqual(['sarah.chen', 'sarah.chen.2', 'sarah.chen.3'])
  })

  it('falls back to the name, then a default, when the alias is blank', () => {
    const out = normalizeRoster([
      { name: 'Dana Lee', alias: '' },
      { name: '', alias: '' }
    ])
    expect(out[0].alias).toBe('dana.lee')
    expect(out[1].alias).toBe('staff')
  })

  it('is idempotent and keeps an already-clean roster intact', () => {
    const clean = [
      { name: 'Sarah Chen', alias: 'sarah.chen' },
      { name: 'Mike Rodriguez', alias: 'mike.rodriguez' }
    ]
    expect(normalizeRoster(clean)).toEqual(clean)
    expect(normalizeRoster(normalizeRoster(clean))).toEqual(clean)
  })
})

describe('normalizeAliasAt', () => {
  const roster = [
    { name: 'Sarah Chen', alias: 'sarah.chen' },
    { name: 'Sara Chen', alias: 'Sara Chen' },
    { name: '', alias: '' }
  ]

  it('normalizes the row and suffixes on collision with other rows', () => {
    // Row 1's alias "Sara Chen" normalizes to "sarah.chen"? No — to "sara.chen" (distinct).
    expect(normalizeAliasAt(roster, 1)).toBe('sara.chen')
  })

  it('suffixes when the normalized alias collides with an existing row', () => {
    const withDup = [
      { name: 'Sarah Chen', alias: 'sarah.chen' },
      { name: 'Sarah Chen', alias: 'Sarah Chen' }
    ]
    expect(normalizeAliasAt(withDup, 1)).toBe('sarah.chen.2')
  })

  it('falls back to the name then a default when the alias is blank', () => {
    expect(normalizeAliasAt([{ name: 'Dana Lee', alias: '' }], 0)).toBe('dana.lee')
    expect(normalizeAliasAt([{ name: '', alias: '' }], 0)).toBe('staff')
  })
})

describe('hasUsableMembers / ensureRoster', () => {
  it('detects blank rosters', () => {
    expect(hasUsableMembers([])).toBe(false)
    expect(hasUsableMembers([{ name: '  ', alias: '' }])).toBe(false)
    expect(hasUsableMembers([{ name: 'A', alias: '' }])).toBe(true)
  })

  it('auto-generates when the roster is empty/blank, else keeps it', () => {
    const generated = ensureRoster([], 5)
    expect(generated).toHaveLength(5)

    const kept = [{ name: 'Sarah Chen', alias: 'sarah.chen' }]
    expect(ensureRoster(kept, 5)).toBe(kept)
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
})
