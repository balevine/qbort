import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Run,
  cleanup,
  newRun,
  plan,
  readOutJson,
  readOutText,
  runEngine,
  scenariosInPrompt,
  writeBatch,
  writeOut,
  writeScenarios
} from './support/engine'

// The scenario pass: one subagent writes the whole list, `batches` deals it one scenario per ticket,
// and the surplus is the reserve a top-up round draws from. It is the newest part of the engine and
// the part with the most failure modes, since its input is a file a model wrote unsupervised.

let run: Run
beforeEach(async () => {
  run = await newRun()
})
afterEach(async () => {
  await cleanup(run)
})

function scenarioList(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `scenario number ${i}`)
}

const buildBatches = () => runEngine(['batches'], run.dir)

describe('batches fails fast on an unusable scenario list', () => {
  it('NO_SCENARIOS when the subagent never wrote the file', async () => {
    await plan(run, { count: 4 })
    const res = await buildBatches()
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('NO_SCENARIOS')
    expect(await readOutJson(run, 'round-0.json')).toBeNull()
  })

  it('BAD_SCENARIOS when the JSON is not a scenario list', async () => {
    await plan(run, { count: 4 })
    await writeOut(run, 'scenarios.json', JSON.stringify({ tickets: ['a', 'b', 'c', 'd'] }))
    const res = await buildBatches()
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('BAD_SCENARIOS')
  })

  it('BAD_SCENARIOS when nothing in the file parses as JSON', async () => {
    await plan(run, { count: 4 })
    await writeOut(run, 'scenarios.json', 'I was not able to come up with any scenarios.')
    const res = await buildBatches()
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('BAD_SCENARIOS')
  })

  it('SHORT_SCENARIOS when too few entries survive cleaning', async () => {
    await plan(run, { count: 4 })
    // Blanks and non-strings are discarded before the count, so a padded list does not pass.
    await writeOut(run, 'scenarios.json', JSON.stringify({ scenarios: ['a', '   ', 42, null, 'b'] }))
    const res = await buildBatches()
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('SHORT_SCENARIOS got 2 usable scenario(s), need at least 4')
    expect(res.stderr).toContain('asked for 7') // scenarioTarget(4)
  })

  it('fails rather than proceeding with a partial list, because nothing exists yet to lose', async () => {
    await plan(run, { count: 4 })
    await writeScenarios(run, scenarioList(3))
    const res = await buildBatches()
    expect(res.code).toBe(2)
    expect(await readOutText(run, 'prompt-0-0.txt')).toBeNull()
  })
})

describe('batches tolerates a messy but usable list', () => {
  it('reads JSON wrapped in a markdown fence', async () => {
    await plan(run, { count: 4, batchSize: 4 })
    await writeOut(run, 'scenarios.json', '```json\n' + JSON.stringify({ scenarios: scenarioList(6) }) + '\n```')
    const res = await buildBatches()
    expect(res.code, res.stderr).toBe(0)
    expect(res.stdout).toContain('SCENARIOS 6 loaded (2 held in reserve for top-ups)')
  })

  it('reads JSON buried in stray prose', async () => {
    await plan(run, { count: 4, batchSize: 4 })
    await writeOut(
      run,
      'scenarios.json',
      `Here are the scenarios you asked for:\n${JSON.stringify({ scenarios: scenarioList(6) })}\nLet me know if you want more.`
    )
    const res = await buildBatches()
    expect(res.code, res.stderr).toBe(0)
    expect(res.stdout).toContain('SCENARIOS 6 loaded')
  })

  it('accepts a bare top-level array', async () => {
    await plan(run, { count: 4, batchSize: 4 })
    await writeOut(run, 'scenarios.json', JSON.stringify(scenarioList(6)))
    const res = await buildBatches()
    expect(res.code, res.stderr).toBe(0)
    expect(res.stdout).toContain('SCENARIOS 6 loaded')
  })

  it('trims surrounding whitespace off each scenario', async () => {
    await plan(run, { count: 2, batchSize: 2 })
    await writeOut(run, 'scenarios.json', JSON.stringify({ scenarios: ['  padded one  ', '\tpadded two\n', 'c', 'd', 'e'] }))
    expect((await buildBatches()).code).toBe(0)
    const ctx = await readOutJson(run, 'run-context.json')
    expect(ctx.scenarios).toEqual(expect.arrayContaining(['padded one', 'padded two']))
  })
})

