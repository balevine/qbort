import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createPainter,
  newestOutputPath,
  parseIdSpec,
  renderList,
  renderStats,
  renderThread,
  selectTickets,
  stamp,
  summarize,
  truncate,
  wrapText
} from '@lib/viewer.mjs'
import type { Ticket, TicketFileMeta } from '@lib/types.mjs'

describe('parseIdSpec', () => {
  it('parses single ids, lists, and ranges', () => {
    expect(Array.from(parseIdSpec('7') ?? [])).toEqual([7])
    expect(Array.from(parseIdSpec('3,9') ?? []).sort((a, b) => a - b)).toEqual([3, 9])
    expect(Array.from(parseIdSpec('10-13') ?? []).sort((a, b) => a - b)).toEqual([10, 11, 12, 13])
    expect(Array.from(parseIdSpec('2, 5-7, 10') ?? []).sort((a, b) => a - b)).toEqual([2, 5, 6, 7, 10])
  })

  it('tolerates reversed ranges', () => {
    expect(Array.from(parseIdSpec('5-3') ?? []).sort((a, b) => a - b)).toEqual([3, 4, 5])
  })

  it('returns null for invalid specs', () => {
    expect(parseIdSpec('foo')).toBeNull()
    expect(parseIdSpec('')).toBeNull()
    expect(parseIdSpec('1,abc,3')).toBeNull()
  })
})

describe('selectTickets', () => {
  const sampleTickets: Ticket[] = [
    {
      id: 1,
      subject: 'Login failed',
      status: 'open',
      messages: [
        {
          from: { name: 'Alice', email: 'alice@client.com' },
          body: 'Cannot login with my credentials',
          isStaff: false,
          createdAt: '2026-06-01T10:00:00.000Z'
        }
      ]
    },
    {
      id: 2,
      subject: 'Billing question',
      status: 'closed',
      messages: [
        {
          from: { name: 'Bob', email: 'bob@corp.com' },
          body: 'Need invoice for June',
          isStaff: false,
          createdAt: '2026-06-02T11:00:00.000Z'
        },
        {
          from: { name: 'Staff Member', email: 'agent@company.biz' },
          body: 'Here is your invoice attachment',
          isStaff: true,
          createdAt: '2026-06-02T12:00:00.000Z'
        }
      ]
    }
  ]

  it('filters by id set', () => {
    const res = selectTickets(sampleTickets, { ids: new Set([2]) })
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe(2)
  })

  it('filters by status', () => {
    const res = selectTickets(sampleTickets, { statuses: new Set(['open']) })
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe(1)
  })

  it('searches across subject and message bodies case-insensitively', () => {
    const bySubject = selectTickets(sampleTickets, { search: 'login' })
    expect(bySubject).toHaveLength(1)
    expect(bySubject[0].id).toBe(1)

    const byBody = selectTickets(sampleTickets, { search: 'invoice' })
    expect(byBody).toHaveLength(1)
    expect(byBody[0].id).toBe(2)
  })
})

