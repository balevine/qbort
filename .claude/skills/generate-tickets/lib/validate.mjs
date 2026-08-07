// Ported from src/main/generation/validate.ts. Same permissive repair/drop logic, but the zod
// schema is replaced by plain guards (the model's output is messy; validate loosely, repair
// what's safe, drop what isn't). This is where the "app owns structure, LLM owns content"
// invariant lives: `id`, `isStaff`, and `createdAt` are assigned here, never trusted from the LLM.

import { TICKET_STATUSES, DEFAULT_TICKET_STATUS } from './constants.mjs'
import { isStaffEmail } from './staff.mjs'
import { isRecentOpening, messageTimestamps } from './time.mjs'

function coerceStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return TICKET_STATUSES.includes(s) ? s : DEFAULT_TICKET_STATUS
}

function repairAuthor(raw) {
  const email = String(raw?.email ?? '').trim()
  if (!email) return null
  const name = String(raw?.name ?? '').trim() || email.split('@')[0]
  return { name, email }
}

/** Repair one raw message into a draft (role derived from the email domain), or null to drop it. */
function repairMessage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const body = String(raw.body ?? '').trim()
  const from = repairAuthor(raw.from)
  if (!body || !from) return null
  return { from, body, isStaff: isStaffEmail(from.email) }
}

/** Repair one raw ticket into a draft, or return null to drop it. */
export function repairTicket(raw, opts) {
  if (!raw || typeof raw !== 'object') return null
  const t = raw

  // The opening message is the customer's — a ticket needs its content + an author. Its role is
  // fixed to customer regardless of the email domain (the app never trusts the model for role).
  const opening = repairMessage({ body: t.body, from: t.from })
  if (!opening) return null
  opening.isStaff = false

  const subject = String(t.subject ?? '').trim() || opening.body.split('\n')[0].slice(0, 80) || '(no subject)'

  const rawResponses = Array.isArray(t.responses) ? t.responses : []
  const replies = opts.includeStaffResponses
    ? rawResponses.map(repairMessage).filter((m) => m !== null)
    : []

  return { subject, status: coerceStatus(t.status), messages: [opening, ...replies] }
}

/**
 * Robustly pull a JSON value out of model text: try a direct parse, strip ```fences```, then
 * fall back to the first `{`…last `}` slice. Returns null if nothing parses. Ported from the
 * app's provider `extractJson` so a subagent that wraps its file in a code fence isn't dropped.
 */
export function extractJson(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced ? fenced[1] : trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    /* fall through */
  }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      /* fall through */
    }
  }
  return null
}

/** Extract the ticket array from a model response (object `{tickets:[...]}`, bare array, or JSON/text string). */
export function extractTicketArray(input) {
  let value = input
  if (typeof value === 'string') {
    value = extractJson(value)
    if (value === null) return []
  }
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray(value.tickets)) return value.tickets
  return []
}

/** Validate + repair a batch, dropping unusable tickets. */
export function validateTickets(input, opts) {
  const raw = extractTicketArray(input)
  const tickets = []
  let dropped = 0
  for (const item of raw) {
    const repaired = repairTicket(item, opts)
    if (repaired) tickets.push(repaired)
    else dropped++
  }
  return { tickets, dropped }
}

/**
 * Turn drafts into final tickets: assign sequential integer ids (from `start`) and synthesize
 * ascending message timestamps. Each ticket's opening time comes from `time.openingMsForId`,
 * which is ordered by id, so ascending ids get ascending open times. A ticket opened in the last
 * few minutes keeps only its opening message (nobody's replied yet).
 */
export function assembleTickets(drafts, start, time) {
  return drafts.map((draft, i) => {
    const id = start + i
    const openingMs = time.openingMsForId(id)
    const messages = isRecentOpening(openingMs, time.nowMs) ? draft.messages.slice(0, 1) : draft.messages
    const times = messageTimestamps(messages.length, openingMs, time.nowMs, time.rng)
    return {
      id,
      subject: draft.subject,
      status: draft.status,
      messages: messages.map((m, j) => ({ ...m, createdAt: times[j] }))
    }
  })
}
