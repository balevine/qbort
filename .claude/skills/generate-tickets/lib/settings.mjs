// Ported from src/shared/settings.ts — the numeric bounds + clamping. Every setting the Q&A
// dialog collects is re-clamped here regardless of what was typed, so out-of-range answers can't
// reach the engine.

/**
 * Bounds for the numeric settings (shared by the desktop app's sliders and validation).
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

/** Minimal starter prompt — scaffolded into TICKET_PROMPT.md when the user has none. */
export const DEFAULT_PROMPT = `You generate realistic but fake customer support tickets for a SaaS product.

Guidelines:
- Vary the subject and body so tickets feel authentic and distinct.
- Use a realistic customer name and email (not on the company.biz domain).
- Spread tickets across a few categories, e.g. billing, login/access, bugs, and how-to questions.
- Mix sentiment: some frustrated, some neutral, some appreciative.

[Add your own categories, product descriptions, and any other instructions below. You can also modify any of the pre-existing content in this prompt to generate different kinds of tickets.]`

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/** Clamp a raw generation-settings object into range, filling missing fields with defaults. */
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
