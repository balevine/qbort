import { describe, expect, it } from 'vitest'
import { filterTickets, pageCount, pageOf } from './tickets'
import type { Ticket } from '@shared/types'

function ticket(id: string, subject: string, status: Ticket['status'], name: string): Ticket {
  return {
    id,
    subject,
    body: `body of ${subject}`,
    status,
    from: { name, email: `${name.toLowerCase()}@acme.example` },
    responses: []
  }
}

const tickets: Ticket[] = [
  ticket('T-00001', 'Login broken', 'open', 'Dana'),
  ticket('T-00002', 'Refund request', 'closed', 'Priya'),
  ticket('T-00003', 'Login slow', 'open', 'Marco')
]

describe('filterTickets', () => {
  it('returns all tickets with no filters', () => {
    expect(filterTickets(tickets, {})).toHaveLength(3)
    expect(filterTickets(tickets, { status: 'all' })).toHaveLength(3)
  })

  it('filters by status', () => {
    expect(filterTickets(tickets, { status: 'open' })).toHaveLength(2)
    expect(filterTickets(tickets, { status: 'closed' }).map((t) => t.id)).toEqual(['T-00002'])
  })

  it('matches the query across subject and customer name', () => {
    expect(filterTickets(tickets, { query: 'login' })).toHaveLength(2)
    expect(filterTickets(tickets, { query: 'priya' }).map((t) => t.id)).toEqual(['T-00002'])
  })

  it('combines status and query', () => {
    expect(filterTickets(tickets, { status: 'open', query: 'slow' }).map((t) => t.id)).toEqual([
      'T-00003'
    ])
  })
})

describe('pagination', () => {
  it('computes page counts (min 1)', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(100)).toBe(1)
    expect(pageCount(101)).toBe(2)
    expect(pageCount(250)).toBe(3)
  })

  it('slices the right page', () => {
    const items = Array.from({ length: 250 }, (_, i) => i)
    expect(pageOf(items, 0)).toHaveLength(100)
    expect(pageOf(items, 2)).toEqual(items.slice(200, 250))
    expect(pageOf(items, 2)).toHaveLength(50)
  })
})
