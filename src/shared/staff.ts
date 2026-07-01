import type { StaffMember } from './types'
import { MAX_RESPONSES_PER_TICKET } from './generation'

/** Fixed email domain for all staff members. */
export const STAFF_EMAIL_DOMAIN = 'company.biz'

/** Derived email for a staff member. */
export function staffEmail(member: StaffMember): string {
  return `${member.alias}@${STAFF_EMAIL_DOMAIN}`
}

/** Whether an email belongs to staff (on the company.biz domain). */
export function isStaffEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`)
}

/**
 * Normalize an alias into a well-formed email local-part: lowercase, spaces → dots,
 * only `a-z 0-9 . _ -`, collapsed dots, no leading/trailing dots.
 */
export function normalizeAlias(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

/** Default alias derived from a full name (e.g. "Sarah Chen" → "sarah.chen"). */
export function aliasFromName(name: string): string {
  return normalizeAlias(name)
}

/**
 * Normalize just the alias at `index` to be well-formed and unique within the roster (falling
 * back to the row's name, then `staff`, and suffixing on collision). Used to fix a single row
 * on edit without disturbing the others.
 */
export function normalizeAliasAt(roster: StaffMember[], index: number): string {
  const row = roster[index]
  const base = normalizeAlias(row?.alias || '') || normalizeAlias(row?.name || '') || 'staff'
  const others = new Set(
    roster.filter((_, i) => i !== index).map((m) => (m.alias ?? '').trim().toLowerCase())
  )
  let alias = base
  let n = 2
  while (others.has(alias)) alias = `${base}.${n++}`
  return alias
}

/**
 * Normalize a whole roster so every derived email is well-formed and unique: each alias is
 * normalized (falling back to the name, then `staff` if empty), and any collision gets a
 * numeric suffix (`sarah.chen`, `sarah.chen.2`, …). Names are preserved as-is (trimmed).
 * Idempotent — running it again yields the same roster.
 */
export function normalizeRoster(roster: StaffMember[]): StaffMember[] {
  const seen = new Set<string>()
  return roster.map((m) => {
    const base = normalizeAlias(m.alias || '') || normalizeAlias(m.name || '') || 'staff'
    let alias = base
    let n = 2
    while (seen.has(alias)) alias = `${base}.${n++}`
    seen.add(alias)
    return { name: (m.name ?? '').trim(), alias }
  })
}

/** The built-in default staff roster, used out of the box. */
export const DEFAULT_STAFF_ROSTER: StaffMember[] = [
  { name: 'Sarah Chen', alias: 'sarah.chen' },
  { name: 'Mike Rodriguez', alias: 'mike.rodriguez' },
  { name: 'Emily Johnson', alias: 'emily.johnson' },
  { name: 'David Kim', alias: 'david.kim' },
  { name: 'Lisa Thompson', alias: 'lisa.thompson' },
  { name: 'Alex Rivera', alias: 'alex.rivera' },
  { name: 'Jordan Wu', alias: 'jordan.wu' },
  { name: 'Priya Patel', alias: 'priya.patel' }
]

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
 * Deterministically generate a staff member for slot `index` (used to back-fill the
 * roster when it grows). Deterministic so it is testable and stable across renders.
 */
export function generateStaffMember(index: number): StaffMember {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]
  const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]
  // Append the index to guarantee unique aliases beyond the first full pass.
  const suffix = index >= FIRST_NAMES.length ? `.${index}` : ''
  return { name: `${first} ${last}`, alias: normalizeAlias(`${first}.${last}${suffix}`) }
}

/** Generate a roster of `count` members (used when auto-generating before a run). */
export function generateRoster(count: number): StaffMember[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => generateStaffMember(i))
}

/**
 * Resize a roster to `count` members: grow by appending generated members, shrink by
 * trimming from the end. Preserves existing user edits.
 */
export function resizeRoster(roster: StaffMember[], count: number): StaffMember[] {
  const target = Math.max(0, Math.floor(count))
  if (roster.length === target) return roster
  if (roster.length > target) return roster.slice(0, target)
  const grown = [...roster]
  for (let i = roster.length; i < target; i++) grown.push(generateStaffMember(i))
  return grown
}

/** Whether a roster has at least one usable member (non-blank name or alias). */
export function hasUsableMembers(roster: StaffMember[]): boolean {
  return roster.some((m) => (m.name?.trim() || m.alias?.trim() || '').length > 0)
}

/**
 * Return a roster guaranteed to have members: if the provided one is empty/blank,
 * auto-generate `count` members. Called before a run so authors always exist.
 */
export function ensureRoster(roster: StaffMember[], count: number): StaffMember[] {
  return hasUsableMembers(roster) ? roster : generateRoster(Math.max(1, count))
}

/**
 * Sample a Poisson-distributed count (Knuth's algorithm). `rng` is injectable so the
 * distribution is testable. Returns a non-negative integer.
 */
export function poissonSample(lambda: number, rng: () => number = Math.random): number {
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
export function sampleResponseCounts(
  count: number,
  avg: number,
  rng: () => number = Math.random
): number[] {
  return Array.from({ length: Math.max(0, count) }, () =>
    Math.min(MAX_RESPONSES_PER_TICKET, poissonSample(avg, rng))
  )
}