describe('summarize', () => {
  it('calculates counts, statuses, replies and date bounds', () => {
    const sampleTickets: Ticket[] = [
      {
        id: 1,
        subject: 'Issue 1',
        status: 'open',
        messages: [
          {
            from: { name: 'A', email: 'a@test.com' },
            body: 'Help',
            isStaff: false,
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      },
      {
        id: 2,
        subject: 'Issue 2',
        status: 'solved',
        messages: [
          {
            from: { name: 'B', email: 'b@test.com' },
            body: 'Help 2',
            isStaff: false,
            createdAt: '2026-01-02T00:00:00.000Z'
          },
          {
            from: { name: 'S', email: 's@company.biz' },
            body: 'Fixed',
            isStaff: true,
            createdAt: '2026-01-03T00:00:00.000Z'
          }
        ]
      }
    ]

    const stats = summarize(sampleTickets)
    expect(stats.count).toBe(2)
    expect(stats.byStatus).toEqual({ open: 1, solved: 1 })
    expect(stats.messages).toBe(3)
    expect(stats.staffReplies).toBe(1)
    expect(stats.unanswered).toBe(1)
    expect(stats.avgMessages).toBe(1.5)
    expect(stats.avgStaffReplies).toBe(0.5)
    expect(stats.earliest).toBe('2026-01-01T00:00:00.000Z')
    expect(stats.latest).toBe('2026-01-03T00:00:00.000Z')
  })
})

describe('formatting helpers', () => {
  it('wrapText wraps words and preserves paragraphs', () => {
    const text = 'Hello world this is a test.\n\nSecond paragraph.'
    const wrapped = wrapText(text, 15)
    expect(wrapped).toContain('')
    expect(wrapped.length).toBeGreaterThan(2)
  })

  it('truncate cuts strings with ellipsis', () => {
    expect(truncate('short', 10)).toBe('short')
    expect(truncate('a very long string that needs truncation', 12)).toBe('a very long…')
  })

  it('stamp formats ISO dates', () => {
    expect(stamp('2026-06-15T12:30:45.000Z', true)).toBe('2026-06-15')
    expect(stamp('2026-06-15T12:30:45.000Z', false)).toBe('2026-06-15 12:30')
  })
})

describe('rendering', () => {
  const sampleTicket: Ticket = {
    id: 1,
    subject: 'Cannot login',
    status: 'open',
    messages: [
      {
        from: { name: 'Alice', email: 'alice@corp.com' },
        body: 'Please help reset password',
        isStaff: false,
        createdAt: '2026-06-01T10:00:00.000Z'
      }
    ]
  }

  it('renders list row', () => {
    const lines = renderList([sampleTicket], 80, false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('1')
    expect(lines[0]).toContain('open')
    expect(lines[0]).toContain('Cannot login')
  })

  it('renders thread', () => {
    const lines = renderThread(sampleTicket, 80, false)
    expect(lines.join('\n')).toContain('#1  Cannot login')
    expect(lines.join('\n')).toContain('Alice <alice@corp.com>')
    expect(lines.join('\n')).toContain('Please help reset password')
  })

  it('renders stats', () => {
    const meta: TicketFileMeta = {
      generatedAt: '2026-06-01T10:00:00.000Z',
      appVersion: '0.2.0',
      provider: 'test',
      model: 'test',
      requestedCount: 1,
      generatedCount: 1
    }
    const lines = renderStats(meta, summarize([sampleTicket]), false)
    expect(lines.join('\n')).toContain('1 tickets')
    expect(lines.join('\n')).toContain('open')
  })

  it('createPainter handles colored and non-colored output', () => {
    const plain = createPainter(false)
    expect(plain.bold('text')).toBe('text')
    const color = createPainter(true)
    expect(color.bold('text')).toContain('\u001b[1m')
  })
})

describe('newestOutputPath', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'qbort-newest-test-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns null when directory is empty', () => {
    expect(newestOutputPath(dir)).toBeNull()
  })

  it('returns newest timestamped file', async () => {
    await fs.writeFile(join(dir, 'tickets-20260101-100000.json'), '{}')
    await fs.writeFile(join(dir, 'tickets-20260102-120000.json'), '{}')
    await fs.writeFile(join(dir, 'other.txt'), 'ignore')
    const newest = newestOutputPath(dir)
    expect(newest).toContain('tickets-20260102-120000.json')
  })
})

describe('view-tickets.mjs CLI', () => {
  it('prints usage on --help', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { resolve } = await import('node:path')
    const run = promisify(execFile)

    const res = await run(process.execPath, [resolve('scripts/view-tickets.mjs'), '--help'])
    expect(res.stdout).toContain('Terminal reader for a generated `tickets.json`')
    expect(res.stdout).toContain('node scripts/view-tickets.mjs [file] [options]')
  })
})

