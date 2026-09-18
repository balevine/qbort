import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Run,
  cleanup,
  manifestVersion,
  newRun,
  outputFiles,
  plan,
  readOutJson,
  readOutText,
  readOutput,
  readRound,
  runEngine,
  writeBatch,
  writeOut,
  writeScenarios
} from './support/engine'

// End-to-end over the real CLI. Everything an ambient subagent would produce is written by hand,
// which turns the pipeline deterministic and lets the failure paths (garbled batches, over-delivery,
// shortfalls) be provoked on demand instead of waited for.

let run: Run
beforeEach(async () => {
  run = await newRun()
})
afterEach(async () => {
  await cleanup(run)
})

/** plan → scenarios → batches, the three steps every assemble test needs first. */
async function upTo(batchesFor: number, batchSize?: number, staff = true): Promise<void> {
  const planned = await plan(run, { count: batchesFor, batchSize, staff, avg: 2 })
  expect(planned.code, planned.stderr).toBe(0)
  await writeScenarios(run, Array.from({ length: batchesFor * 2 }, (_, i) => `scenario ${i}`))
  const built = await runEngine(['batches'], run.dir)
  expect(built.code, built.stderr).toBe(0)
}

describe('plan', () => {
  it('records the clamped settings, roster, and opening times, then asks for scenarios', async () => {
    const res = await plan(run, { count: 4, batchSize: 2, staff: true, avg: 2, staffMembers: 3 })
    expect(res.code, res.stderr).toBe(0)
    expect(res.stdout).toContain('PLANNED 4 ticket(s), batchSize=2, staff=true, roster=3')
    expect(res.stdout).toContain('SCENARIO 7 scenario(s) needed') // scenarioTarget(4)

    const ctx = await readOutJson(run, 'run-context.json')
    expect(ctx.settings).toEqual({
      numTickets: 4,
      includeStaffResponses: true,
      avgStaffResponses: 2,
      numStaffMembers: 3,
      maxTicketAgeDays: 3650
    })
    expect(ctx.roster).toHaveLength(3)
    expect(ctx.openingTimes).toHaveLength(4)
    for (let i = 1; i < ctx.openingTimes.length; i++) {
      expect(ctx.openingTimes[i]).toBeGreaterThanOrEqual(ctx.openingTimes[i - 1])
    }
    expect(ctx.round).toBe(0)
    expect(ctx.generatedCount).toBe(0)
    expect(ctx.scenarios).toEqual([])

    // The scenario subagent's prompt is on disk, carrying the user's own text.
    const scenarioPrompt = await readOutText(run, 'scenario-prompt.txt')
    expect(scenarioPrompt).toContain('Generate support tickets')
    expect(scenarioPrompt).toContain('EXACTLY 7 one-line ticket scenarios')
  })

  it('clamps an out-of-range count rather than trusting the flag', async () => {
    const res = await plan(run, { count: 99999 })
    expect(res.code, res.stderr).toBe(0)
    const ctx = await readOutJson(run, 'run-context.json')
    expect(ctx.settings.numTickets).toBe(500)
  })

  it('fails with MISSING_PROMPT and writes nothing when the prompt file is absent', async () => {
    const res = await runEngine(
      ['plan', '--prompt', join(run.dir, 'nope.md'), '--count', '3'],
      run.dir
    )
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('MISSING_PROMPT')
    // The wipe happens before the prompt is read, so the directory exists, but nothing was planned
    // into it and no half-started run is left for `batches` to pick up.
    expect(await fs.readdir(run.out)).toEqual([])
  })

  it('names the output file once, up front, and does not create it yet', async () => {
    const res = await plan(run, { count: 4 })
    const ctx = await readOutJson(run, 'run-context.json')
    expect(ctx.outputFile).toMatch(/^tickets-\d{8}-\d{6}\.json$/)
    expect(res.stdout).toContain(`WILL WRITE ${join(run.output, ctx.outputFile)}`)
    // Announced, not written: an unassembled run must not leave a file that looks like output.
    expect(await outputFiles(run)).toEqual([])
  })

  it('clears the scratch directory, so a previous run cannot leak into this one', async () => {
    // A well-formed batch file from an earlier run, sitting at exactly the path this run's subagent
    // is meant to write. Nothing downstream could tell it apart from a fresh one.
    await writeBatch(run, 0, 0, ['stale'])
    await writeOut(run, 'round-0.json', '{"round":0,"batches":[]}')

    await plan(run, { count: 2, batchSize: 2 })
    expect(await fs.readdir(run.out)).toEqual(
      expect.not.arrayContaining(['batch-0-0.json', 'round-0.json'])
    )
  })

  it('leaves earlier runs\' output alone', async () => {
    await fs.mkdir(run.output, { recursive: true })
    await fs.writeFile(join(run.output, 'tickets-20200101-000000.json'), '{}', 'utf-8')

    await plan(run, { count: 2 })
    expect(await outputFiles(run)).toEqual(['tickets-20200101-000000.json'])
  })
})

