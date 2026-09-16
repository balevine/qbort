// Ported constants from src/shared (generation.ts + types.ts). Kept in one place so the
// skill's engine reuses the exact values the desktop app uses.

/** Allowed ticket statuses. The prompt can influence the mix; output is validated to this set. */
export const TICKET_STATUSES = ['new', 'open', 'pending', 'on-hold', 'solved', 'closed']
export const DEFAULT_TICKET_STATUS = 'open'

/** Fixed email domain for all staff members. */
export const STAFF_EMAIL_DOMAIN = 'company.biz'

/** Upper bound on staff responses targeted for any single ticket (keeps prompts sane). */
export const MAX_RESPONSES_PER_TICKET = 30

/** How many tickets to request per subagent batch (a parallelism/diversity knob here). */
export const DEFAULT_BATCH_SIZE = 20

/**
 * Post-validation top-up rounds. Validation drops malformed tickets, so a pass can yield fewer
 * than requested. After the initial pass the skill re-counts and generates just the shortfall,
 * for up to this many additional rounds — or until the requested count is reached.
 */
export const MAX_TOPUP_ROUNDS = 3
