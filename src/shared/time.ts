/** Time helpers for synthesizing realistic, ordered message timestamps. */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Reply gaps: a few minutes up to ~2 days between consecutive messages. */
const MIN_GAP_MS = 3 * MINUTE
const MAX_GAP_MS = 2 * DAY

/**
 * Pick `count` ticket-opening times (ms), one per ticket for the whole run, sorted ascending.
 * Each is a random point within the last `windowDays`. Because the app assigns sequential
 * ticket ids in order, handing out these sorted times by id makes ascending id ⇒ ascending
 * open time — mirroring how real ticketing systems number tickets by creation order.
 */
export function openingTimesForRun(
  count: number,
  windowDays: number,
  nowMs: number,
  rng: () => number = Math.random
): number[] {
  const n = Math.max(0, Math.floor(count))
  const windowMs = Math.max(0, windowDays) * DAY
  const times = Array.from({ length: n }, () => nowMs - Math.floor(rng() * windowMs))
  times.sort((a, b) => a - b)
  return times
}

/**
 * Synthesize `count` ascending ISO-8601 timestamps for one ticket's messages, starting from a
 * given `openingMs` (see `openingTimesForRun`). Each following message is a realistic gap later,
 * never past `nowMs`. `rng` is injectable so the output is testable.
 */
export function messageTimestamps(
  count: number,
  openingMs: number,
  nowMs: number,
  rng: () => number = Math.random
): string[] {
  const n = Math.max(1, Math.floor(count))

  let t = Math.min(nowMs, openingMs)
  const out = [new Date(t).toISOString()]
  for (let i = 1; i < n; i++) {
    const gap = MIN_GAP_MS + Math.floor(rng() * (MAX_GAP_MS - MIN_GAP_MS))
    t = Math.min(nowMs, t + gap) // never in the future
    out.push(new Date(t).toISOString())
  }
  return out
}
