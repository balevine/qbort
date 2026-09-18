import { describe, expect, it } from 'vitest'
import { compilePromptParts, compileScenarioPrompt, scenarioTarget } from '@lib/promptCompiler.mjs'
import { TICKET_STATUSES } from '@lib/constants.mjs'

// `compilePromptParts` returns the prompt in two halves, so the guarantees that matter are asserted
// here against both, since the engine writes exactly `${static}\n\n${dynamic}` to each batch's
// prompt file.

const roster = [
  { name: 'Sarah Chen', alias: 'sarah.chen' },
  { name: 'Mike Rodriguez', alias: 'mike.rodriguez' }
]

describe('compilePromptParts', () => {
  it('includes the user prompt and the enforced requirements', () => {
    const { static: prefix, dynamic } = compilePromptParts({
      editablePrompt: 'MY CUSTOM PROMPT',
      batchCount: 20,
      staff: { include: false, avgResponses: 0, roster: [] }
    })
    expect(prefix).toContain('MY CUSTOM PROMPT')
    expect(prefix).toContain('Return ONLY a single JSON object')
    expect(prefix).toContain('Do NOT include an "id" field')
    for (const s of TICKET_STATUSES) expect(prefix).toContain(s)
    expect(dynamic).toContain('EXACTLY 20 unique ticket(s)')
  })

  it('disables staff responses with an explicit empty-array instruction', () => {
    const { static: prefix } = compilePromptParts({
      editablePrompt: '',
      batchCount: 5,
      staff: { include: false, avgResponses: 3, roster }
    })
    expect(prefix).toContain('STAFF RESPONSES: DISABLED')
    expect(prefix).toContain('empty ([])')
    expect(prefix).not.toContain('sarah.chen@company.biz')
  })

  it('lists the roster with company.biz emails when enabled', () => {
    const { static: prefix } = compilePromptParts({
      editablePrompt: '',
      batchCount: 3,
      staff: { include: true, avgResponses: 2, roster }
    })
    expect(prefix).toContain('STAFF RESPONSES: ENABLED')
    expect(prefix).toContain('sarah.chen@company.biz')
    expect(prefix).toContain('mike.rodriguez@company.biz')
    expect(prefix).toContain('Average staff responses per ticket: ~2')
  })

  it('forbids introducing other customers into a ticket thread', () => {
    const { static: prefix } = compilePromptParts({
      editablePrompt: '',
      batchCount: 3,
      staff: { include: true, avgResponses: 2, roster }
    })
    // The failure we guard against: responses filled with unrelated messages from other customers.
    expect(prefix).toContain('messages from other customers')
    expect(prefix).toContain('never introduce a different customer')
  })

  it('emits per-ticket targets in place of the average when responseCounts are provided', () => {
    const { static: prefix, dynamic } = compilePromptParts({
      editablePrompt: '',
      batchCount: 3,
      staff: { include: true, avgResponses: 2, roster, responseCounts: [0, 3, 1] }
    })
    expect(dynamic).toContain('[0, 3, 1]')
    expect(prefix).not.toContain('Average staff responses per ticket')
  })

  it('still emits requirements when the editable prompt is empty', () => {
    const { static: prefix } = compilePromptParts({
      editablePrompt: '   ',
      batchCount: 1,
      staff: { include: false, avgResponses: 0, roster: [] }
    })
    expect(prefix.startsWith('═')).toBe(true)
  })

  it('keeps the batch count and per-ticket targets out of the static prefix', () => {
    const { static: prefix, dynamic } = compilePromptParts({
      editablePrompt: 'CREATIVE',
      batchCount: 7,
      staff: { include: true, avgResponses: 2, roster, responseCounts: [1, 0, 2] }
    })
    // Static prefix holds the per-batch-invariant content (identical across every batch of a run)…
    expect(prefix).toContain('CREATIVE')
    expect(prefix).toContain('sarah.chen@company.biz')
    expect(prefix).not.toContain('EXACTLY 7')
    expect(prefix).not.toContain('[1, 0, 2]')
    // …the dynamic suffix holds only what changes per batch.
    expect(dynamic).toContain('EXACTLY 7 unique ticket(s)')
    expect(dynamic).toContain('[1, 0, 2]')
  })

  it('gives every batch of a run the same prefix, whatever the batch differs in', () => {
    const base = {
      editablePrompt: 'CREATIVE',
      staff: { include: true, avgResponses: 2, roster, responseCounts: [1] }
    }
    const a = compilePromptParts({ ...base, batchCount: 1 })
    const b = compilePromptParts({
      ...base,
      batchCount: 9,
      staff: { ...base.staff, responseCounts: [0, 1, 2] },
      scenarios: ['alpha fails']
    })
    expect(a.static).toBe(b.static)
    expect(a.dynamic).not.toBe(b.dynamic)
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
