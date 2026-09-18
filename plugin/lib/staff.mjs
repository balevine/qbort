// Roster generation + the Poisson response-count sampler. A roster is only ever generated from a
// count, never edited, so there is nothing here for renaming or resizing one.

import { MAX_RESPONSES_PER_TICKET, STAFF_EMAIL_DOMAIN } from './constants.mjs'

/**
 * @typedef {import('./types.mjs').StaffMember} StaffMember
 */

/**
 * Derived email for a staff member.
 * @param {StaffMember} member
 * @returns {string}
 */
export function staffEmail(member) {
  return `${member.alias}@${STAFF_EMAIL_DOMAIN}`
}

/**
 * Whether an email belongs to staff (on the company.biz domain).
 * @param {string} email
 * @returns {boolean}
 */
export function isStaffEmail(email) {
  return String(email).trim().toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`)
}

/**
 * Normalize an alias into a well-formed email local-part: lowercase, spaces → dots,
 * only `a-z 0-9 . _ -`, collapsed dots, no leading/trailing dots.
 * @param {string} raw
 * @returns {string}
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

/**
 * Deterministically generate a staff member for slot `index`. The index is appended past the first
 * full pass through the name lists, so aliases stay unique however large the roster gets.
 * @param {number} index
 * @returns {StaffMember}
 */
export function generateStaffMember(index) {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]
  const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]
  const suffix = index >= FIRST_NAMES.length ? `.${index}` : ''
  return { name: `${first} ${last}`, alias: normalizeAlias(`${first}.${last}${suffix}`) }
}

/**
 * Generate a roster of `count` members. Always yields at least one member, since a run with no
 * authors would produce unattributable replies.
 * @param {number} count
 * @returns {StaffMember[]}
 */
export function generateRoster(count) {
  return Array.from({ length: Math.max(1, Math.floor(count)) }, (_, i) => generateStaffMember(i))
}

/**
 * Sample a Poisson-distributed count (Knuth's algorithm). `rng` is injectable so the
 * distribution is testable. Returns a non-negative integer.
 * @param {number} lambda
 * @param {() => number} [rng]
 * @returns {number}
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
 * @param {number} count
 * @param {number} avg
 * @param {() => number} [rng]
 * @returns {number[]}
 */
export function sampleResponseCounts(count, avg, rng = Math.random) {
  return Array.from({ length: Math.max(0, count) }, () =>
    Math.min(MAX_RESPONSES_PER_TICKET, poissonSample(avg, rng))
  )
}
