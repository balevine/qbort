import { describe, expect, it } from 'vitest'
import { assembleTickets, extractJson, extractTicketArray, repairTicket, validateTickets } from '@lib/validate.mjs'

const withStaff = { includeStaffResponses: true }
const noStaff = { includeStaffResponses: false }

const goodRaw = {
  subject: 'Cannot log in',
  body: 'I get an error every time I try to sign in.',
  status: 'open',
  from: { name: 'Dana Lee', email: 'dana.lee@acme.example' },
  responses: [{ body: 'Try resetting your password.', from: { name: 'Sarah Chen', email: 'sarah.chen@company.biz' } }]
}

describe('repairTicket', () => {
  it('accepts a well-formed ticket, opening message first, staff roles by domain', () => {
    const t = repairTicket(goodRaw, withStaff)
    expect(t).not.toBeNull()
    expect(t!.subject).toBe('Cannot log in')
    expect(t!.status).toBe('open')
    // messages[0] is the customer's opening message; the reply is a staff message.
    expect(t!.messages).toHaveLength(2)
    expect(t!.messages[0].from.email).toBe('dana.lee@acme.example')
    expect(t!.messages[0].body).toBe('I get an error every time I try to sign in.')
    expect(t!.messages[0].isStaff).toBe(false)
    expect(t!.messages[1].isStaff).toBe(true)
  })

  it('coerces an unknown status to the default', () => {
    expect(repairTicket({ ...goodRaw, status: 'banana' }, noStaff)!.status).toBe('open')
  })

  it('normalizes spaced statuses like "on hold"', () => {
    expect(repairTicket({ ...goodRaw, status: 'On Hold' }, noStaff)!.status).toBe('on-hold')
  })

  it('drops tickets with no body or no customer email', () => {
    expect(repairTicket({ ...goodRaw, body: '   ' }, noStaff)).toBeNull()
    expect(repairTicket({ ...goodRaw, from: { name: 'X' } }, noStaff)).toBeNull()
  })

  it('derives a subject from the body when missing', () => {
    const t = repairTicket({ ...goodRaw, subject: '' }, noStaff)
    expect(t!.subject.length).toBeGreaterThan(0)
  })

  it('keeps only the opening message when staff responses are disabled', () => {
    expect(repairTicket(goodRaw, noStaff)!.messages).toHaveLength(1)
  })

  it('drops malformed responses but keeps the ticket + opening message', () => {
    const t = repairTicket(
      { ...goodRaw, responses: [{ body: '' }, { body: 'ok', from: { email: 's@company.biz' } }] },
      withStaff
    )
    expect(t!.messages).toHaveLength(2) // opening + one valid reply
  })

  it('names an author from the email local-part when the model omits the name', () => {
    const t = repairTicket({ ...goodRaw, from: { email: 'dana.lee@acme.example' } }, noStaff)
    expect(t!.messages[0].from.name).toBe('dana.lee')
  })

  it('forces the opening message to customer role even if the model gives it a staff-domain email', () => {
    // The engine owns role. A customer opener on @company.biz must never be mislabeled as staff.
    const t = repairTicket({ ...goodRaw, from: { name: 'Imposter', email: 'imposter@company.biz' } }, withStaff)
    expect(t!.messages[0].isStaff).toBe(false)
  })

  // The two rules that deliberately repair rather than drop. A dropped ticket costs a whole top-up
  // round, and neither case loses anything reconstructible.

  it('coerces a wrong-typed subject or status instead of dropping the ticket', () => {
    const t = repairTicket({ ...goodRaw, subject: 42, status: 7 }, noStaff)
    expect(t).not.toBeNull()
    expect(t!.subject).toBe('42')
    expect(t!.status).toBe('open') // coerced to the default, as any unknown status is
  })

  it('keeps a ticket whose responses field is not an array, with no replies', () => {
    const t = repairTicket({ ...goodRaw, responses: 'Sarah replied twice.' }, withStaff)
    expect(t).not.toBeNull()
    expect(t!.messages).toHaveLength(1)
    expect(t!.messages[0].isStaff).toBe(false)
  })
})

