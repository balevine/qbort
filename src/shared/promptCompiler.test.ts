import { describe, expect, it } from 'vitest'
import { compilePrompt, compilePromptParts, compileScenarioPrompt, scenarioTarget } from './promptCompiler'
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

describe('scenarios in the compiled prompt', () => {
  const base = {
    editablePrompt: 'CREATIVE',
    batchCount: 3,
    staff: { include: false as const, avgResponses: 0, roster: [] }
  }

  it('numbers the scenarios in the dynamic suffix, pairing each with its ticket', () => {
    const { dynamic } = compilePromptParts({ ...base, scenarios: ['alpha fails', 'beta hangs', 'gamma 404s'] })
    expect(dynamic).toContain('  1. alpha fails')
    expect(dynamic).toContain('  2. beta hangs')
    expect(dynamic).toContain('  3. gamma 404s')
    expect(dynamic).toContain('ticket 1 uses scenario 1')
  })

  it('keeps scenarios out of the static prefix so prompt caching still hits', () => {
    const withScenarios = compilePromptParts({ ...base, scenarios: ['alpha fails', 'beta hangs', 'gamma 404s'] })
    const without = compilePromptParts(base)
    expect(withScenarios.static).toBe(without.static)
    expect(withScenarios.static).not.toContain('alpha fails')
  })

  it('omits the scenario block entirely when none are dealt', () => {
    for (const scenarios of [undefined, []]) {
      const { dynamic } = compilePromptParts({ ...base, scenarios })
      expect(dynamic).not.toContain('scenario')
      expect(dynamic).toContain('EXACTLY 3 unique ticket(s)')
    }
  })

  it('tells the model to invent the rest when the reserve ran dry mid-batch', () => {
    const { dynamic } = compilePromptParts({ ...base, scenarios: ['only one'] })
    expect(dynamic).toContain('  1. only one')
    expect(dynamic).toContain('The remaining 2 ticket(s) have no scenario')
  })
})

describe('compileScenarioPrompt', () => {
  it('appends the scenario instructions to the user prompt with an exact count', () => {
    const out = compileScenarioPrompt('CREATIVE', 33)
    expect(out).toContain('CREATIVE')
    expect(out).toContain('EXACTLY 33 one-line ticket scenarios, numbered 1 to 33')
    expect(out).toContain('{ "scenarios": ["...", "...", ...] }')
    // The user's own examples are the thing we most need it to move past.
    expect(out).toContain('Do not reuse them')
  })

  it('still emits the instructions when the editable prompt is empty', () => {
    const out = compileScenarioPrompt('', 8)
    expect(out.startsWith('═')).toBe(true)
    expect(out).toContain('EXACTLY 8 one-line ticket scenarios')
  })
})

describe('scenarioTarget', () => {
  it('adds a flat buffer at small counts and 30% at large ones', () => {
    expect(scenarioTarget(5)).toBe(8) // 5 + 3 beats ceil(6.5)
    expect(scenarioTarget(10)).toBe(13) // tie: both give 13
    expect(scenarioTarget(100)).toBe(130) // 30% beats +3
    expect(scenarioTarget(25)).toBe(33)
  })

  it('always leaves at least three spare for top-up rounds', () => {
    for (const n of [0, 1, 2, 3, 7, 20, 500]) {
      expect(scenarioTarget(n) - n).toBeGreaterThanOrEqual(3)
    }
  })
})
