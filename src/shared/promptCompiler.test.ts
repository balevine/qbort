import { describe, expect, it } from 'vitest'
import { compilePrompt, compilePromptParts } from './promptCompiler'
import { TICKET_STATUSES } from './types'

const roster = [
  { name: 'Sarah Chen', alias: 'sarah.chen' },
  { name: 'Mike Rodriguez', alias: 'mike.rodriguez' }
]

describe('compilePrompt', () => {
  it('includes the user prompt and the enforced requirements', () => {
    const out = compilePrompt({
      editablePrompt: 'MY CUSTOM PROMPT',
      batchCount: 20,
      staff: { include: false, avgResponses: 0, roster: [] }
    })
    expect(out).toContain('MY CUSTOM PROMPT')
    expect(out).toContain('EXACTLY 20 unique ticket(s)')
    expect(out).toContain('Return ONLY a single JSON object')
    expect(out).toContain('Do NOT include an "id" field')
    for (const s of TICKET_STATUSES) expect(out).toContain(s)
  })

  it('disables staff responses with an explicit empty-array instruction', () => {
    const out = compilePrompt({
      editablePrompt: '',
      batchCount: 5,
      staff: { include: false, avgResponses: 3, roster }
    })
    expect(out).toContain('STAFF RESPONSES: DISABLED')
    expect(out).toContain('empty ([])')
    expect(out).not.toContain('sarah.chen@company.biz')
  })

  it('lists the roster with company.biz emails when enabled', () => {
    const out = compilePrompt({
      editablePrompt: '',
      batchCount: 3,
      staff: { include: true, avgResponses: 2, roster }
    })
    expect(out).toContain('STAFF RESPONSES: ENABLED')
    expect(out).toContain('sarah.chen@company.biz')
    expect(out).toContain('mike.rodriguez@company.biz')
    expect(out).toContain('Average staff responses per ticket: ~2')
  })

  it('forbids introducing other customers into a ticket thread', () => {
    const out = compilePrompt({
      editablePrompt: '',
      batchCount: 3,
      staff: { include: true, avgResponses: 2, roster }
    })
    // The failure we guard against: responses filled with unrelated messages from other customers.
    expect(out).toContain('messages from other customers')
    expect(out).toContain('never introduce a different customer')
  })

  it('emits per-ticket targets when responseCounts are provided', () => {
    const out = compilePrompt({
      editablePrompt: '',
      batchCount: 3,
      staff: { include: true, avgResponses: 2, roster, responseCounts: [0, 3, 1] }
    })
    expect(out).toContain('[0, 3, 1]')
    expect(out).not.toContain('Average staff responses per ticket')
  })

  it('still emits requirements when the editable prompt is empty', () => {
    const out = compilePrompt({
      editablePrompt: '   ',
      batchCount: 1,
      staff: { include: false, avgResponses: 0, roster: [] }
    })
    expect(out.startsWith('═')).toBe(true)
  })
})

describe('compilePromptParts', () => {
  it('keeps the batch count and per-ticket targets in the dynamic suffix, schema in the static prefix', () => {
    const { static: prefix, dynamic } = compilePromptParts({
      editablePrompt: 'CREATIVE',
      batchCount: 7,
      staff: { include: true, avgResponses: 2, roster, responseCounts: [1, 0, 2] }
    })
    // Static prefix holds the per-batch-invariant content (cacheable across batches)…
    expect(prefix).toContain('CREATIVE')
    expect(prefix).toContain('sarah.chen@company.biz')
    expect(prefix).toContain('Return ONLY a single JSON object')
    expect(prefix).not.toContain('EXACTLY 7')
    expect(prefix).not.toContain('[1, 0, 2]')
    // …the dynamic suffix holds only what changes per batch.
    expect(dynamic).toContain('EXACTLY 7 unique ticket(s)')
    expect(dynamic).toContain('[1, 0, 2]')
  })

  it('compilePrompt is exactly the prefix + dynamic suffix', () => {
    const input = {
      editablePrompt: 'X',
      batchCount: 3,
      staff: { include: false as const, avgResponses: 0, roster: [] }
    }
    const { static: prefix, dynamic } = compilePromptParts(input)
    expect(compilePrompt(input)).toBe(`${prefix}\n\n${dynamic}`)
  })
})
