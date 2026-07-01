import { describe, expect, it } from 'vitest'
import { RECENT_TICKET_WINDOW_MS, isRecentOpening, messageTimestamps, openingTimesForRun } from './time'

const NOW = Date.parse('2026-06-30T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000

// Deterministic LCG so ordering assertions are stable.
function lcg(seed: number): () => number {
  return () => {
    seed = (1103515245 * seed + 12345) % 2147483648
    return seed / 2147483648
  }
}

describe('openingTimesForRun', () => {
  it('returns `count` times, sorted ascending, within the window and not in the future', () => {
    const times = openingTimesForRun(50, 90, NOW, lcg(7))
    expect(times).toHaveLength(50)
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
    for (const t of times) {
      expect(t).toBeLessThanOrEqual(NOW)
      expect(t).toBeGreaterThanOrEqual(NOW - 90 * DAY)
    }
  })

  it('is empty for count 0 and deterministic for a fixed rng', () => {
    expect(openingTimesForRun(0, 90, NOW, () => 0.5)).toEqual([])
    expect(openingTimesForRun(5, 60, NOW, () => 0.3)).toEqual(openingTimesForRun(5, 60, NOW, () => 0.3))
  })

  it('places all openings at now when rng is 0 (top of the window)', () => {
    expect(openingTimesForRun(3, 90, NOW, () => 0)).toEqual([NOW, NOW, NOW])
  })
})

describe('messageTimestamps', () => {
  it('starts at the supplied opening time and returns one per message', () => {
    const opening = NOW - 10 * DAY
    const ts = messageTimestamps(4, opening, NOW, () => 0.5)
    expect(ts).toHaveLength(4)
    expect(ts[0]).toBe(new Date(opening).toISOString())
  })

  it('produces ascending timestamps, never past now', () => {
    const times = messageTimestamps(12, NOW - 5 * DAY, NOW, lcg(11)).map((s) => Date.parse(s))
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
    for (const t of times) expect(t).toBeLessThanOrEqual(NOW)
  })

  it('stays strictly increasing even when many messages must fit a tiny window before now', () => {
    // 10 messages into a 5-minute window would tie at `now` under naive clamping; the compressed
    // gaps must keep every timestamp strictly after the previous one and at or before now.
    const times = messageTimestamps(10, NOW - 5 * MINUTE, NOW, () => 1).map((s) => Date.parse(s))
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
    for (const t of times) expect(t).toBeLessThanOrEqual(NOW)
    expect(new Set(times).size).toBe(times.length) // no duplicate instants
  })

  it('always returns at least one timestamp', () => {
    expect(messageTimestamps(0, NOW, NOW, () => 0.5)).toHaveLength(1)
  })

  it('is deterministic for a fixed rng', () => {
    const o = NOW - 3 * DAY
    expect(messageTimestamps(5, o, NOW, () => 0.3)).toEqual(messageTimestamps(5, o, NOW, () => 0.3))
  })
})

describe('isRecentOpening', () => {
  it('is true only within the recent window of now', () => {
    expect(isRecentOpening(NOW - MINUTE, NOW)).toBe(true)
    expect(isRecentOpening(NOW - (RECENT_TICKET_WINDOW_MS - 1), NOW)).toBe(true)
    expect(isRecentOpening(NOW - RECENT_TICKET_WINDOW_MS, NOW)).toBe(false)
    expect(isRecentOpening(NOW - DAY, NOW)).toBe(false)
  })
})
