// Ported verbatim from src/shared/time.ts — synthesizes realistic, ordered message timestamps.
// The LLM is never trusted with timestamps; the app owns them.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Reply gaps: a few minutes up to ~2 days between consecutive messages. */
const MIN_GAP_MS = 3 * MINUTE
const MAX_GAP_MS = 2 * DAY

/**
 * A ticket whose opening falls within this window of "now" is treated as too fresh for anyone
 * to have replied yet, so it keeps only its opening message.
 */
export const RECENT_TICKET_WINDOW_MS = 15 * MINUTE

/** Whether a ticket opened this recently should not yet have any replies. */
export function isRecentOpening(openingMs, nowMs) {
  return nowMs - openingMs < RECENT_TICKET_WINDOW_MS
}

/**
 * Pick `count` ticket-opening times (ms), one per ticket for the whole run, sorted ascending.
 * Handing sorted times out by id makes ascending id ⇒ ascending open time.
 */
export function openingTimesForRun(count, windowDays, nowMs, rng = Math.random) {
  const n = Math.max(0, Math.floor(count))
  const windowMs = Math.max(0, windowDays) * DAY
  const times = Array.from({ length: n }, () => nowMs - Math.floor(rng() * windowMs))
  times.sort((a, b) => a - b)
  return times
}

/**
 * Synthesize `count` strictly increasing ISO-8601 timestamps for one ticket's messages,
 * starting from `openingMs`. Each following message lands a realistic gap later but never past
 * `nowMs`; when little room remains, gaps compress (down to 1ms) so the sequence stays strictly
 * increasing rather than piling messages onto the same instant.
 */
export function messageTimestamps(count, openingMs, nowMs, rng = Math.random) {
  const n = Math.max(1, Math.floor(count))
  let t = Math.min(nowMs, openingMs)
  const out = [new Date(t).toISOString()]
  for (let i = 1; i < n; i++) {
    const remaining = n - i
    const maxGap = Math.floor(Math.max(0, nowMs - t) / remaining)
    const desiredGap = MIN_GAP_MS + Math.floor(rng() * (MAX_GAP_MS - MIN_GAP_MS))
    const gap = Math.max(1, Math.min(desiredGap, maxGap))
    t = Math.min(nowMs, t + gap)
    out.push(new Date(t).toISOString())
  }
  return out
}
