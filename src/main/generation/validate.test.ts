import { describe, expect, it } from 'vitest'
import { assembleTickets, extractTicketArray, repairTicket, validateTickets } from './validate'

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
})

describe('extractTicketArray', () => {
  it('reads {tickets:[...]}, bare arrays, and JSON strings', () => {
    expect(extractTicketArray({ tickets: [1, 2] })).toEqual([1, 2])
    expect(extractTicketArray([3, 4])).toEqual([3, 4])
    expect(extractTicketArray('{"tickets":[5]}')).toEqual([5])
    expect(extractTicketArray('not json')).toEqual([])
    expect(extractTicketArray(42)).toEqual([])
  })
})

describe('validateTickets', () => {
  it('keeps valid tickets and counts dropped ones', () => {
    const res = validateTickets({ tickets: [goodRaw, { body: '' }, goodRaw] }, withStaff)
    expect(res.tickets).toHaveLength(2)
    expect(res.dropped).toBe(1)
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
})