describe('batches', () => {
  it('fails with NO_CONTEXT when plan has not run', async () => {
    const res = await runEngine(['batches'], run.dir)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('NO_CONTEXT')
  })

  it('splits the run into batches of batchSize with the remainder last', async () => {
    await upTo(5, 2)
    const manifest = await readRound(run, 0)
    expect(manifest!.batches.map((b) => b.count)).toEqual([2, 2, 1])
  })

  it('gives every batch prompt the identical static prefix compiled at plan time', async () => {
    await upTo(4, 2)
    const ctx = await readOutJson(run, 'run-context.json')
    for (const index of [0, 1]) {
      const prompt = await readOutText(run, `prompt-0-${index}.txt`)
      expect(prompt!.startsWith(ctx.staticPrefix)).toBe(true)
      expect(prompt).toContain('EXACTLY 2 unique ticket(s)')
    }
  })
})

describe('assemble', () => {
  it('assigns ids, timestamps, and staff roles, and writes a schema-valid file', async () => {
    await upTo(3, 3)
    await writeBatch(run, 0, 0, ['a', 'b', 'c'], { responses: 1 })

    const res = await runEngine(['assemble', '--round', '0'], run.dir)
    expect(res.code, res.stderr).toBe(0)
    expect(res.stdout).toContain('KEPT 3 REQUESTED 3 DROPPED 0 SHORTFALL 0')

    // Written under the name `plan` claimed, and reported as an absolute path, which is the only
    // thing the skill has to hand back to the user (the name is timestamped and unguessable).
    const ctx = await readOutJson(run, 'run-context.json')
    expect(await outputFiles(run)).toEqual([ctx.outputFile])
    expect(res.stdout).toContain(`FILE ${join(run.output, ctx.outputFile)}`)

    const file = await readOutput(run)
    expect(file.meta.provider).toBe('claude-skill')
    expect(file.meta.requestedCount).toBe(3)
    expect(file.meta.generatedCount).toBe(3)
    expect(file.meta.rounds).toBe(1)
    expect(file.meta.dropped).toBe(0)
    expect(file.meta.usage).toBeUndefined() // ambient generation has no token accounting
    // Stamped from the plugin manifest, which is the only place a version is written down. Asserted
    // against the manifest rather than a literal, or this test becomes the next copy to drift.
    expect(file.meta.appVersion).toBe(await manifestVersion())

    // Ids are sequential integers assigned by the engine, never taken from the model.
    expect(file.tickets.map((t: any) => t.id)).toEqual([1, 2, 3])
    expect(file.tickets.map((t: any) => t.subject)).toEqual(['Subject a', 'Subject b', 'Subject c'])

    for (const ticket of file.tickets) {
      expect(ticket.messages).toHaveLength(2)
      expect(ticket.messages[0].isStaff).toBe(false)
      expect(ticket.messages[1].isStaff).toBe(true) // derived from @company.biz, not from the model
      const times = ticket.messages.map((m: any) => Date.parse(m.createdAt))
      expect(times[1]).toBeGreaterThanOrEqual(times[0])
    }
    // Ascending id ⇒ ascending open time, across the whole run.
    const openings = file.tickets.map((t: any) => Date.parse(t.messages[0].createdAt))
    for (let i = 1; i < openings.length; i++) expect(openings[i]).toBeGreaterThanOrEqual(openings[i - 1])
  })

  it('drops an unreadable batch entirely without counting it as a validation drop', async () => {
    await upTo(4, 2)
    await writeOut(run, 'batch-0-0.json', 'I could not produce JSON, sorry.')
    await writeBatch(run, 0, 1, ['c', 'd'])

    const res = await runEngine(['assemble', '--round', '0'], run.dir)
    expect(res.code, res.stderr).toBe(0)
    // Nothing parsed means nothing to drop; the shortfall is what surfaces the loss.
    expect(res.stdout).toContain('KEPT 2 REQUESTED 4 DROPPED 0 SHORTFALL 2')
    const file = await readOutput(run)
    expect(file.tickets.map((t: any) => t.subject)).toEqual(['Subject c', 'Subject d'])
  })

  it('counts individually malformed tickets as dropped and keeps the rest', async () => {
    await upTo(4, 4)
    await writeOut(
      run,
      'batch-0-0.json',
      JSON.stringify({
        tickets: [
          { subject: 'A', body: 'body a', status: 'open', from: { name: 'A', email: 'a@x.example' } },
          { subject: 'no body', from: { name: 'B', email: 'b@x.example' } },
          { subject: 'no author', body: 'body c' }
        ]
      })
    )

    const res = await runEngine(['assemble', '--round', '0'], run.dir)
    expect(res.code, res.stderr).toBe(0)
    expect(res.stdout).toContain('KEPT 1 REQUESTED 4 DROPPED 2 SHORTFALL 3')
  })

  it('caps an over-delivering batch at the count it was asked for', async () => {
    await upTo(4, 2)
    await writeBatch(run, 0, 0, ['a', 'b', 'c', 'd']) // asked for 2, delivered 4
    await writeBatch(run, 0, 1, ['e', 'f'])

    const res = await runEngine(['assemble', '--round', '0'], run.dir)
    expect(res.code, res.stderr).toBe(0)
    expect(res.stdout).toContain('KEPT 4 REQUESTED 4 DROPPED 0 SHORTFALL 0')
    const file = await readOutput(run)
    // The surplus is discarded, not counted as dropped. Extra ids would run past the
    // pre-computed opening-time window.
    expect(file.tickets.map((t: any) => t.subject)).toEqual([
      'Subject a',
      'Subject b',
      'Subject e',
      'Subject f'
    ])
  })

  it('never pushes the run past the requested total', async () => {
    await upTo(3, 2)
    await writeBatch(run, 0, 0, ['a', 'b'])
    await writeBatch(run, 0, 1, ['c', 'd', 'e']) // asked for 1, delivered 3

    const res = await runEngine(['assemble', '--round', '0'], run.dir)
    expect(res.code, res.stderr).toBe(0)
    const file = await readOutput(run)
    expect(file.tickets).toHaveLength(3)
    expect(file.tickets.map((t: any) => t.id)).toEqual([1, 2, 3])
  })

  it('rejects its own malformed output and writes nothing', async () => {
    await upTo(4, 2)
    // A ticket in the pre-messages[] shape, planted where only the engine could have put it. This
    // is the guard that stands between a shape change here and a viewer that silently stops loading.
    const ctx = await readOutJson(run, 'run-context.json')
    ctx.tickets = [
      {
        id: 'T-00001',
        subject: 'Billing',
        status: 'new',
        body: 'I was overcharged.',
        from: { name: 'Emily', email: 'emily@x.example' }
      }
    ]
    await writeOut(run, 'run-context.json', JSON.stringify(ctx))

    const res = await runEngine(['assemble', '--round', '0'], run.dir)
    expect(res.code).toBe(3)
    expect(res.stderr).toContain('BAD_OUTPUT')
    expect(await readOutput(run)).toBeNull()
  })

  it('fails with NO_ROUND for a round that was never built', async () => {
    await upTo(2, 2)
    const res = await runEngine(['assemble', '--round', '9'], run.dir)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('NO_ROUND')
  })
})

