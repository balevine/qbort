import { describe, expect, it } from 'vitest'
import {
  assignIds,
  extractTicketArray,
  formatTicketId,
  repairTicket,
  validateTickets
} from './validate'

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
  it('accepts and normalizes a well-formed ticket', () => {
    const t = repairTicket(goodRaw, withStaff)
    expect(t).not.toBeNull()
    expect(t!.subject).toBe('Cannot log in')
    expect(t!.status).toBe('open')
    expect(t!.from.email).toBe('dana.lee@acme.example')
    expect(t!.responses).toHaveLength(1)
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

  it('strips responses when staff responses are disabled', () => {
    expect(repairTicket(goodRaw, noStaff)!.responses).toEqual([])
  })

  it('drops malformed responses but keeps the ticket', () => {
    const t = repairTicket(
      { ...goodRaw, responses: [{ body: '' }, { body: 'ok', from: { email: 's@company.biz' } }] },
      withStaff
    )
    expect(t!.responses).toHaveLength(1)
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

describe('id assignment', () => {
  it('formats zero-padded ids', () => {
    expect(formatTicketId(1)).toBe('T-00001')
    expect(formatTicketId(42, 'X-')).toBe('X-00042')
  })

  it('assigns sequential ids from a start offset', () => {
    const drafts = validateTickets({ tickets: [goodRaw, goodRaw] }, noStaff).tickets
    const out = assignIds(drafts, 10)
    expect(out.map((t) => t.id)).toEqual(['T-00010', 'T-00011'])
  })
})
