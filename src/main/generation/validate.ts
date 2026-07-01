import { z } from 'zod'
import {
  DEFAULT_TICKET_STATUS,
  TICKET_STATUSES,
  type Ticket,
  type TicketAuthor,
  type TicketResponse,
  type TicketStatus
} from '@shared/types'

/** A ticket before the app assigns its id. */
export type DraftTicket = Omit<Ticket, 'id'>

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

function repairResponse(raw: z.infer<typeof RawResponseSchema>): TicketResponse | null {
  const body = (raw.body ?? '').trim()
  const from = repairAuthor(raw.from)
  if (!body || !from) return null
  return { body, from }
}

/** Repair one raw ticket into a valid draft, or return null to drop it. */
export function repairTicket(raw: unknown, opts: ValidateOptions): DraftTicket | null {
  const parsed = RawTicketSchema.safeParse(raw)
  if (!parsed.success) return null
  const t = parsed.data

  const body = (t.body ?? '').trim()
  if (!body) return null // a ticket with no content is useless

  const from = repairAuthor(t.from)
  if (!from) return null // a ticket needs a customer with an email

  const subject = (t.subject ?? '').trim() || body.split('\n')[0].slice(0, 80) || '(no subject)'

  const responses: TicketResponse[] = opts.includeStaffResponses
    ? (t.responses ?? []).map(repairResponse).filter((r): r is TicketResponse => r !== null)
    : []

  return { subject, body, status: coerceStatus(t.status), from, responses }
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

/** Format a sequential ticket id, e.g. `T-00001`. */
export function formatTicketId(n: number, prefix = 'T-'): string {
  return `${prefix}${String(n).padStart(5, '0')}`
}

/** Assign sequential ids to drafts starting at `start` (1-based). */
export function assignIds(drafts: DraftTicket[], start = 1, prefix = 'T-'): Ticket[] {
  return drafts.map((d, i) => ({ id: formatTicketId(start + i, prefix), ...d }))
}
