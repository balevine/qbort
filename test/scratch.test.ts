import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearScratch } from '@lib/scratch.mjs'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'qbort-scratch-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('clearScratch', () => {
  it('removes everything, including nested directories', async () => {
    const scratch = join(dir, '.qbort-run')
    await fs.mkdir(join(scratch, 'run-100'), { recursive: true })
    await fs.writeFile(join(scratch, 'batch-0-0.json'), '{}', 'utf-8')
    await fs.writeFile(join(scratch, 'run-100', 'tickets.json'), '{}', 'utf-8')

    await clearScratch(scratch)
    expect(await fs.readdir(scratch)).toEqual([])
  })

  it('creates the directory when there is none yet', async () => {
    const scratch = join(dir, '.qbort-run')
    await clearScratch(scratch)
    expect((await fs.stat(scratch)).isDirectory()).toBe(true)
  })

  it('leaves everything beside it alone', async () => {
    const scratch = join(dir, '.qbort-run')
    await fs.mkdir(join(dir, 'qbort-output'), { recursive: true })
    await fs.writeFile(join(dir, 'qbort-output', 'tickets-20260918-134752.json'), '{}', 'utf-8')
    await fs.writeFile(join(dir, 'TICKET_PROMPT.md'), 'prompt', 'utf-8')

    await clearScratch(scratch)
    expect((await fs.readdir(dir)).sort()).toEqual(['.qbort-run', 'TICKET_PROMPT.md', 'qbort-output'])
    expect(await fs.readdir(join(dir, 'qbort-output'))).toEqual(['tickets-20260918-134752.json'])
  })
})
