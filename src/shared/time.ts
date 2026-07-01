/** Time helpers for synthesizing realistic, ordered message timestamps. */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Reply gaps: a few minutes up to ~2 days between consecutive messages. */
const MIN_GAP_MS = 3 * MINUTE
const MAX_GAP_MS = 2 * DAY

/**
 * A ticket whose opening falls within this window of "now" is treated as too fresh for anyone
 * to have replied yet, so it keeps only its opening message. This mirrors real support queues
 * (staff haven't had time to respond) and, by construction, keeps reply timestamps from piling
 * up against `now` for the newest tickets.
 */
export const RECENT_TICKET_WINDOW_MS = 15 * MINUTE

/** Whether a ticket opened this recently should not yet have any replies. */
export function isRecentOpening(openingMs: number, nowMs: number): boolean {
  return nowMs - openingMs < RECENT_TICKET_WINDOW_MS
}

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
 * Synthesize `count` **strictly increasing** ISO-8601 timestamps for one ticket's messages,
 * starting from a given `openingMs` (see `openingTimesForRun`). Each following message lands a
 * realistic gap later but never past `nowMs`. When little room remains before `now`, gaps are
 * compressed (down to 1ms) so the sequence stays strictly increasing rather than piling several
 * messages onto the same instant. `rng` is injectable so the output is testable.
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
    const remaining = n - i // messages still to place, including this one
    // Reserve at least 1ms per remaining message so every timestamp is strictly after the last
    // and still lands at or before `now`.
    const maxGap = Math.floor(Math.max(0, nowMs - t) / remaining)
    const desiredGap = MIN_GAP_MS + Math.floor(rng() * (MAX_GAP_MS - MIN_GAP_MS))
    const gap = Math.max(1, Math.min(desiredGap, maxGap))
    t = Math.min(nowMs, t + gap)
    out.push(new Date(t).toISOString())
  }
  return out
}
