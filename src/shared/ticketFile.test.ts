import { describe, expect, it } from 'vitest'
import { parseTicketFile } from './ticketFile'
import type { TicketFile } from './types'

const validFile: TicketFile = {
  meta: {
    generatedAt: '2026-06-30T00:00:00.000Z',
    appVersion: '0.1.0',
    provider: 'ollama',
    model: 'test',
    requestedCount: 1,
    generatedCount: 1,
    settings: { generation: {} as never },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      batches: 1,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      pricing: { inputPerM: 0, outputPerM: 0, currency: 'USD' },
      durationMs: 1
    }
  },
  tickets: [
    {
      id: 1,
      subject: 'Cannot log in',
      status: 'open',
      messages: [
        { from: { name: 'Dana', email: 'dana@x.com' }, body: 'help', isStaff: false, createdAt: '2026-06-30T00:00:00.000Z' }
      ]
    }
  ]
}

describe('parseTicketFile', () => {
  it('accepts a well-formed current-schema file', () => {
    expect(parseTicketFile(validFile)).toEqual(validFile)
  })

  it('rejects non-objects and junk', () => {
    expect(parseTicketFile(null)).toBeNull()
    expect(parseTicketFile('nope')).toBeNull()
    expect(parseTicketFile({})).toBeNull()
    expect(parseTicketFile({ tickets: [] })).toBeNull() // missing meta
  })

  it('rejects an old pre-messages[] file (flat body/responses, string ids)', () => {
    const legacy = {
      meta: validFile.meta,
      tickets: [
        {
          id: 'T-00001',
          subject: 'Billing',
          body: 'I was overcharged.',
          status: 'new',
          from: { name: 'Emily', email: 'emily@x.com' },
          responses: [{ body: 'Sorry!', from: { name: 'Staff', email: 's@company.biz' } }]
        }
      ]
    }
    expect(parseTicketFile(legacy)).toBeNull()
  })

  it('rejects a ticket with an empty messages array', () => {
    const bad = { ...validFile, tickets: [{ id: 1, subject: 's', status: 'open', messages: [] }] }
    expect(parseTicketFile(bad)).toBeNull()
  })

  it('rejects a file whose meta usage block is malformed', () => {
    const bad = { ...validFile, meta: { ...validFile.meta, usage: { inputTokens: 0 } } }
    expect(parseTicketFile(bad)).toBeNull()
  })

  it('accepts a skill-generated file with no usage block and the claude-skill provider', () => {
    const { usage: _usage, ...metaNoUsage } = validFile.meta
    const skillFile = {
      ...validFile,
      meta: { ...metaNoUsage, provider: 'claude-skill', model: 'Claude Code subagents' }
    }
    expect(parseTicketFile(skillFile)).toEqual(skillFile)
  })
})