describe('dealing scenarios into batches', () => {
  it('shuffles the list and deals exactly one scenario per ticket, with no repeats', async () => {
    const input = scenarioList(20)
    await plan(run, { count: 6, batchSize: 2 })
    await writeScenarios(run, input)
    expect((await buildBatches()).code).toBe(0)

    const ctx = await readOutJson(run, 'run-context.json')
    // Shuffled, not reordered or dropped: a permutation of what the subagent wrote. Shuffling is
    // what stops one batch from inheriting a whole category the model happened to list together.
    expect([...ctx.scenarios].sort()).toEqual([...input].sort())
    expect(ctx.scenarios).not.toEqual(input)

    const dealt: string[] = []
    for (const index of [0, 1, 2]) {
      const prompt = await readOutText(run, `prompt-0-${index}.txt`)
      const batch = scenariosInPrompt(prompt!)
      expect(batch).toHaveLength(2) // one per ticket in this batch
      dealt.push(...batch)
    }
    expect(dealt).toEqual(ctx.scenarios.slice(0, 6)) // dealt in order, off the front
    expect(new Set(dealt).size).toBe(6) // no scenario reaches two tickets
    expect(ctx.scenarioCursor).toBe(6)
  })

  it('holds the surplus back as the reserve rather than dealing it', async () => {
    await plan(run, { count: 4, batchSize: 4 })
    await writeScenarios(run, scenarioList(9))
    const res = await buildBatches()
    expect(res.stdout).toContain('SCENARIOS 9 loaded (5 held in reserve for top-ups)')
    expect(scenariosInPrompt((await readOutText(run, 'prompt-0-0.txt'))!)).toHaveLength(4)
  })
})

describe('top-up rounds draw from the reserve', () => {
  /** Run to a 2-ticket shortfall with `total` scenarios in the list. */
  async function shortfallOfTwo(total: number): Promise<void> {
    await plan(run, { count: 4, batchSize: 4 })
    await writeScenarios(run, scenarioList(total))
    expect((await buildBatches()).code).toBe(0)
    await writeBatch(run, 0, 0, ['a', 'b']) // 2 of the 4 asked for
    const assembled = await runEngine(['assemble', '--round', '0'], run.dir)
    expect(assembled.stdout).toContain('SHORTFALL 2')
  }

  it('deals fresh scenarios to the re-generated tickets', async () => {
    await shortfallOfTwo(6) // 4 dealt in round 0, 2 in reserve
    const top = await runEngine(['topup', '--round', '1'], run.dir)
    expect(top.code, top.stderr).toBe(0)
    expect(top.stdout).toContain('TOPUP round 1: shortfall=2, scenarios available=2')

    const ctx = await readOutJson(run, 'run-context.json')
    const dealt = scenariosInPrompt((await readOutText(run, 'prompt-1-0.txt'))!)
    // The reserve, not a repeat of anything round 0 already used.
    expect(dealt).toEqual(ctx.scenarios.slice(4, 6))
    expect(ctx.scenarioCursor).toBe(6)
  })

  it('continues without failing when the reserve has run dry', async () => {
    await shortfallOfTwo(4) // the list covered the run exactly; nothing held back
    const top = await runEngine(['topup', '--round', '1'], run.dir)
    // Most of the output already exists by now, so fail-fast would be the wrong trade here.
    expect(top.code, top.stderr).toBe(0)
    expect(top.stdout).toContain('TOPUP round 1: shortfall=2, scenarios available=0')

    const prompt = await readOutText(run, 'prompt-1-0.txt')
    expect(prompt).toContain('EXACTLY 2 unique ticket(s)')
    expect(scenariosInPrompt(prompt!)).toEqual([])

    // And the round still assembles to a complete file.
    await writeBatch(run, 1, 0, ['c', 'd'])
    const assembled = await runEngine(['assemble', '--round', '1'], run.dir)
    expect(assembled.code, assembled.stderr).toBe(0)
    expect(assembled.stdout).toContain('KEPT 4 REQUESTED 4 DROPPED 0 SHORTFALL 0')
  })

  it('tells the model to invent the rest when the reserve covers only part of the round', async () => {
    await shortfallOfTwo(5) // one scenario left for a two-ticket top-up
    const top = await runEngine(['topup', '--round', '1'], run.dir)
    expect(top.stdout).toContain('shortfall=2, scenarios available=1')
    const prompt = await readOutText(run, 'prompt-1-0.txt')
    expect(scenariosInPrompt(prompt!)).toHaveLength(1)
    expect(prompt).toContain('The remaining 1 ticket(s) have no scenario')
  })
})
