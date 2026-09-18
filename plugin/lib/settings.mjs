// The numeric bounds + clamping. Every setting the Q&A collects is re-clamped here regardless of
// what was typed, so out-of-range answers can't reach the engine.

/**
 * @typedef {import('./types.mjs').GenerationSettings} GenerationSettings
 */

/**
 * Bounds for the numeric settings.
 *
 * `numTickets` is capped at 500 by the scenario pass: the run's whole scenario list is produced by
 * one subagent call, and much past 650 one-liners that single response gets unreliable. Raising
 * the cap means splitting that call across several subagents first.
 */
export const LIMITS = {
  numTickets: { min: 1, max: 500, default: 100 },
  avgStaffResponses: { min: 0, max: 20, default: 0 },
  numStaffMembers: { min: 1, max: 100, default: 10 },
  maxTicketAgeDays: { min: 1, max: 3650, default: 90 }
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Clamp a raw generation-settings object into range, filling missing fields with defaults.
 * @param {unknown} raw
 * @returns {GenerationSettings}
 */
export function clampGeneration(raw) {
  const g = raw && typeof raw === 'object' ? raw : {}
  return {
    numTickets: clampInt(g.numTickets, LIMITS.numTickets.min, LIMITS.numTickets.max, LIMITS.numTickets.default),
    includeStaffResponses: typeof g.includeStaffResponses === 'boolean' ? g.includeStaffResponses : false,
    avgStaffResponses: clampInt(
      g.avgStaffResponses,
      LIMITS.avgStaffResponses.min,
      LIMITS.avgStaffResponses.max,
      LIMITS.avgStaffResponses.default
    ),
    numStaffMembers: clampInt(
      g.numStaffMembers,
      LIMITS.numStaffMembers.min,
      LIMITS.numStaffMembers.max,
      LIMITS.numStaffMembers.default
    ),
    maxTicketAgeDays: clampInt(
      g.maxTicketAgeDays,
      LIMITS.maxTicketAgeDays.min,
      LIMITS.maxTicketAgeDays.max,
      LIMITS.maxTicketAgeDays.default
    )
  }
}