describe('topup', () => {
  it('generates exactly the shortfall and continues the id sequence', async () => {
    await upTo(4, 4)
    await writeBatch(run, 0, 0, ['a', 'b']) // 2 of the 4 asked for
    const first = await runEngine(['assemble', '--round', '0'], run.dir)
    expect(first.stdout).toContain('KEPT 2 REQUESTED 4 DROPPED 0 SHORTFALL 2')

    const top = await runEngine(['topup', '--round', '1'], run.dir)
    expect(top.code, top.stderr).toBe(0)
    expect(top.stdout).toContain('TOPUP round 1: shortfall=2')
    const manifest = await readRound(run, 1)
    expect(manifest!.batches.map((b) => b.count)).toEqual([2])

    await writeBatch(run, 1, 0, ['c', 'd'])
    const second = await runEngine(['assemble', '--round', '1'], run.dir)
    expect(second.code, second.stderr).toBe(0)
    expect(second.stdout).toContain('ASSEMBLED round 1: +2 this round')
    expect(second.stdout).toContain('KEPT 4 REQUESTED 4 DROPPED 0 SHORTFALL 0')

    const file = await readOutput(run)
    expect(file.tickets.map((t: any) => t.id)).toEqual([1, 2, 3, 4])
    expect(file.tickets.map((t: any) => t.subject)).toEqual([
      'Subject a',
      'Subject b',
      'Subject c',
      'Subject d'
    ])
    expect(file.meta.rounds).toBe(2)
  })

  it('rewrites the one file the run claimed, however many rounds it takes', async () => {
    // Every round assembles the whole accumulator afresh, so a name chosen at write time would
    // leave a two-top-up run with three files, all well-formed and only the last one complete.
    await upTo(6, 6)
    const ctx = await readOutJson(run, 'run-context.json')

    await writeBatch(run, 0, 0, ['a', 'b'])
    await runEngine(['assemble', '--round', '0'], run.dir)
    for (const [round, labels] of [
      [1, ['c', 'd']],
      [2, ['e', 'f']]
    ] as const) {
      expect((await runEngine(['topup', '--round', String(round)], run.dir)).code).toBe(0)
      await writeBatch(run, round, 0, [...labels])
      const res = await runEngine(['assemble', '--round', String(round)], run.dir)
      expect(res.code, res.stderr).toBe(0)
      expect(res.stdout).toContain(`FILE ${join(run.output, ctx.outputFile)}`)
    }

    expect(await outputFiles(run)).toEqual([ctx.outputFile])
    const file = await readOutput(run)
    expect(file.tickets).toHaveLength(6)
    expect(file.meta.rounds).toBe(3)
  })

  it('does nothing when the run is already complete', async () => {
    await upTo(2, 2)
    await writeBatch(run, 0, 0, ['a', 'b'])
    await runEngine(['assemble', '--round', '0'], run.dir)

    const top = await runEngine(['topup', '--round', '1'], run.dir)
    expect(top.code, top.stderr).toBe(0)
    expect(top.stdout).toContain('SHORTFALL 0 (nothing to top up)')
    expect(await readRound(run, 1)).toBeNull()
  })

  it('rejects a round below 1, which would overwrite the initial round', async () => {
    await upTo(2, 2)
    const res = await runEngine(['topup', '--round', '0'], run.dir)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('BAD_ROUND')
  })
})

describe('consecutive runs in the same directory', () => {
  it('leave one file each and share no working files', async () => {
    await upTo(2, 2)
    await writeBatch(run, 0, 0, ['a', 'b'])
    expect((await runEngine(['assemble', '--round', '0'], run.dir)).code).toBe(0)
    const first = await readOutJson(run, 'run-context.json')

    // The name has second resolution, so a test that plans twice inside one second would be
    // asserting against a collision no real pair of runs (minutes long) can produce.
    await new Promise((r) => setTimeout(r, 1100))

    await upTo(2, 2)
    const second = await readOutJson(run, 'run-context.json')
    expect(second.outputFile).not.toBe(first.outputFile)
    // Round 0's batch file came from the first run and sits at the path this run's subagent would
    // write. Before the wipe it was assembled straight into the second run's output.
    await runEngine(['assemble', '--round', '0'], run.dir)

    expect(await outputFiles(run)).toEqual([first.outputFile, second.outputFile])
    const file = await readOutput(run)
    expect(file.tickets).toEqual([])
  })
})

describe('dispatch', () => {
  it('exits with usage for an unknown subcommand', async () => {
    const res = await runEngine(['frobnicate'], run.dir)
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('Usage: engine.mjs')
  })
})
