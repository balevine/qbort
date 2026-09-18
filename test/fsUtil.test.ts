import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWriteJson, atomicWriteText, readJson, readText } from '@lib/fsUtil.mjs'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'qbort-fsutil-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('atomicWriteJson / readJson', () => {
  it('writes pretty JSON and reads it back identically', async () => {
    const file = join(dir, 'data.json')
    const value = { a: 1, nested: { b: [1, 2, 3] } }
    await atomicWriteJson(file, value)
    expect(await readJson(file)).toEqual(value)
    // Pretty-printed (2-space indent), not minified.
    expect(await fs.readFile(file, 'utf-8')).toContain('\n  "a": 1')
  })

  it('creates missing parent directories', async () => {
    const file = join(dir, 'deep', 'nested', 'data.json')
    await atomicWriteJson(file, { ok: true })
    expect(await readJson(file)).toEqual({ ok: true })
  })

  it('leaves no temp files behind after a successful write', async () => {
    const file = join(dir, 'data.json')
    await atomicWriteJson(file, { ok: true })
    const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('returns null for a missing file and for malformed JSON', async () => {
    expect(await readJson(join(dir, 'nope.json'))).toBeNull()
    await fs.writeFile(join(dir, 'bad.json'), '{ not: json', 'utf-8')
    expect(await readJson(join(dir, 'bad.json'))).toBeNull()
  })

  it('does not collide temp files under many concurrent writes to the same path', async () => {
    const file = join(dir, 'data.json')
    // A shared temp name would race writeFile/rename → ENOENT or truncated JSON.
    await Promise.all(Array.from({ length: 30 }, (_, n) => atomicWriteJson(file, { n })))
    const read = await readJson<{ n: number }>(file)
    expect(read).not.toBeNull()
    expect(typeof read!.n).toBe('number')
    const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})

describe('atomicWriteText / readText', () => {
  it('round-trips text verbatim, creating parent directories', async () => {
    const file = join(dir, 'prompts', 'prompt-0-0.txt')
    await atomicWriteText(file, 'line one\nline two\n')
    expect(await readText(file)).toBe('line one\nline two\n')
  })

  it('returns null for a missing file rather than throwing', async () => {
    expect(await readText(join(dir, 'nope.txt'))).toBeNull()
  })

  it('reads back text that is not JSON, where readJson would give null', async () => {
    const file = join(dir, 'notes.txt')
    await atomicWriteText(file, 'not json at all')
    expect(await readText(file)).toBe('not json at all')
    expect(await readJson(file)).toBeNull()
  })
})
