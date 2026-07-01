import { z } from 'zod'
import {
  DEFAULT_TICKET_STATUS,
  TICKET_STATUSES,
  type Ticket,
  type TicketAuthor,
  type TicketMessage,
  type TicketStatus
} from '@shared/types'
import { isStaffEmail } from '@shared/staff'
import { isRecentOpening, messageTimestamps } from '@shared/time'

/** A message before the app assigns its `createdAt`. */
export type DraftMessage = Omit<TicketMessage, 'createdAt'>

/** A ticket before the app assigns its id and message timestamps. */
export interface DraftTicket {
  subject: string
  status: TicketStatus
  messages: DraftMessage[]
}

// Permissive raw schema — the model's output is messy, so we validate loosely then repair.
const RawAuthorSchema = z
  .object({ name: z.string().optional(), email: z.string().optional() })
  .passthrough()

const RawResponseSchema = z
  .object({ body: z.string().optional(), from: RawAuthorSchema.optional() })
  .passthrough()

const RawTicketSchema = z
  .object({
    subject: z.string().optional(),
    body: z.string().optional(),
    status: z.string().optional(),
    from: RawAuthorSchema.optional(),
    responses: z.array(RawResponseSchema).optional()
  })
  .passthrough()

export interface ValidateOptions {
  includeStaffResponses: boolean
}

export interface ValidateResult {
  tickets: DraftTicket[]
  dropped: number
}

/** Run-level context for assigning message timestamps. */
export interface TimeContext {
  nowMs: number
  rng: () => number
  /** Opening timestamp (ms) for a ticket of the given id; monotonic in id across the run. */
  openingMsForId: (id: number) => number
}

function coerceStatus(raw: string | undefined): TicketStatus {
  const s = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return (TICKET_STATUSES as readonly string[]).includes(s) ? (s as TicketStatus) : DEFAULT_TICKET_STATUS
}

function repairAuthor(raw: { name?: string; email?: string } | undefined): TicketAuthor | null {
  const email = (raw?.email ?? '').trim()
  if (!email) return null
  const name = (raw?.name ?? '').trim() || email.split('@')[0]
  return { name, email }
}

/** Repair one raw message into a draft (role derived from the email domain), or null to drop it. */
function repairMessage(raw: { body?: string; from?: { name?: string; email?: string } }): DraftMessage | null {
  const body = (raw.body ?? '').trim()
  const from = repairAuthor(raw.from)
  if (!body || !from) return null
  return { from, body, isStaff: isStaffEmail(from.email) }
}

/** Repair one raw ticket into a draft, or return null to drop it. */
export function repairTicket(raw: unknown, opts: ValidateOptions): DraftTicket | null {
  const parsed = RawTicketSchema.safeParse(raw)
  if (!parsed.success) return null
  const t = parsed.data

  // The opening message is the customer's — a ticket needs its content + an author. Its role is
  // fixed to customer regardless of the email domain (the app never trusts the model for role),
  // so a model that slips a `@company.biz` address onto the opener can't mislabel it as staff.
  const opening = repairMessage({ body: t.body, from: t.from })
  if (!opening) return null
  opening.isStaff = false

  const subject = (t.subject ?? '').trim() || opening.body.split('\n')[0].slice(0, 80) || '(no subject)'

  const replies: DraftMessage[] = opts.includeStaffResponses
    ? (t.responses ?? []).map(repairMessage).filter((m): m is DraftMessage => m !== null)
    : []

  return { subject, status: coerceStatus(t.status), messages: [opening, ...replies] }
}

/** Extract the ticket array from a model response (object `{tickets:[...]}`, bare array, or JSON string). */
export function extractTicketArray(input: unknown): unknown[] {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray((value as { tickets?: unknown }).tickets)) {
    return (value as { tickets: unknown[] }).tickets
  }
  return []
}

/** Validate + repair a batch, dropping unusable tickets. */
export function validateTickets(input: unknown, opts: ValidateOptions): ValidateResult {
  const raw = extractTicketArray(input)
  const tickets: DraftTicket[] = []
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
 * ascending message timestamps. Each ticket's opening time comes from `openingMsForId`, which is
 * ordered by id, so ascending ids get ascending open times.
 */
export function assembleTickets(drafts: DraftTicket[], start: number, time: TimeContext): Ticket[] {
  return drafts.map((draft, i) => {
    const id = start + i
    const openingMs = time.openingMsForId(id)
    // A ticket opened in the last few minutes hasn't had time for a reply yet — keep only the
    // opening message. This also stops reply timestamps from bunching up against `now`.
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