describe('extractJson', () => {
  it('parses plain JSON, fenced JSON, and JSON buried in prose', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Here you go:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 })
  })

  it('returns null for empty or unparseable text', () => {
    expect(extractJson('')).toBeNull()
    expect(extractJson('   ')).toBeNull()
    expect(extractJson(null)).toBeNull()
    expect(extractJson('no json here')).toBeNull()
    expect(extractJson('{ definitely not json')).toBeNull()
  })
})

describe('extractTicketArray', () => {
  it('reads {tickets:[...]}, bare arrays, and JSON strings', () => {
    expect(extractTicketArray({ tickets: [1, 2] })).toEqual([1, 2])
    expect(extractTicketArray([3, 4])).toEqual([3, 4])
    expect(extractTicketArray('{"tickets":[5]}')).toEqual([5])
    expect(extractTicketArray('not json')).toEqual([])
    expect(extractTicketArray(42)).toEqual([])
  })

  it('reads a fenced batch file, which is a normal subagent failure mode', () => {
    expect(extractTicketArray('```json\n{"tickets":[5]}\n```')).toEqual([5])
  })
})

describe('validateTickets', () => {
  it('keeps valid tickets and counts dropped ones', () => {
    const res = validateTickets({ tickets: [goodRaw, { body: '' }, goodRaw] }, withStaff)
    expect(res.tickets).toHaveLength(2)
    expect(res.dropped).toBe(1)
  })

  it('reports nothing dropped when the whole batch is unreadable', () => {
    // No items parsed means no items to drop. The shortfall, not `dropped`, is what surfaces it.
    expect(validateTickets('total garbage', withStaff)).toEqual({ tickets: [], dropped: 0 })
    expect(validateTickets(null, withStaff)).toEqual({ tickets: [], dropped: 0 })
  })
})

describe('assembleTickets', () => {
  const NOW = Date.parse('2026-06-30T12:00:00.000Z')
  const DAY = 24 * 60 * 60 * 1000
  // Opening times ordered by id (index = id - 1); ids beyond the array fall back to now.
  const openings = [NOW - 40 * DAY, NOW - 10 * DAY]
  const time = { nowMs: NOW, rng: () => 0.5, openingMsForId: (id: number) => openings[id - 1] ?? NOW }

  it('assigns sequential integer ids from a start offset', () => {
    const drafts = validateTickets({ tickets: [goodRaw, goodRaw] }, noStaff).tickets
    const out = assembleTickets(drafts, 10, time)
    expect(out.map((t) => t.id)).toEqual([10, 11])
  })

  it('gives each ticket the opening time mapped to its id (ascending id ⇒ ascending open time)', () => {
    const drafts = validateTickets({ tickets: [goodRaw, goodRaw] }, noStaff).tickets
    const [a, b] = assembleTickets(drafts, 1, time)
    expect(a.messages[0].createdAt).toBe(new Date(openings[0]).toISOString())
    expect(b.messages[0].createdAt).toBe(new Date(openings[1]).toISOString())
    expect(Date.parse(a.messages[0].createdAt)).toBeLessThan(Date.parse(b.messages[0].createdAt))
  })

  it('stamps every message with an ascending createdAt starting from the opening time', () => {
    const drafts = validateTickets({ tickets: [goodRaw] }, withStaff).tickets
    const [ticket] = assembleTickets(drafts, 1, time)
    expect(ticket.messages).toHaveLength(2)
    const times = ticket.messages.map((m) => Date.parse(m.createdAt))
    expect(times[0]).toBe(openings[0])
    expect(times[1]).toBeGreaterThanOrEqual(times[0])
    expect(times[1]).toBeLessThanOrEqual(NOW)
  })

  it('drops replies for a ticket opened within the recent window (no time to respond yet)', () => {
    const drafts = validateTickets({ tickets: [goodRaw] }, withStaff).tickets
    expect(drafts[0].messages).toHaveLength(2) // opening + reply before assembly
    const recent = { nowMs: NOW, rng: () => 0.5, openingMsForId: () => NOW - 60_000 } // 1 min ago
    const [ticket] = assembleTickets(drafts, 1, recent)
    expect(ticket.messages).toHaveLength(1) // reply dropped
    expect(ticket.messages[0].isStaff).toBe(false)
  })
})
