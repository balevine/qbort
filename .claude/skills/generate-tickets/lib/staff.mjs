// Ported from src/shared/staff.ts — roster generation + the Poisson response-count sampler.
// (Roster-editing helpers the UI needed are omitted; the skill auto-generates the roster.)

import { MAX_RESPONSES_PER_TICKET, STAFF_EMAIL_DOMAIN } from './constants.mjs'

/** Derived email for a staff member. */
export function staffEmail(member) {
  return `${member.alias}@${STAFF_EMAIL_DOMAIN}`
}

/** Whether an email belongs to staff (on the company.biz domain). */
export function isStaffEmail(email) {
  return String(email).trim().toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`)
}

/**
 * Normalize an alias into a well-formed email local-part: lowercase, spaces → dots,
 * only `a-z 0-9 . _ -`, collapsed dots, no leading/trailing dots.
 */
export function normalizeAlias(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

const FIRST_NAMES = [
  'Avery', 'Bailey', 'Casey', 'Drew', 'Ellis', 'Finley', 'Gray', 'Harper',
  'Indigo', 'Jules', 'Kai', 'Logan', 'Morgan', 'Noah', 'Quinn', 'Riley',
  'Sage', 'Tatum', 'Uma', 'Val', 'Wren', 'Xan', 'Yuki', 'Zion'
]
const LAST_NAMES = [
  'Adams', 'Brooks', 'Cruz', 'Diaz', 'Evans', 'Ford', 'Gomez', 'Hayes',
  'Ito', 'Jensen', 'Khan', 'Lee', 'Mori', 'Novak', 'Ortiz', 'Park',
  'Reyes', 'Singh', 'Tran', 'Vega', 'Wong', 'Young', 'Zhang'
]

/** Deterministically generate a staff member for slot `index`. */
export function generateStaffMember(index) {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]
  const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]
  const suffix = index >= FIRST_NAMES.length ? `.${index}` : ''
  return { name: `${first} ${last}`, alias: normalizeAlias(`${first}.${last}${suffix}`) }
}

/** Generate a roster of `count` members (used when auto-generating before a run). */
export function generateRoster(count) {
  return Array.from({ length: Math.max(1, Math.floor(count)) }, (_, i) => generateStaffMember(i))
}

/**
 * Sample a Poisson-distributed count (Knuth's algorithm). `rng` is injectable so the
 * distribution is testable. Returns a non-negative integer.
 */
export function poissonSample(lambda, rng = Math.random) {
  if (lambda <= 0) return 0
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return k - 1
}

/**
 * Per-ticket staff-response targets for a batch: one Poisson(avg) draw per ticket,
 * clamped to [0, MAX_RESPONSES_PER_TICKET].
 */
export function sampleResponseCounts(count, avg, rng = Math.random) {
  return Array.from({ length: Math.max(0, count) }, () =>
    Math.min(MAX_RESPONSES_PER_TICKET, poissonSample(avg, rng))
  )
}
