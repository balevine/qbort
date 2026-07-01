import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWriteJson, readJson } from './fsUtil'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'tg-fsutil-'))
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
